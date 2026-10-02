import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

/**
 * The range is always on the ruler: the whole video until an edge is moved (following the
 * video's length), then where it's put (clamped if the video gets shorter). Edges snap, the
 * range moves by dragging inside it, double-click resets it, right-click has its options; saving
 * and looping use it only when it's shorter than the video.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const stored = (page: Page) => api<{ start: number; end: number } | null>(page, 's => s.project.range ?? null');
const shown = (page: Page) => api<{ start: number; end: number }>(page, 's => s.range');
const rangeBox = async (page: Page) => (await page.getByTestId('range').boundingBox())!;

/** Red (0–4 s) then green (4–7 s). */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.keyboard.press('Escape');
}

/** Seconds to screen pixels on the timeline: from the range while it's the whole video. */
async function scale(page: Page) {
	const saved = await stored(page);
	await api(page, 's => s.live((p) => { p.range = null; })');
	const r = await rangeBox(page);
	const d = await api<number>(page, 's => s.duration');
	await api(page, `s => s.live((p) => { p.range = ${JSON.stringify(saved)}; })`);
	return { x0: r.x, pps: r.width / d };
}

/** Drag from (x, y) by dx in steps; returns a function that ends the drag. */
async function dragFrom(page: Page, x: number, y: number, dx: number, alt = false) {
	await page.mouse.move(x, y);
	await page.mouse.down();
	if (alt) await page.keyboard.down('Alt');
	await page.mouse.move(x + dx, y, { steps: 8 });
	return async () => {
		await page.mouse.up();
		if (alt) await page.keyboard.up('Alt');
	};
}

