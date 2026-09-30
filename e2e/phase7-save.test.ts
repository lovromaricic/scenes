import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fixture, importViaPicker, scenes, seekTo, setFormat, openNewVideo } from './helpers';

type RGB = [number, number, number];

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

function probe(file: string) {
	const json = execFileSync('ffprobe', [
		'-v',
		'error',
		'-show_format',
		'-show_streams',
		'-of',
		'json',
		file
	]);
	return JSON.parse(json.toString()) as {
		format: { format_name: string; duration: string };
		streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
	};
}

/** Average colour of a small patch of the exported video at time t (relative position). */
function exportedPixel(file: string, t: number, fx: number, fy: number, w: number, h: number): RGB {
	const x = Math.round(fx * w) - 2;
	const y = Math.round(fy * h) - 2;
	const raw = execFileSync('ffmpeg', [
		'-v',
		'error',
		'-ss',
		t.toFixed(3),
		'-i',
		file,
		'-frames:v',
		'1',
		'-vf',
		`crop=4:4:${x}:${y}`,
		'-f',
		'rawvideo',
		'-pix_fmt',
		'rgb24',
		'-'
	]);
	const px: RGB = [0, 0, 0];
	for (let i = 0; i < 16; i++) for (let c = 0; c < 3; c++) px[c] += raw[i * 3 + c] / 16;
	return px.map(Math.round) as RGB;
}

/** The same spot in the live preview. */
async function previewPixel(page: Page, fx: number, fy: number): Promise<RGB> {
	await expect
		.poll(() => scenes(page, (s) => s.player.isFrameReady()), { timeout: 10_000 })
		.toBe(true);
	await page.evaluate(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
	);
	return page.evaluate(
		({ fx, fy }) => {
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const s = (
				window as unknown as { __scenes: { player: { readPixel(x: number, y: number): number[] } } }
			).__scenes;
			const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
			return [p[0], p[1], p[2]] as RGB;
		},
		{ fx, fy }
	);
}

