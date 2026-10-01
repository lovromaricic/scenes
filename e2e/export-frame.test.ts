import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

type RGB = [number, number, number];
const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const near = (a: RGB, b: RGB, tol = 25) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

/** Pixel of a picture or video file (at time t for videos), via ffmpeg. */
function filePixel(file: string, fx: number, fy: number, t?: number): { rgb: RGB; size: [number, number] } {
	const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
		.toString()
		.trim()
		.split(',')
		.map(Number);
	const args = ['-v', 'error'];
	if (t !== undefined) args.push('-ss', String(t));
	// A 2 × 2 patch at even coordinates (video frames are subsampled in pairs).
	const even = (v: number) => Math.floor(v / 2) * 2;
	args.push('-i', file, '-frames:v', '1', '-vf', `crop=2:2:${even(w * fx)}:${even(h * fy)}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
	const raw = execFileSync('ffmpeg', args);
	return { rgb: [raw[0], raw[1], raw[2]], size: [w, h] };
}

async function previewPixel(page: Page, fx: number, fy: number): Promise<RGB> {
	await expect.poll(() => api<boolean>(page, 's => s.player.isFrameReady()'), { timeout: 10_000 }).toBe(true);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	return page.evaluate(
		({ fx, fy }) => {
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const s = (window as unknown as { __scenes: { player: { readPixel(x: number, y: number): number[] } } }).__scenes;
			const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
			return [p[0], p[1], p[2]] as RGB;
		},
		{ fx, fy }
	);
}

/** Red scene; a blue card moving from x 0.2 (0 s) to x 0.8 (2 s). */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await api(page, `s => {
		const c = s.addCardOverlay(0);
		s.setOverlayCard(c, { background: '#0000ff', rect: null });
		s.setOverlayBox(c, { x: 0.15, y: 0.4, w: 0.1, h: 0.2 });
		s.setOverlayTiming(c, 0, 6);
		const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
		const base = { x: 0.2, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
		s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [
			{ id: 'a', time: 0, values: base, easing: lin },
			{ id: 'b', time: 2, values: { ...base, x: 0.8 }, easing: lin }
		] })) }));
		s.deselect();
	}`);
	await seekTo(page, 1);
}

test.describe('Saving the current frame', () => {
	test.setTimeout(180_000);

	test('as PNG from the dialog: full size, exactly what the preview and the video show there', async ({ page }, info) => {
		await setup(page);
		const preview = await previewPixel(page, 0.5, 0.5);
		expect(near(preview, [0, 0, 255])).toBe(true);
		const scene = await previewPixel(page, 0.2, 0.5);
		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		await dialog.getByRole('radiogroup', { name: 'Save as' }).getByRole('radio', { name: 'Current frame' }).click();
		// A frame is at the playhead: no What choice.
		await expect(dialog.getByRole('radiogroup', { name: 'What' })).toHaveCount(0);
		await expect(dialog.getByTestId('export-summary')).toHaveText(/^1280 × 720 · 1 frame at 0:01 · /);
		const download = page.waitForEvent('download');
		await dialog.getByRole('button', { name: 'Save frame' }).click();
		const d = await download;
		expect(d.suggestedFilename()).toMatch(/^Untitled video 0-01\.00\.png$/);
		const file = info.outputPath('frame.png');
		await d.saveAs(file);
		expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
		await expect(page.getByRole('dialog', { name: 'Your frame is ready' })).toBeVisible();
		if (!hasFfmpeg) return;
		const png = filePixel(file, 0.5, 0.5);
		expect(png.size).toEqual([1280, 720]);
		expect(near(png.rgb, preview, 6)).toBe(true);
		// Where the card isn't any more, the scene (as the preview shows it).
		expect(near(filePixel(file, 0.2, 0.5).rgb, scene, 6)).toBe(true);

		// The video export at the same moment shows the same.
		await page.getByRole('button', { name: 'Close' }).click();
		await page.getByRole('button', { name: 'Save video' }).click();
		const video = page.waitForEvent('download', { timeout: 120_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		const mp4 = info.outputPath('frame.mp4');
		await (await video).saveAs(mp4);
		expect(near(filePixel(mp4, 0.5, 0.5, 1).rgb, png.rgb)).toBe(true);
	});

	test('as JPG with a quality slider: a smaller file', async ({ page }, info) => {
		await setup(page);
		const save = async (format: 'PNG' | 'JPG', quality?: string) => {
			await page.getByRole('button', { name: 'Save video' }).click();
			const dialog = page.getByRole('dialog', { name: 'Save video' });
			await dialog.getByRole('radio', { name: 'Current frame' }).click();
			await dialog.getByRole('radiogroup', { name: 'Picture format' }).getByRole('radio', { name: format }).click();
			if (quality) await dialog.getByRole('slider', { name: 'JPG quality' }).fill(quality);
			const download = page.waitForEvent('download');
			await dialog.getByRole('button', { name: 'Save frame' }).click();
			const d = await download;
			const file = info.outputPath(d.suggestedFilename());
			await d.saveAs(file);
			await page.getByRole('button', { name: 'Close' }).click();
			return file;
		};
		const png = await save('PNG');
		const jpg = await save('JPG', '0.6');
		expect(jpg).toMatch(/\.jpg$/);
		const bytes = readFileSync(jpg);
		expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
		expect(bytes.length).toBeLessThan(readFileSync(png).length);
	});

	test('from the preview’s right-click menu, and with F', async ({ page }) => {
		await setup(page);
		const preview = page.getByTestId('preview');
		await preview.click({ button: 'right', position: { x: 30, y: 30 } });
		const menu = page.getByRole('menu', { name: 'Frame' });
		await expect(menu).toBeVisible();
		let download = page.waitForEvent('download');
		await menu.getByRole('menuitem', { name: 'Save this frame as JPG' }).click();
		expect((await download).suggestedFilename()).toMatch(/\.jpg$/);
		download = page.waitForEvent('download');
		await page.keyboard.press('f');
		expect((await download).suggestedFilename()).toMatch(/0-01\.00\.png$/);
		// Listed in the shortcuts.
		await page.keyboard.press('?');
		await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Save the frame at the playhead as a PNG');
	});
});
