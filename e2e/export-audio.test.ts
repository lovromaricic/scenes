import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fixture, importViaPicker, openNewVideo } from './helpers';

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

const probe = (file: string) =>
	JSON.parse(
		execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration,bit_rate', '-of', 'json', file]).toString()
	) as { streams: { codec_name: string; sample_rate: string; channels: number; bit_rate?: string }[]; format: { duration: string; bit_rate: string } };

/** RMS of a file's sound over [from, from + 1) seconds (ffmpeg). */
function fileRms(file: string, from: number): number {
	const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', '1', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
	let sum = 0;
	const n = pcm.length / 2;
	for (let k = 0; k < n; k++) sum += (pcm.readInt16LE(k * 2) / 32768) ** 2;
	return Math.sqrt(sum / n);
}

/** The app's own mix over [from, to). */
const mixRms = (page: Page, from: number, to: number) =>
	page.evaluate(
		async ({ from, to }) => {
			const s = (window as unknown as { __scenes: { mixdown(a: number, b: number): Promise<AudioBuffer> } }).__scenes;
			const b = await s.mixdown(from, to);
			const l = b.getChannelData(0);
			const r = b.numberOfChannels > 1 ? b.getChannelData(1) : l;
			let sum = 0;
			for (let i = 0; i < l.length; i++) sum += ((l[i] + r[i]) / 2) ** 2;
			return Math.sqrt(sum / l.length);
		},
		{ from, to }
	);

/** 12 s video (its sound off), a song with a dip to −20 dB from 4 s to 5 s, and a range 2–6 s. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['long.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await page.getByRole('button', { name: /^Sound Music/ }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: /^Music Add a song/ }).click();
	await (await chooser).setFiles(fixture('music.m4a'));
	await expect(page.locator('.item-slot.sound')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await api(page, `s => {
		s.setSceneVolume(s.project.scenes[0].id, 0);
		const id = s.project.sounds[0].id;
		s.setSoundFades(id, 0, 0);
		s.addVolumePoint(id, 3.9, 1);
		s.addVolumePoint(id, 4, 0.1);
		s.addVolumePoint(id, 5, 0.1);
		s.addVolumePoint(id, 5.1, 1);
		s.setRange({ start: 2, end: 6 });
	}`);
}

async function save(page: Page, format: 'WAV' | 'M4A' | 'MP3', bitrate?: string) {
	await page.getByRole('button', { name: 'Save video' }).click();
	const dialog = page.getByRole('dialog', { name: 'Save video' });
	await dialog.getByRole('radiogroup', { name: 'Save as' }).getByRole('radio', { name: 'Audio only' }).click();
	await dialog.getByRole('radiogroup', { name: 'Sound format' }).getByRole('radio', { name: format }).click();
	if (bitrate) await dialog.getByRole('radiogroup', { name: 'Bitrate' }).getByRole('radio', { name: bitrate }).click();
	await expect(dialog.getByTestId('export-summary')).toContainText('· 4 sec ·');
	const download = page.waitForEvent('download', { timeout: 120_000 });
	await dialog.getByRole('button', { name: 'Save audio' }).click();
	const d = await download;
	await expect(page.getByRole('dialog', { name: 'Your sound is ready' })).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).click();
	return d;
}

test.describe('Saving just the sound', () => {
	test.setTimeout(180_000);

	test('WAV: the range, at 48 kHz stereo, with the same mix (volume points included)', async ({ page }, info) => {
		await setup(page);
		const d = await save(page, 'WAV');
		expect(d.suggestedFilename()).toBe('Untitled video.wav');
		const file = info.outputPath('sound.wav');
		await d.saveAs(file);
		expect(readFileSync(file).subarray(0, 4).toString()).toBe('RIFF');
		if (!hasFfmpeg) return;
		const p = probe(file);
		expect(p.streams[0]).toMatchObject({ codec_name: 'pcm_s16le', sample_rate: '48000', channels: 2 });
		expect(Number(p.format.duration)).toBeCloseTo(4, 1);
		// The file starts at 2 s: the dip (4–5 s) is at 2–3 s in the file.
		const quietRatio = fileRms(file, 2.1) / fileRms(file, 0.5);
		expect(quietRatio).toBeLessThan(0.3);
		const mixRatio = (await mixRms(page, 4.1, 5.1)) / (await mixRms(page, 2.5, 3.5));
		expect(quietRatio).toBeCloseTo(mixRatio, 1);
	});

	test('M4A (where the browser can make AAC) and MP3, at the chosen bitrate', async ({ page }, info) => {
		await setup(page);
		const m4aOk = await page.evaluate(async () => {
			try {
				return (await (window as unknown as { AudioEncoder: { isConfigSupported(c: object): Promise<{ supported: boolean }> } }).AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported;
			} catch {
				return false;
			}
		});
		if (m4aOk) {
			const d = await save(page, 'M4A', '128 kbps');
			expect(d.suggestedFilename()).toBe('Untitled video.m4a');
			const file = info.outputPath('sound.m4a');
			await d.saveAs(file);
			if (hasFfmpeg) {
				const p = probe(file);
				expect(p.streams[0].codec_name).toBe('aac');
				expect(Number(p.format.duration)).toBeCloseTo(4, 0);
				expect(Number(p.format.bit_rate)).toBeLessThan(170_000);
			}
		} else {
			await page.getByRole('button', { name: 'Save video' }).click();
			await page.getByRole('dialog').getByRole('radio', { name: 'Audio only' }).click();
			await expect(page.getByRole('radiogroup', { name: 'Sound format' }).getByRole('radio', { name: 'M4A' })).toBeDisabled();
			await page.getByRole('button', { name: 'Close' }).click();
		}

		const d = await save(page, 'MP3', '320 kbps');
		expect(d.suggestedFilename()).toBe('Untitled video.mp3');
		const file = info.outputPath('sound.mp3');
		await d.saveAs(file);
		if (!hasFfmpeg) return;
		const p = probe(file);
		expect(p.streams[0].codec_name).toBe('mp3');
		expect(Number(p.format.duration)).toBeCloseTo(4, 0);
		expect(Number(p.streams[0].bit_rate ?? p.format.bit_rate)).toBeGreaterThan(280_000);
		// Same mix: the dip is there.
		expect(fileRms(file, 2.1) / fileRms(file, 0.5)).toBeLessThan(0.3);
	});
});