test.describe('The range, always on the ruler', () => {
	test.setTimeout(120_000);

	test('a new project shows it over the whole video, and it grows when a scene is added', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await page.keyboard.press('Escape');
		expect(await stored(page)).toBeNull(); // following the video
		expect(await shown(page)).toEqual({ start: 0, end: 4 });
		let { x0, pps } = await scale(page);
		let r = await rangeBox(page);
		expect(r.x - x0).toBeCloseTo(0, -1);
		expect(r.width).toBeCloseTo(4 * pps, -1);

		await api(page, `s => s.duplicateScene(s.project.scenes[0].id)`);
		await expect.poll(() => api<number>(page, 's => s.duration')).toBeGreaterThan(4.5);
		const d = await api<number>(page, 's => s.duration');
		expect(await shown(page)).toEqual({ start: 0, end: d });
		({ x0, pps } = await scale(page));
		r = await rangeBox(page);
		expect(r.width).toBeCloseTo(d * pps, -1);
	});

	test('dragging an edge sets it (with a live time label and snapping); then it keeps its place, clamped when the video gets shorter', async ({ page }) => {
		await setup(page);
		const { pps } = await scale(page);
		const end = (await page.locator('[data-range-edge="end"]').boundingBox())!;
		const gy = end.y + end.height - 4;
		// The end from 7 s to just short of 4 s: snaps to the cut.
		const done = await dragFrom(page, end.x + end.width / 2, gy, -pps * 3.04);
		await expect(page.getByTestId('range-label')).toHaveText(/^0:0\d\.\d\d$/);
		await done();
		await expect(page.getByTestId('range-label')).toHaveCount(0);
		expect((await stored(page))!.end).toBeCloseTo(4, 3);
		// Alt: no snapping.
		const e2 = (await page.locator('[data-range-edge="end"]').boundingBox())!;
		const altDone = await dragFrom(page, e2.x + e2.width / 2, gy, pps * 0.05, true);
		await altDone();
		expect((await stored(page))!.end).toBeGreaterThan(4.02);

		// Kept: adding to the video doesn't move it...
		await api(page, `s => s.setRange({ start: 1, end: 6 })`);
		await api(page, `s => s.duplicateScene(s.project.scenes[1].id)`);
		expect(await stored(page)).toEqual({ start: 1, end: 6 });
		// ...and when the video gets shorter than its end, its end comes back to the video's end.
		await api(page, `s => { s.deleteScene(s.project.scenes[2].id); s.deleteScene(s.project.scenes[1].id); }`);
		expect(await stored(page)).toEqual({ start: 1, end: 4 });
	});

	test('drag inside it to move it; a click inside still moves the playhead; double-click resets it', async ({ page }, info) => {
		await setup(page);
		await api(page, 's => s.setRange({ start: 1, end: 2 })');
		await page.locator('.storyboard').screenshot({ path: info.outputPath('ruler.png') });
		const { x0, pps } = await scale(page);
		const r = await rangeBox(page);
		const y = r.y + 6;
		const done = await dragFrom(page, r.x + r.width / 2, y, pps * 2.5);
		await expect(page.getByTestId('range-label')).toBeVisible();
		await done();
		const moved = (await stored(page))!;
		expect(moved.end - moved.start).toBeCloseTo(1, 3);
		expect(moved.start).toBeGreaterThan(3.2);
		// A click inside: the playhead goes there, the range stays.
		const r2 = await rangeBox(page);
		await page.mouse.click(r2.x + r2.width / 2, y);
		expect(await api<number>(page, 's => s.time')).toBeCloseTo(moved.start + 0.5, 1);
		expect(await stored(page)).toEqual(moved);
		// Clicking elsewhere on the ruler moves the playhead too.
		await page.mouse.click(x0 + pps * 0.5, y);
		expect(await api<number>(page, 's => s.time')).toBeCloseTo(0.5, 1);
		// Double-click: the whole video again.
		await page.mouse.dblclick(r2.x + r2.width / 2, y);
		expect(await stored(page)).toBeNull();
		expect(await shown(page)).toEqual({ start: 0, end: 7 });
	});

	test('the ruler’s right-click menu sets the start and end where clicked; I and O at the playhead', async ({ page }) => {
		await setup(page);
		const { x0, pps } = await scale(page);
		const ruler = (await page.locator('.ruler').boundingBox())!;
		await page.mouse.click(x0 + pps * 2, ruler.y + 6, { button: 'right' });
		await page.getByRole('menuitem', { name: 'Set start here' }).click();
		expect((await stored(page))!.start).toBeCloseTo(2, 1);
		await page.mouse.click(x0 + pps * 5, ruler.y + 6, { button: 'right' });
		await page.getByRole('menuitem', { name: 'Set end here' }).click();
		expect((await stored(page))!.end).toBeCloseTo(5, 1);
		await seekTo(page, 1);
		await page.keyboard.press('i');
		await seekTo(page, 6);
		await page.keyboard.press('o');
		expect(await stored(page)).toEqual({ start: 1, end: 6 });
	});

	test('saving and looping use it only when it’s shorter than the video', async ({ page }) => {
		await setup(page);
		// The whole video: no choice to make.
		await page.getByRole('button', { name: 'Save video' }).click();
		let dialog = page.getByRole('dialog', { name: 'Save video' });
		await expect(dialog.getByRole('radiogroup', { name: 'What' })).toHaveCount(0);
		await expect(dialog.getByTestId('export-summary')).toContainText('· 7 sec ·');
		await page.keyboard.press('Escape');
		await api(page, 's => s.setLoop(true)');
		expect(await api(page, 's => s.loopRange()')).toEqual({ start: 0, end: 7 });

		// Part of it: Range offered and chosen, with its start and end.
		await api(page, 's => s.setRange({ start: 2, end: 5 })');
		await page.getByRole('button', { name: 'Save video' }).click();
		dialog = page.getByRole('dialog', { name: 'Save video' });
		const what = dialog.getByRole('radiogroup', { name: 'What' });
		await expect(what.getByRole('radio', { name: /Range/ })).toHaveAttribute('aria-checked', 'true');
		await expect(what.getByRole('radio', { name: /Range/ })).toContainText('Range 0:02.00 – 0:05.00');
		await expect(dialog.getByTestId('export-summary')).toContainText('· 3 sec ·');
		await page.keyboard.press('Escape');
		expect(await api(page, 's => s.loopRange()')).toEqual({ start: 2, end: 5 });
	});
});
