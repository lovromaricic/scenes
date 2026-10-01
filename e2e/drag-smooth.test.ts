import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

/**
 * Dragging items and their edges is smooth: the edge follows the cursor (whole frames only), the
 * width grows a little on every move and never jumps back, the snap line stays put while snapped,
 * the label shows the live length (or start), and a whole drag is one autosave and one undo step.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;

/** Count project writes to IndexedDB and undo steps from here on (after saving what's pending). */
async function instrument(page: Page) {
	await api(page, 's => s.flushSave()');
	await page.evaluate(() => {
		const w = window as unknown as { __saves: number };
		w.__saves = 0;
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
			if (this.name === 'projects') w.__saves++;
			return put.apply(this, args);
		};
	});
}
const saves = (page: Page) => page.evaluate(() => (window as unknown as { __saves: number }).__saves);
const undoSteps = (page: Page) => api<number>(page, 's => s.history.past.length');

/**
 * Ten tracks, many items: 3 scenes (red, green, blue), a photo layer (0–3 s) on Overlay 1, and
 * cards spread over nine more overlay tracks. Returns the photo layer's id.
 */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm', 'yellow.jpg'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 4, / })).toBeVisible();
	await page.getByRole('button', { name: /^Scene 4, / }).click();
	await page.keyboard.press('Delete');
	await expect(page.getByRole('button', { name: /^Scene 4, / })).toHaveCount(0);
	const id = await api<string>(page, `s => {
		const yellow = Object.values(s.media).find((m) => m.name === 'yellow.jpg').id;
		const low = s.project.tracks.find((t) => t.kind === 'overlay').id;
		const photo = s.addOverlayFromMedia(yellow, 0, low);
		s.setOverlayTiming(photo, 0, 3);
		for (let k = 0; k < 9; k++) {
			const t = s.addTrack('overlay', 0);
			for (let j = 0; j < 3; j++) {
				const c = s.addCardOverlay(j * 3 + (k % 3) * 0.7, t);
				s.setOverlayTiming(c, j * 3 + (k % 3) * 0.7, 1.6);
			}
		}
		return photo;
	}`);
	// The photo's track in view, and selected.
	await page.locator(`[data-item-id="${id}"]`).scrollIntoViewIfNeeded();
	await page.locator(`[data-item-id="${id}"] .item`).click();
	await seekTo(page, 8);
	return id;
}

type Sample = { width: number; label: string; snapX: number | null };

/** Drag from (x, y) by `dx` in `steps` steps, sampling after each (one animation frame later). */
async function dragSampling(page: Page, selector: string, x: number, y: number, dx: number, steps: number, alt = false) {
	const out: Sample[] = [];
	await page.mouse.move(x, y);
	await page.mouse.down();
	if (alt) await page.keyboard.down('Alt');
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(x + (dx * i) / steps, y);
		out.push(
			await page.evaluate(async (sel) => {
				await new Promise((r) => requestAnimationFrame(() => r(null)));
				const el = document.querySelector(sel) as HTMLElement;
				const line = document.querySelector('.snap-line') as HTMLElement | null;
				const label = document.querySelector('[data-testid="item-drag-label"]')?.textContent?.trim() ?? '';
				return { width: el.getBoundingClientRect().width, label, snapX: line ? line.getBoundingClientRect().x : null };
			}, selector)
		);
	}
	await page.mouse.up();
	if (alt) await page.keyboard.up('Alt');
	return out;
}

