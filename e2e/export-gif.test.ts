import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { importViaPicker, openNewVideo } from './helpers';

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

/** Red (0–6 s) with a blue card moving from x 0.2 (0 s) to x 0.8 (2 s); range 0.5–2.5 s. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await api(page, `s => {
		const c = s.addCardOverlay(0);
		s.setOverlayCard(c, { background: '#0000ff', rect: null });
		s.setOverlayBox(c, { x: 0.15, y: 0.35, w: 0.1, h: 0.3 });
		s.setOverlayTiming(c, 0, 6);
		const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
		const base = { x: 0.2, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
		s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [
			{ id: 'a', time: 0, values: base, easing: lin },
			{ id: 'b', time: 2, values: { ...base, x: 0.8 }, easing: lin }
		] })) }));
		s.setRange({ start: 0.5, end: 2.5 });
		s.deselect();
	}`);
}

async function openGif(page: Page) {
	await page.getByRole('button', { name: 'Save video' }).click();
	const dialog = page.getByRole('dialog', { name: 'Save video' });
	await dialog.getByRole('radiogroup', { name: 'Save as' }).getByRole('radio', { name: 'GIF' }).click();
	return dialog;
}

test.describe('Saving a GIF', () => {
	test.setTimeout(180_000);

	test('a range as a GIF: its size, frame rate and frames match the video', async ({ page }, info) => {
		await setup(page);
		const dialog = await openGif(page);
		await dialog.getByRole('radiogroup', { name: 'GIF width' }).getByRole('radio', { name: '320 px' }).click();
		await dialog.getByRole('radiogroup', { name: 'GIF frame rate' }).getByRole('radio', { name: '10 fps' }).click();
		await expect(dialog.getByTestId('export-summary')).toHaveText(/^320 × 180 · 10 fps · 2 sec · about /);
		await expect(dialog.getByTestId('gif-warning')).toHaveCount(0);
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await dialog.getByRole('button', { name: 'Save GIF' }).click();
		const d = await download;
		expect(d.suggestedFilename()).toBe('Untitled video.gif');
		const file = info.outputPath('clip.gif');
		await d.saveAs(file);
		const bytes = readFileSync(file);
		expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
		expect(bytes.toString('latin1')).toContain('NETSCAPE2.0'); // loops
		if (!hasFfmpeg) return;
		const frames = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'csv=p=0', file])
			.toString()
			.trim()
			.split(',')
			.map(Number);
		expect(frames.slice(0, 2)).toEqual([320, 180]);
		expect(frames[2]).toBe(20);
		// Frame 5 is 1.0 s: the card is halfway (x 0.5); frame 0 is 0.5 s (x 0.35).
		const pixel = (n: number, fx: number) => {
			const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n}),crop=1:1:${Math.floor(320 * fx)}:90`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
			return [raw[0], raw[1], raw[2]];
		};
		const blue = (p: number[]) => p[2] > 180 && p[0] < 90;
		expect(blue(pixel(5, 0.5))).toBe(true);
		expect(blue(pixel(0, 0.35))).toBe(true);
		expect(blue(pixel(0, 0.5))).toBe(false);
	});

	test('play once; a gentle warning when it gets long or heavy (it can still be saved)', async ({ page }, info) => {
		await setup(page);
		let dialog = await openGif(page);
		await dialog.getByRole('radiogroup', { name: 'Loop' }).getByRole('radio', { name: 'Once' }).click();
		await dialog.getByRole('radiogroup', { name: 'GIF width' }).getByRole('radio', { name: '320 px' }).click();
		await dialog.getByRole('switch', { name: /Dithering/ }).click();
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await dialog.getByRole('button', { name: 'Save GIF' }).click();
		const file = info.outputPath('once.gif');
		await (await download).saveAs(file);
		expect(readFileSync(file).toString('latin1')).not.toContain('NETSCAPE2.0');
		await page.getByRole('button', { name: 'Close' }).click();

		// The whole video at full size and 20 fps: heavy.
		dialog = await openGif(page);
		await dialog.getByRole('radiogroup', { name: 'What' }).getByRole('radio', { name: 'Whole video' }).click();
		await dialog.getByRole('radiogroup', { name: 'GIF width' }).getByRole('radio', { name: /^Full/ }).click();
		await dialog.getByRole('radiogroup', { name: 'GIF frame rate' }).getByRole('radio', { name: '20 fps' }).click();
		await expect(dialog.getByTestId('gif-warning')).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Save GIF' })).toBeEnabled();
	});

	test('animated WebP where the browser can make it: one file, every frame', async ({ page }, info) => {
		await setup(page);
		const dialog = await openGif(page);
		const webp = dialog.getByRole('radiogroup', { name: 'Animation format' });
		if (!(await webp.count())) test.skip(true, 'This browser can’t encode WebP');
		await webp.getByRole('radio', { name: 'Animated WebP' }).click();
		await expect(dialog.getByText(/not every app or site shows it/)).toBeVisible();
		await dialog.getByRole('radiogroup', { name: 'GIF width' }).getByRole('radio', { name: '320 px' }).click();
		await dialog.getByRole('radiogroup', { name: 'GIF frame rate' }).getByRole('radio', { name: '10 fps' }).click();
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await dialog.getByRole('button', { name: 'Save GIF' }).click();
		const d = await download;
		expect(d.suggestedFilename()).toBe('Untitled video.webp');
		const file = info.outputPath('clip.webp');
		await d.saveAs(file);
		const bytes = readFileSync(file);
		expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
		expect(bytes.subarray(12, 16).toString()).toBe('VP8X');
		// The browser itself reads it as a 20-frame animation, 320 × 180, with the card halfway at frame 5.
		const decoded = await page.evaluate(async (b64) => {
			const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			const dec = new (window as unknown as { ImageDecoder: new (o: object) => { tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } }; decode(o: object): Promise<{ image: VideoFrame }> } }).ImageDecoder({ data, type: 'image/webp' });
			await dec.tracks.ready;
			const frame = (await dec.decode({ frameIndex: 5 })).image;
			const c = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
			const ctx = c.getContext('2d')!;
			ctx.drawImage(frame, 0, 0);
			const p = ctx.getImageData(Math.floor(c.width * 0.5), 90, 1, 1).data;
			return { frames: dec.tracks.selectedTrack.frameCount, w: c.width, h: c.height, p: [p[0], p[1], p[2]] };
		}, bytes.toString('base64'));
		expect(decoded.frames).toBe(20);
		expect([decoded.w, decoded.h]).toEqual([320, 180]);
		expect(decoded.p[2]).toBeGreaterThan(160);
		expect(decoded.p[0]).toBeLessThan(100);
	});
});
