import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * Keyframes on the timeline: the same red diamond for every easing, in a strip along the item's
 * bottom (never over its name), larger when selected; fully visible and clickable at the item's
 * edges; time and easing in the tooltip; easing lines between keyframes on the selected item.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const kf = (page: Page, id: string) => page.locator(`.kf[data-keyframe="${id}"]`);

/** Words 0–4 s with keyframes at its start (linear), 2 s (ease in and out), 2.08 s and its end (hold). */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	return api<string>(page, `s => {
		s.addText('caption');
		s.stopEditingText();
		const id = s.selectedId;
		s.setTextWords(id, 'Keyframed words');
		s.setTextTiming(id, 0, 4);
		const base = s.itemValues(id, 0);
		const bez = (x1, y1, x2, y2) => ({ kind: 'bezier', x1, y1, x2, y2 });
		s.edit('k', (p) => ({ ...p, texts: p.texts.map((t) => t.id === id ? { ...t, keyframes: [
			{ id: 'a', time: 0, values: base, easing: bez(0, 0, 1, 1) },
			{ id: 'n', time: 2.08, values: { ...base, x: 0.6 }, easing: bez(0.42, 0, 0.58, 1) },
			{ id: 'b', time: 2, values: { ...base, x: 0.55 }, easing: bez(0.42, 0, 0.58, 1) },
			{ id: 'c', time: 4, values: { ...base, x: 0.7 }, easing: { kind: 'hold' } }
		] } : t) }));
		s.deselect();
		s.seek(1);
		return id;
	}`);
}

/** The diamond's drawn style (its ::after). */
const look = (page: Page, id: string) =>
	kf(page, id).evaluate((el) => {
		const cs = getComputedStyle(el, '::after');
		return { bg: cs.backgroundColor, shadow: cs.boxShadow, rotate: cs.rotate, scale: cs.scale, w: el.getBoundingClientRect().width };
	});

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
	a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test.describe('Keyframe diamonds', () => {
	test.setTimeout(120_000);

	test('one red diamond with a white edge for every easing; selected ones larger with a shadow', async ({ page }, info) => {
		await setup(page);
		const looks = await Promise.all(['a', 'b', 'c'].map((id) => look(page, id)));
		for (const l of looks) {
			expect(l.bg).toBe('rgb(214, 63, 31)');
			expect(l.shadow).toContain('rgb(255, 255, 255)');
			expect(l.rotate).toBe('45deg');
			expect(l.w).toBe(looks[0].w); // the same shape and size whatever the easing
		}
		await kf(page, 'b').click();
		await expect(kf(page, 'b')).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(async () => (await look(page, 'b')).scale).toBe('1.2');
		const sel = await look(page, 'b');
		expect(sel.shadow).toContain('2px'); // thicker white edge
		expect(sel.shadow).toMatch(/rgba\(0, 0, 0/); // and a soft shadow
		expect((await look(page, 'a')).scale).not.toBe('1.2');
		await page.locator('.storyboard').screenshot({ path: info.outputPath('diamonds.png') });
	});

	test('the diamonds never cover the item’s name, on words and on layers', async ({ page }) => {
		const id = await setup(page);
		const name = (await page.locator(`[data-item-id="${id}"] .name`).boundingBox())!;
		for (const k of ['a', 'b', 'c']) expect(overlaps((await kf(page, k).boundingBox())!, name)).toBe(false);

		const card = await api<string>(page, `s => {
			const c = s.addCardOverlay(0);
			s.setOverlayTiming(c, 0, 4);
			const v = s.itemValues(c, 0);
			s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => o.id === c ? { ...o, keyframes: [
				{ id: 'o1', time: 0.5, values: v, easing: { kind: 'bezier', x1: 0.3, y1: 1.6, x2: 0.5, y2: 1 } },
				{ id: 'o2', time: 3, values: { ...v, x: 0.7 }, easing: { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 } }
			] } : o) }));
			return c;
		}`);
		const cardName = (await page.locator(`[data-item-id="${card}"] .name`).boundingBox())!;
		for (const k of ['o1', 'o2']) expect(overlaps((await kf(page, k).boundingBox())!, cardName)).toBe(false);
		// The name is still all there (not squeezed out).
		expect(cardName.height).toBeGreaterThan(10);
	});

	test('keyframes at an item’s start and end are fully visible and clickable; the edge still trims', async ({ page }) => {
		const id = await setup(page);
		const slot = (await page.locator(`[data-item-id="${id}"]`).boundingBox())!;
		for (const k of ['a', 'c']) {
			const b = (await kf(page, k).boundingBox())!;
			expect(b.x).toBeGreaterThanOrEqual(slot.x - 0.5);
			expect(b.x + b.width).toBeLessThanOrEqual(slot.x + slot.width + 0.5);
		}
		await kf(page, 'a').click();
		await expect(kf(page, 'a')).toHaveAttribute('aria-pressed', 'true');
		expect(await api<number>(page, 's => s.time')).toBeCloseTo(0, 3);
		await kf(page, 'c').click();
		await expect(kf(page, 'c')).toHaveAttribute('aria-pressed', 'true');
		expect(await api<number>(page, 's => s.time')).toBeCloseTo(4, 3);

		// Right on the edge, above the strip: the trim handle still takes it.
		const trim = (await page.locator(`[data-item-id="${id}"] [data-trim="end"]`).boundingBox())!;
		await page.mouse.move(trim.x + trim.width / 2, trim.y + 4);
		await page.mouse.down();
		await page.mouse.move(trim.x + trim.width / 2 - 40, trim.y + 4, { steps: 5 });
		await page.mouse.up();
		expect(await api<number>(page, `s => s.project.texts.find((t) => t.id === '${id}').duration`)).toBeLessThan(3.9);
	});

	test('the tooltip has the time and the easing; the selected item shows the easing between keyframes', async ({ page }) => {
		const id = await setup(page);
		await expect(kf(page, 'b')).toHaveAttribute('title', '0:02.00 · Ease in and out');
		await expect(kf(page, 'c')).toHaveAttribute('title', '0:04.00 · Hold');
		// Not selected: no easing lines.
		await expect(page.getByTestId('keyframe-curves')).toHaveCount(0);
		await api(page, `s => s.select('${id}')`);
		const curves = page.getByTestId('keyframe-curves');
		await expect(curves.locator('path')).toHaveCount(3);
		// From the linear keyframe: a straight line (all points on one line).
		const d = await curves.locator('path[data-curve-from="a"]').getAttribute('d');
		const pts = d!.replace(/^M/, '').split(' L').map((p) => p.split(' ').map(Number));
		const [x0, y0] = pts[0];
		const [x1, y1] = pts.at(-1)!;
		for (const [x, y] of pts) expect(Math.abs(y - (y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)))).toBeLessThan(0.15);
		// The right-click menu has the easing checked.
		await kf(page, 'b').click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: '✓ Ease in and out' })).toBeVisible();
	});

	test('keyframes very close together: a click picks the nearest one', async ({ page }) => {
		await setup(page);
		// 2 s and 2.08 s overlap at this zoom; the one at 2 s is drawn on top.
		const b = (await kf(page, 'b').boundingBox())!;
		const n = (await kf(page, 'n').boundingBox())!;
		expect(overlaps(b, n)).toBe(true);
		await page.mouse.click(n.x + n.width / 2 + 1, n.y + n.height / 2);
		await expect(kf(page, 'n')).toHaveAttribute('aria-pressed', 'true');
		await expect(kf(page, 'b')).toHaveAttribute('aria-pressed', 'false');
	});
});
