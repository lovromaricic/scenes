import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { importViaPicker, openNewVideo } from './helpers';

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;

const tools = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		execFileSync('unzip', ['-v'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

/** RGBA of a picture (or a video's first frame, decoded with libvpx so its alpha is kept). */
function rgba(file: string, x: number, y: number, video = false): number[] {
	const args = ['-v', 'error'];
	if (video) args.push('-c:v', 'libvpx-vp9');
	args.push('-i', file, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y}`, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-');
	return [...execFileSync('ffmpeg', args)];
}

/** Red scene; a blue card (0.4–0.6 across, 0.4–0.6 down) from 0 to 6 s; a range of 1 s. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await api(page, `s => {
		const c = s.addCardOverlay(0);
		s.setOverlayCard(c, { background: '#0000ff', rect: null });
		s.setOverlayBox(c, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
		s.setOverlayTiming(c, 0, 6);
		s.setRange({ start: 1, end: 2 });
		s.deselect();
	}`);
}

async function open(page: Page) {
	await page.getByRole('button', { name: 'Save video' }).click();
	const dialog = page.getByRole('dialog', { name: 'Save video' });
	await dialog.getByRole('radiogroup', { name: 'Save as' }).getByRole('radio', { name: 'Overlays only' }).click();
	await expect(dialog.getByTestId('export-summary')).toContainText('transparent');
	return dialog;
}

test.describe('Saving overlays only (transparent)', () => {
	test.setTimeout(180_000);

	test('PNG frames in a ZIP: one per frame, transparent around the layers, no scene', async ({ page }, info) => {
		await setup(page);
		const dialog = await open(page);
		await dialog.getByRole('radiogroup', { name: 'Overlays format' }).getByRole('radio', { name: 'PNG frames (ZIP)' }).click();
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await dialog.getByRole('button', { name: 'Save overlays' }).click();
		const d = await download;
		expect(d.suggestedFilename()).toBe('Untitled video overlays.zip');
		const file = info.outputPath('overlays.zip');
		await d.saveAs(file);
		await expect(page.getByRole('dialog', { name: 'Your overlays are ready' })).toBeVisible();
		if (!tools) return;
		const list = execFileSync('unzip', ['-Z1', file]).toString().trim().split('\n');
		expect(list).toHaveLength(30); // 1 s at 30 fps
		expect(list[0]).toBe('frame_00001.png');
		const png = info.outputPath('frame.png');
		writeFileSync(png, execFileSync('unzip', ['-p', file, 'frame_00001.png']));
		expect(readFileSync(png).subarray(1, 4).toString()).toBe('PNG');
		// Around the card: fully transparent (no red scene). The card: opaque blue.
		expect(rgba(png, 20, 20)[3]).toBe(0);
		const card = rgba(png, 640, 360);
		expect(card[3]).toBe(255);
		expect(card[2]).toBeGreaterThan(240);
		expect(card[0]).toBeLessThan(15);
	});

	test('WebM with transparency where the browser can make it (otherwise a one-line explanation)', async ({ page }, info) => {
		await setup(page);
		const dialog = await open(page);
		const webm = dialog.getByRole('radiogroup', { name: 'Overlays format' }).getByRole('radio', { name: 'WebM with transparency' });
		const supported = await page.evaluate(async () => {
			try {
				return (await VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', width: 640, height: 360, bitrate: 1e6, alpha: 'keep' } as VideoEncoderConfig)).supported;
			} catch {
				return false;
			}
		});
		if (!supported) {
			await expect(webm).toHaveCount(0);
			await expect(dialog.getByTestId('no-alpha-webm')).toBeVisible();
			return;
		}
		await expect(webm).toHaveAttribute('aria-checked', 'true');
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await dialog.getByRole('button', { name: 'Save overlays' }).click();
		const d = await download;
		expect(d.suggestedFilename()).toBe('Untitled video overlays.webm');
		const file = info.outputPath('overlays.webm');
		await d.saveAs(file);
		if (!tools) return;
		const p = JSON.parse(
			execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:stream_tags=alpha_mode:format=duration', '-of', 'json', file]).toString()
		);
		expect(p.streams).toHaveLength(1); // picture only, no sound
		expect(p.streams[0].codec_name).toBe('vp9');
		expect(p.streams[0].tags?.alpha_mode ?? p.streams[0].tags?.ALPHA_MODE).toBe('1');
		expect(Number(p.format.duration)).toBeCloseTo(1, 0);
		const w = p.streams[0].width;
		const h = p.streams[0].height;
		expect(rgba(file, 20, 20, true)[3]).toBeLessThan(10);
		const card = rgba(file, Math.floor(w / 2), Math.floor(h / 2), true);
		expect(card[3]).toBeGreaterThan(245);
		expect(card[2]).toBeGreaterThan(200);
	});
});