test.describe('Smooth dragging', () => {
	test.setTimeout(120_000);

	test('trimming a photo layer’s right edge: follows the cursor, live label, one save and one undo step', async ({ page }) => {
		const id = await setup(page);
		const slot = `[data-item-id="${id}"]`;
		const handle = page.locator(`${slot} [data-trim="end"]`);
		const h = (await handle.boundingBox())!;
		const scene = (await page.locator('.card-slot').first().boundingBox())!;
		const pps = scene.width / 4;
		await instrument(page);
		const saves0 = await saves(page);
		const undo0 = await undoSteps(page);

		// 60 moves of 2 px, with Alt (no snapping): the width follows every move.
		const free = await dragSampling(page, slot, h.x + h.width / 2, h.y + h.height / 2, 120, 60, true);
		const widths = free.map((s) => s.width);
		for (let i = 1; i < widths.length; i++) {
			const step = widths[i] - widths[i - 1];
			expect(step, `move ${i}`).toBeGreaterThanOrEqual(-0.01); // never back
			expect(step, `move ${i}`).toBeLessThan(2 + pps / 30 + 1); // no jumps (a frame at most)
		}
		// It actually grew with the cursor: 120 px, within a frame.
		expect(widths.at(-1)! - widths[0]).toBeGreaterThan(120 - 2 - pps / 30 - 1);
		// The label shows the length, live, in tenths of a second.
		// (The first move is under the 3 px it takes to start a drag.)
		expect(free[2].label).toMatch(/^\d+\.\d s$/);
		expect(new Set(free.map((s) => s.label)).size).toBeGreaterThan(5);
		// The length is a whole number of frames.
		const len = await api<number>(page, `s => s.project.overlays.find((o) => o.id === '${id}').duration`);
		expect(Math.abs(len * 30 - Math.round(len * 30))).toBeLessThan(1e-6);

		// One undo step and one save for the whole drag.
		await page.waitForTimeout(1500); // the autosave waits a moment
		expect(await undoSteps(page)).toBe(undo0 + 1);
		expect(await saves(page)).toBe(saves0 + 1);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
		expect(await api<number>(page, `s => s.project.overlays.find((o) => o.id === '${id}').duration`)).toBeCloseTo(3, 6);
	});

	test('snapping holds steady: one snap line at the target, released only when clearly away', async ({ page }) => {
		const id = await setup(page);
		const slot = `[data-item-id="${id}"]`;
		const handle = page.locator(`${slot} [data-trim="end"]`);
		const h = (await handle.boundingBox())!;
		const scene = (await page.locator('.card-slot').first().boundingBox())!;
		const pps = scene.width / 4;
		// From 3 s towards the cut at 4 s, in 1 px steps, past it by 20 px.
		const samples = await dragSampling(page, slot, h.x + h.width / 2, h.y + h.height / 2, pps + 20, Math.round(pps + 20));
		// Snapped stretches (consecutive moves snapped): in each, the line stays at one place, at the
		// item's edge, and the width doesn't change; and it doesn't flicker (each target is snapped
		// to over a run of moves, not on and off).
		const runs: Sample[][] = [];
		for (const x of samples) {
			const last = runs.at(-1);
			if (x.snapX === null) continue;
			if (last && last.at(-1) === samples[samples.indexOf(x) - 1] && Math.round(last[0].snapX!) === Math.round(x.snapX)) last.push(x);
			else runs.push([x]);
		}
		expect(runs.length).toBeGreaterThan(0);
		// Each target appears as one run only (no flicker), and runs are long enough to see.
		const places = runs.map((r) => Math.round(r[0].snapX!));
		expect(new Set(places).size).toBe(places.length);
		for (const r of runs) {
			expect(r.length).toBeGreaterThanOrEqual(8);
			expect(new Set(r.map((x) => Math.round(x.width))).size).toBe(1);
		}
		// The cut at 4 s is one of them.
		const box = (await page.locator('.card-slot').first().boundingBox())!;
		expect(places.some((p) => Math.abs(p - (box.x + box.width)) < 12)).toBe(true);
	});

	test('moving an item: smooth, the label shows the start, one save and one undo step', async ({ page }) => {
		const id = await setup(page);
		const slot = `[data-item-id="${id}"]`;
		const b = (await page.locator(`${slot} .item`).boundingBox())!;
		await instrument(page);
		const saves0 = await saves(page);
		const undo0 = await undoSteps(page);
		const xs: number[] = [];
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		await page.keyboard.down('Alt');
		let label = '';
		for (let i = 1; i <= 40; i++) {
			await page.mouse.move(b.x + b.width / 2 + i * 2, b.y + b.height / 2);
			const s = await page.evaluate(async (sel) => {
				await new Promise((r) => requestAnimationFrame(() => r(null)));
				return {
					x: (document.querySelector(sel) as HTMLElement).getBoundingClientRect().x,
					label: document.querySelector('[data-testid="item-drag-label"]')?.textContent?.trim() ?? ''
				};
			}, slot);
			xs.push(s.x);
			label = s.label;
		}
		await page.mouse.up();
		await page.keyboard.up('Alt');
		for (let i = 1; i < xs.length; i++) {
			expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(-0.01);
			expect(xs[i] - xs[i - 1]).toBeLessThan(6);
		}
		expect(label).toMatch(/^\d+:\d\d\.\d$/);
		await page.waitForTimeout(1500);
		expect(await undoSteps(page)).toBe(undo0 + 1);
		expect(await saves(page)).toBe(saves0 + 1);
	});

	test('trimming a scene’s end: the card follows smoothly, whole frames, one save and one undo step', async ({ page }) => {
		await setup(page);
		const card = page.locator('.card-slot').first();
		await card.locator('.card').click();
		const handle = card.locator('.trim-handle.end');
		const h = (await handle.boundingBox())!;
		await instrument(page);
		const saves0 = await saves(page);
		const undo0 = await undoSteps(page);
		// Shorten it: 40 moves of 2 px to the left.
		// (By its upper part: the transition button sits over the middle of the edge.)
		const samples = await dragSampling(page, '.card-slot', h.x + h.width / 2, h.y + 12, -80, 40, true);
		const widths = samples.map((x) => x.width);
		for (let i = 1; i < widths.length; i++) {
			expect(widths[i] - widths[i - 1]).toBeLessThanOrEqual(0.01);
			expect(widths[i - 1] - widths[i]).toBeLessThan(6);
		}
		expect(widths[0] - widths.at(-1)!).toBeGreaterThan(60);
		await page.waitForTimeout(1500);
		expect(await undoSteps(page)).toBe(undo0 + 1);
		expect(await saves(page)).toBe(saves0 + 1);
		const len = await api<number>(page, 's => s.placed[0].duration');
		expect(Math.abs(len * 30 - Math.round(len * 30))).toBeLessThan(1e-6);
	});
});