const close = (a: RGB, b: RGB, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

async function buildProject(page: Page) {
	await openNewVideo(page);
	// Red 4s, magenta 12s, a yellow photo stretched to 14s: 30 seconds, three scenes.
	await importViaPicker(page, ['red.mp4', 'long.mp4', 'yellow.jpg'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
	await page.evaluate(() => {
		const s = (
			window as unknown as {
				__scenes: {
					project: { scenes: { id: string }[] };
					setSceneLength(id: string, l: number): void;
				};
			}
		).__scenes;
		s.setSceneLength(s.project.scenes[2].id, 14);
	});
	await expect(page.getByText('3 scenes · 30 sec')).toBeVisible();
	// The first clip is 640×360, so the project started at 720p; make it Full HD.
	await setFormat(page, 'Landscape', '1080p');
	await expect(
		page.getByRole('button', { name: /^Project format: 1920 × 1080 · 30 fps/ })
	).toBeVisible();

	// A crossfade between scenes 1 and 2.
	await page.getByRole('button', { name: /Transition between scene 1 and 2/ }).click();
	await page
		.getByRole('dialog', { name: /Transition between/ })
		.getByRole('radio', { name: /^Crossfade/ })
		.click();

	// A golden look on the first scene.
	await page.getByRole('button', { name: /^Scene 1, / }).click();
	await page
		.getByRole('radiogroup', { name: 'Mood' })
		.getByRole('radio', { name: 'Golden' })
		.click();

	// A caption on the photo.
	await seekTo(page, 20);
	await page.getByRole('button', { name: /^Words/ }).click();
	await page.getByRole('button', { name: /^Caption/ }).click();
	await page.keyboard.type('Saved on my device');
	await page.keyboard.press('Enter');

	// Background music.
	await page.getByRole('button', { name: /^Sound/ }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: /^Music/ }).click();
	await (await chooser).setFiles(fixture('music.m4a'));
	await expect(page.getByRole('button', { name: /^Music: / })).toBeVisible();
}

test.describe('Phase 7: save video', () => {
	test.skip(!hasFfmpeg, 'needs ffmpeg/ffprobe to inspect the saved file');
	test.setTimeout(180_000);

	test('a 30-second project saves as an MP4 that plays and matches the preview', async ({
		page
	}, info) => {
		await buildProject(page);

		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('radio', { name: /Best quality/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await expect(dialog.getByText('1920 × 1080', { exact: false }).first()).toBeVisible();
		await expect(dialog.getByText(/WebM/)).toHaveCount(0);

		const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
		await dialog.getByRole('button', { name: 'Save video' }).click();
		await expect(page.getByRole('progressbar', { name: 'Saving progress' })).toBeVisible();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('Untitled video.mp4');
		const file = info.outputPath('export.mp4');
		await download.saveAs(file);
		await expect(page.getByRole('dialog', { name: 'Your video is ready' })).toBeVisible();

		// A normal MP4: H.264 video + AAC audio, 1920×1080, 30 seconds.
		const meta = probe(file);
		expect(meta.format.format_name).toContain('mp4');
		expect(Number(meta.format.duration)).toBeCloseTo(30, 0);
		const video = meta.streams.find((s) => s.codec_type === 'video')!;
		const audio = meta.streams.find((s) => s.codec_type === 'audio')!;
		expect(video).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080 });
		expect(audio.codec_name).toBe('aac');

		// Decodes cleanly from start to end, like any video player would.
		const errors = execFileSync('ffmpeg', [
			'-v',
			'error',
			'-i',
			file,
			'-f',
			'null',
			'-'
		]).toString();
		expect(errors).toBe('');

		// The saved frames match the preview: plain scene (with look), mid-crossfade, the photo, and
		// the caption's box.
		await page.getByRole('button', { name: 'Done' }).click();
		const checks: [number, number, number][] = [
			[2, 0.6, 0.6],
			[4, 0.6, 0.6],
			[10, 0.6, 0.6],
			[25, 0.6, 0.4]
		];
		for (const [t, fx, fy] of checks) {
			await seekTo(page, t);
			const expected = await previewPixel(page, fx, fy);
			const actual = exportedPixel(file, t, fx, fy, 1920, 1080);
			expect(close(actual, expected, 14), `at ${t}s: saved ${actual} vs preview ${expected}`).toBe(
				true
			);
		}
		// The caption is in the saved video: its dark box sits where the preview shows it.
		await seekTo(page, 21);
		const box = await page.locator('.text-box').first().boundingBox();
		const canvas = await page.locator('canvas[data-testid="preview"]').boundingBox();
		const fx = (box!.x + 6 - canvas!.x) / canvas!.width;
		const fy = (box!.y + box!.height / 2 - canvas!.y) / canvas!.height;
		const captionPreview = await previewPixel(page, fx, fy);
		const captionSaved = exportedPixel(file, 21, fx, fy, 1920, 1080);
		expect(captionPreview.every((v) => v < 70)).toBe(true);
		expect(close(captionSaved, captionPreview, 20)).toBe(true);

		// And the sound: music (220 Hz) is audible through the middle of the saved file.
		const pcm = execFileSync('ffmpeg', [
			'-v',
			'error',
			'-ss',
			'10',
			'-t',
			'1',
			'-i',
			file,
			'-ac',
			'1',
			'-ar',
			'8000',
			'-f',
			's16le',
			'-'
		]);
		let sum = 0;
		for (let i = 0; i < pcm.length; i += 2) sum += (pcm.readInt16LE(i) / 32768) ** 2;
		expect(Math.sqrt(sum / (pcm.length / 2))).toBeGreaterThan(0.02);
	});

	test('saving can be cancelled', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['long.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		await dialog.getByRole('button', { name: 'Save video' }).click();
		await expect(page.getByRole('progressbar', { name: 'Saving progress' })).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(
			page.getByRole('dialog', { name: 'Save video' }).getByRole('radiogroup', { name: 'Quality' })
		).toBeVisible();
	});

	test('falls back to WebM when MP4 can’t be made, and says so', async ({ page }, info) => {
		await openNewVideo(page);
		await page.evaluate(() => localStorage.setItem('scenes:force-webm', '1'));
		await importViaPicker(page, ['red.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		await dialog.getByRole('radio', { name: /Small file/ }).click();
		await expect(dialog.getByRole('note')).toContainText('WebM');
		const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
		await dialog.getByRole('button', { name: 'Save video' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('Untitled video.webm');
		const file = info.outputPath('export.webm');
		await download.saveAs(file);
		const meta = probe(file);
		expect(meta.streams.find((s) => s.codec_type === 'video')).toMatchObject({
			codec_name: 'vp9',
			width: 1280,
			height: 720
		});
		expect(meta.streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe('opus');
		expect(Number(meta.format.duration)).toBeCloseTo(7, 0);
	});
});
