import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

/**
 * Keyframes as data (added from code here; the buttons come in section 3): what the preview and
 * the saved video draw at each moment, and how scene keyframes follow the clip.
 */

type RGB = [number, number, number];
const near = (a: RGB, b: RGB, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const RED: RGB = [255, 0, 0];
const GREEN: RGB = [0, 255, 0];
const BLUE: RGB = [0, 0, 255];

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;

async function pixel(page: Page, fx: number, fy: number): Promise<RGB> {
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

/** Pixels of the saved video at [time, x, y] points (4 × 4 patches, averaged). */
async function savedPixels(page: Page, file: string, points: [number, number, number][]): Promise<RGB[]> {
	await page.getByRole('button', { name: 'Save video' }).click();
	const download = page.waitForEvent('download', { timeout: 120_000 });
	await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
	await (await download).saveAs(file);
	await page.keyboard.press('Escape');
	const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
		.toString()
		.trim()
		.split(',')
		.map(Number);
	return points.map(([t, x, y]) => {
		const raw = execFileSync('ffmpeg', [
			'-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1',
			'-vf', `crop=4:4:${Math.floor(w * x) - 2}:${Math.floor(h * y) - 2}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
		]);
		return [0, 1, 2].map((c) => {
			let sum = 0;
			for (let k = 0; k < 16; k++) sum += raw[k * 3 + c];
			return Math.round(sum / 16);
		}) as RGB;
	});
}

test.describe('Keyframes: the model', () => {
	test.setTimeout(180_000);

	test('a keyframed card moves, grows, turns and fades, the same in the preview and the saved video', async ({ page }, info) => {
		await openNewVideo(page);
		await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		// A blue square (144 px in 1280 × 720): left at 0 s; right, twice the size and turned 45°
		// at 2 s; faded out at 3 s.
		await api(page, `s => {
			const c = s.addCardOverlay(0);
			s.setOverlayCard(c, { background: '#0000ff', rect: null });
			s.setOverlayBox(c, { x: 0.2 - 0.05625, y: 0.4, w: 0.1125, h: 0.2 });
			s.setOverlayTiming(c, 0, 6);
			const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
			const base = { x: 0.2, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
			s.edit('Keyframes', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [
				{ id: 'a', time: 0, values: base, easing: lin },
				{ id: 'b', time: 2, values: { ...base, x: 0.8, scaleX: 2, scaleY: 2, rotation: 45 }, easing: lin },
				{ id: 'c', time: 3, values: { ...base, x: 0.8, scaleX: 2, scaleY: 2, rotation: 45, opacity: 0 }, easing: lin }
			] })) }));
			s.deselect();
		}`);
		// [time, x, y, colour]: halfway at 1 s; at 2 s a diamond (turned square) around x = 0.8:
		// 192 px to the right is inside it, 130 px right and down isn't (an upright square would
		// cover both); half faded at 2.5 s; gone at 3.5 s.
		const checks: [number, number, number, RGB][] = [
			[1, 0.5, 0.5, BLUE],
			[1, 0.2, 0.5, RED],
			[2, 0.8, 0.5, BLUE],
			[2, 0.8 + 192 / 1280, 0.5, BLUE],
			[2, 0.8 + 130 / 1280, 0.5 + 130 / 720, RED],
			// Halfway through the fade: half blue over red.
			[2.5, 0.8, 0.5, [128, 0, 128]],
			[3.5, 0.8, 0.5, RED]
		];
		for (const [t, x, y, want] of checks) {
			await seekTo(page, t);
			const got = await pixel(page, x, y);
			expect(near(got, want), `preview at ${t}s (${x.toFixed(3)}, ${y.toFixed(3)}): ${got}`).toBe(true);
		}
		if (!hasFfmpeg) return;
		const saved = await savedPixels(page, info.outputPath('card.mp4'), checks.map(([t, x, y]) => [t, x, y]));
		saved.forEach((got, i) => expect(near(got, checks[i][3]), `saved ${checks[i].slice(0, 3)}: ${got}`).toBe(true));
	});

	test('scene framing keyframes follow the clip: a speed change keeps the zoom on the same moments', async ({ page }) => {
		await openNewVideo(page);
		// Quadrants: red top left, green top right, blue bottom left, yellow bottom right.
		await importViaPicker(page, ['quads.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await api(page, `s => {
			const id = s.project.scenes[0].id;
			const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
			s.edit('Framing', (p) => ({ ...p, scenes: p.scenes.map((sc) => ({ ...sc,
				frame: { mode: 'custom', bars: 'black', zoom: 1, x: 0, y: 0 },
				keyframes: [
					{ id: 'a', time: 2, values: { x: 0, y: 0, zoom: 1 }, easing: lin },
					{ id: 'b', time: 4, values: { x: 0.25, y: 0.25, zoom: 2 }, easing: lin }
				] })) }));
			s.deselect();
		}`);
		// At 1×: whole picture until 2 s; zoomed into the top-left (red) from 4 s.
		await seekTo(page, 1);
		expect(near(await pixel(page, 0.75, 0.25), GREEN)).toBe(true);
		await seekTo(page, 4.5);
		expect(near(await pixel(page, 0.6, 0.5), RED)).toBe(true);
		expect(near(await pixel(page, 0.9, 0.5), GREEN)).toBe(true);

		// 2×: the same moments of the clip are at half the times.
		await api(page, `s => s.setSceneSpeed(s.project.scenes[0].id, 2)`);
		const zoomAt = (t: number) => api<number>(page, `s => s.frameValues(s.project.scenes[0].id, ${t}).zoom`);
		expect(await zoomAt(1)).toBeCloseTo(1);
		expect(await zoomAt(1.5)).toBeCloseTo(1.5); // source 3 s: halfway
		expect(await zoomAt(2)).toBeCloseTo(2);
		await seekTo(page, 2.2);
		expect(near(await pixel(page, 0.6, 0.5), RED)).toBe(true);
	});

	test('words that grow are drawn sharp; scale and rotation fields are in the settings', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await page.getByRole('button', { name: /^Words Titles/ }).click();
		await page.getByRole('button', { name: /^Title/ }).click();
		await page.keyboard.press('Escape');
		const settings = page.getByRole('complementary', { name: 'Settings' });
		await settings.getByRole('spinbutton', { name: 'Words scale' }).fill('300');
		await settings.getByRole('spinbutton', { name: 'Words rotation' }).fill('10');
		const t = await api<{ scaleX: number; scaleY: number; rotation: number }>(page, 's => s.project.texts[0]');
		expect(t).toMatchObject({ scaleX: 3, scaleY: 3, rotation: 10 });
		// Unlinked: width and height separately.
		await settings.getByRole('button', { name: /scale together \(unlink\)/ }).click();
		await settings.getByRole('spinbutton', { name: 'Words height scale' }).fill('150');
		expect(await api<number>(page, 's => s.project.texts[0].scaleY')).toBeCloseTo(1.5);
		expect(await api<number>(page, 's => s.project.texts[0].scaleX')).toBeCloseTo(3);
		// On the preview the words' box is scaled and turned the same way.
		const box = page.locator('.text-box').first();
		await expect(box).toHaveCSS('rotate', '10deg');
	});
});
