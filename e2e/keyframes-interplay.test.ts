import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

type RGB = [number, number, number];
const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const near = (a: RGB, b: RGB, tol = 30) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

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

async function redScene(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
}

const LIN = `{ kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 }`;
const EIO = `{ kind: 'bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 }`;

test.describe('Keyframes with other features', () => {
	test('entrance and exit play on top of keyframes: a fade multiplies the keyframed opacity', async ({ page }) => {
		await redScene(page);
		// A blue card, half see-through from its keyframes, fading in over its first 0.4 s.
		await api(page, `s => {
			const c = s.addCardOverlay(1);
			s.setOverlayCard(c, { background: '#0000ff', rect: null });
			s.setOverlayBox(c, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
			s.setOverlayTiming(c, 1, 4);
			s.setOverlayAnimation(c, 'enter', 'fade');
			const base = { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 };
			s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [{ id: 'a', time: 0, values: base, easing: ${LIN} }] })) }));
			s.deselect();
		}`);
		// After the entrance: half blue over red.
		await seekTo(page, 3);
		expect(near(await pixel(page, 0.5, 0.5), [128, 0, 128])).toBe(true);
		// Partway in, less than that (0.5 × the fade).
		await seekTo(page, 1.1);
		const early = await pixel(page, 0.5, 0.5);
		expect(early[2]).toBeLessThan(110);
		expect(early[2]).toBeGreaterThan(5);
	});

	test('slide up offsets the keyframed position', async ({ page }) => {
		await redScene(page);
		const id = await api<string>(page, `s => {
			const c = s.addCardOverlay(1);
			s.setOverlayTiming(c, 1, 4);
			s.setOverlayAnimation(c, 'enter', 'slide-up');
			const base = { x: 0.3, y: 0.4, scaleX: 1.5, scaleY: 1.5, rotation: 0, opacity: 1 };
			s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [{ id: 'a', time: 0, values: base, easing: ${LIN} }] })) }));
			return c;
		}`);
		// The keyframed values don't include the slide; the drawing does.
		expect((await api<{ y: number }>(page, `s => s.itemValues('${id}', 1.05)`)).y).toBeCloseTo(0.4, 5);
		// Just below the box's resting bottom edge: covered while it slides up, red once it's in place.
		const box = await api<{ h: number }>(page, `s => s.project.overlays[0].box`);
		const restingBottom = 0.4 + (box.h * 1.5) / 2;
		await seekTo(page, 1.05);
		expect(near(await pixel(page, 0.3, restingBottom + 0.02), [255, 0, 0])).toBe(false);
		await seekTo(page, 3);
		expect(near(await pixel(page, 0.3, restingBottom + 0.02), [255, 0, 0])).toBe(true);
	});

	test('splitting a layer with keyframes keeps exactly the same motion in both halves', async ({ page }) => {
		await redScene(page);
		const id = await api<string>(page, `s => {
			const c = s.addCardOverlay(0);
			s.setOverlayTiming(c, 0, 5);
			const base = { x: 0.2, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
			s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [
				{ id: 'a', time: 1, values: base, easing: ${EIO} },
				{ id: 'b', time: 3, values: { ...base, x: 0.8, rotation: 90, scaleX: 2, scaleY: 2 }, easing: { kind: 'overshoot' } },
				{ id: 'c', time: 4, values: { ...base, x: 0.5 }, easing: ${LIN} }
			] })) }));
			return c;
		}`);
		const times = Array.from({ length: 50 }, (_, i) => i * 0.1);
		const before = await api<number[][]>(page, `s => ${JSON.stringify(times)}.map((t) => { const v = s.itemValues('${id}', t); return [v.x, v.rotation, v.scaleX]; })`);
		// Split inside the eased stretch (1.7 s), then inside the overshoot (3.4 s), with S.
		await page.locator(`[data-item-id="${id}"] .item`).click();
		await seekTo(page, 1.7);
		await page.keyboard.press('s');
		expect(await api<number>(page, 's => s.project.overlays.length')).toBe(2);
		await seekTo(page, 3.4);
		await page.keyboard.press('s');
		expect(await api<number>(page, 's => s.project.overlays.length')).toBe(3);
		const after = await api<number[][]>(page, `s => ${JSON.stringify(times)}.map((t) => {
			const p = s.placedOverlays.find((x) => t >= x.start - 1e-9 && t < x.end) ?? s.placedOverlays.at(-1);
			const v = s.itemValues(p.overlay.id, t);
			return [v.x, v.rotation, v.scaleX];
		})`);
		after.forEach((v, i) => v.forEach((x, j) => expect(x, `t=${times[i]} [${j}]`).toBeCloseTo(before[i][j], 4)));
		// A keyframe at the split point on both sides of the eased split.
		const kf = await api<{ start: number; times: number[] }[]>(page, 's => s.project.overlays.map((o) => ({ start: o.start, times: o.keyframes.map((k) => Math.round(k.time * 1000) / 1000) }))');
		expect(kf[0].times).toContain(1.7);
		expect(kf[1].times[0]).toBe(0);
		// The picture at the split looks the same as just before it (no jump).
		await seekTo(page, 1.69);
		const a = await pixel(page, 0.5, 0.5);
		await seekTo(page, 1.71);
		expect(near(await pixel(page, 0.5, 0.5), a, 6)).toBe(true);
	});

	test('splitting words keeps the motion and doesn’t fade out at the split', async ({ page }) => {
		await redScene(page);
		await api(page, `s => {
			s.seek(0.5);
			s.addText('title');
			s.stopEditingText();
			const base = { x: 0.3, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
			s.edit('k', (p) => ({ ...p, texts: p.texts.map((t) => ({ ...t, keyframes: [
				{ id: 'a', time: 0, values: base, easing: ${EIO} },
				{ id: 'b', time: 2.5, values: { ...base, x: 0.7, scaleX: 3, scaleY: 3 }, easing: ${LIN} }
			] })) }));
		}`);
		const id = await api<string>(page, 's => s.project.texts[0].id');
		const times = Array.from({ length: 30 }, (_, i) => 0.5 + i * 0.1);
		const before = await api<number[]>(page, `s => ${JSON.stringify(times)}.map((t) => s.itemValues('${id}', t).x)`);
		await page.locator(`[data-item-id="${id}"] .item`).click();
		await seekTo(page, 1.6);
		await page.keyboard.press('s');
		const after = await api<number[]>(page, `s => ${JSON.stringify(times)}.map((t) => { const w = s.project.texts.find((x) => t >= x.start - 1e-9 && t < x.start + x.duration); return s.itemValues(w.id, t).x; })`);
		after.forEach((x, i) => expect(x).toBeCloseTo(before[i], 4));
		const first = await api<{ exitFade: boolean; duration: number }>(page, 's => s.project.texts[0]');
		expect(first.exitFade).toBe(false);
		// The second half has no entrance (it carries on).
		expect(await api<string>(page, 's => s.project.texts[1].animation')).toBe('none');
	});
});
