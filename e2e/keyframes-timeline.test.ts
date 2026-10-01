import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
type K = { id: string; time: number; easing: { kind: string; x1?: number } };
const keyframes = (page: Page) => api<K[]>(page, 's => s.project.overlays[0].keyframes ?? []');
const marker = (page: Page, id: string) => page.locator(`.kf[data-keyframe="${id}"]`);
const time = (page: Page) => api<number>(page, 's => s.time');

/** A red scene (6 s) and a card from 0 to 6 s with keyframes at 1 s (linear), 2 s (eased), 3 s (hold). */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await api(page, `s => {
		const c = s.addCardOverlay(0);
		s.setOverlayTiming(c, 0, 6);
		const base = { x: 0.3, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
		s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [
			{ id: 'a', time: 1, values: base, easing: { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 } },
			{ id: 'b', time: 2, values: { ...base, x: 0.5 }, easing: { kind: 'bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
			{ id: 'c', time: 3, values: { ...base, x: 0.7 }, easing: { kind: 'hold' } }
		] })) }));
		s.deselect();
	}`);
	await expect(page.locator('.kf[data-keyframe]')).toHaveCount(3);
}

async function centre(page: Page, id: string) {
	const b = (await marker(page, id).boundingBox())!;
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe('Keyframes on the timeline', () => {
	test('markers show their easing; click selects and goes there; Shift-click adds', async ({ page }) => {
		await setup(page);
		await expect(marker(page, 'a')).toHaveAttribute('data-easing', 'linear');
		await expect(marker(page, 'b')).toHaveAttribute('data-easing', 'eased');
		await expect(marker(page, 'c')).toHaveAttribute('data-easing', 'hold');
		// On the card, at their times.
		const a = await centre(page, 'a');
		const b = await centre(page, 'b');
		const c = await centre(page, 'c');
		expect(b.x - a.x).toBeCloseTo(c.x - b.x, 0);

		await marker(page, 'b').click();
		await expect(marker(page, 'b')).toHaveAttribute('aria-pressed', 'true');
		expect(await time(page)).toBeCloseTo(2, 3);
		// Its item is selected too.
		expect(await api<string>(page, 's => s.selectedId')).toBe(await api<string>(page, 's => s.project.overlays[0].id'));
		await marker(page, 'c').click({ modifiers: ['Shift'] });
		expect(await api<number>(page, 's => s.selectedKeyframes.length')).toBe(2);
		await marker(page, 'b').click({ modifiers: ['Shift'] });
		expect(await api<string[]>(page, 's => s.selectedKeyframes.map((r) => r.id)')).toEqual(['c']);
	});

	test('drag selected keyframes in time, snapping to the playhead (Alt: no snapping)', async ({ page }) => {
		await setup(page);
		await seekTo(page, 2.5);
		await marker(page, 'b').click();
		await marker(page, 'c').click({ modifiers: ['Shift'] });
		await seekTo(page, 2.5);
		// Drag b right by a bit less than half a second: it snaps onto the playhead at 2.5 s, and c
		// moves by the same amount.
		const b = await centre(page, 'b');
		const pps = (await centre(page, 'c')).x - b.x;
		await page.mouse.move(b.x, b.y);
		await page.mouse.down();
		await page.mouse.move(b.x + pps * 0.47, b.y, { steps: 8 });
		await expect(page.locator('.kf-snap')).toHaveCount(1);
		await page.mouse.up();
		let k = await keyframes(page);
		expect(k.map((x) => Math.round(x.time * 1000) / 1000)).toEqual([1, 2.5, 3.5]);

		// Alt: exactly where it's dropped.
		const b2 = await centre(page, 'b');
		await page.mouse.move(b2.x, b2.y);
		await page.mouse.down();
		await page.keyboard.down('Alt');
		await page.mouse.move(b2.x - pps * 0.23, b2.y, { steps: 8 });
		await page.mouse.up();
		await page.keyboard.up('Alt');
		k = await keyframes(page);
		expect(k[1].time).toBeGreaterThan(2.15);
		expect(k[1].time).toBeLessThan(2.35);
		expect(k[2].time - k[1].time).toBeCloseTo(1, 3);
	});

	test('Delete removes the selected keyframes (the item stays); a selection box selects markers', async ({ page }) => {
		await setup(page);
		await marker(page, 'a').click();
		await marker(page, 'c').click({ modifiers: ['Shift'] });
		await page.keyboard.press('Delete');
		expect((await keyframes(page)).map((x) => x.id)).toEqual(['b']);
		expect(await api<number>(page, 's => s.project.overlays.length')).toBe(1);
		// Undo, then box-select all three.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+z`);
		await expect(page.locator('.kf[data-keyframe]')).toHaveCount(3);
		const a = await centre(page, 'a');
		const c = await centre(page, 'c');
		const lane = (await page.getByRole('group', { name: 'Overlay 1', exact: true }).boundingBox())!;
		// From the empty part of the lane above the item… the item fills the lane, so start in the
		// gap above the track and sweep across the markers.
		await page.mouse.move(a.x - 20, lane.y - 3);
		await page.mouse.down();
		await page.mouse.move(c.x + 20, a.y + 4, { steps: 8 });
		await page.mouse.up();
		expect((await api<string[]>(page, 's => s.selectedKeyframes.map((r) => r.id)')).sort()).toEqual(['a', 'b', 'c']);
	});

	test('right-click: easing for every selected keyframe, Edit curve…, Delete; shapes follow', async ({ page }) => {
		await setup(page);
		await marker(page, 'a').click();
		await marker(page, 'b').click({ modifiers: ['Shift'] });
		await marker(page, 'b').click({ button: 'right' });
		const menu = page.getByRole('menu', { name: 'Keyframe' });
		await expect(menu).toBeVisible();
		await menu.getByRole('menuitem', { name: 'Bounce' }).click();
		let k = await keyframes(page);
		expect(k.slice(0, 2).map((x) => x.easing.kind)).toEqual(['bounce', 'bounce']);
		await expect(marker(page, 'a')).toHaveAttribute('data-easing', 'bounce');
		await expect(marker(page, 'b')).toHaveAttribute('data-easing', 'bounce');

		await marker(page, 'a').click({ button: 'right' });
		await menu.getByRole('menuitem', { name: 'Overshoot' }).click();
		await expect(marker(page, 'a')).toHaveAttribute('data-easing', 'overshoot');

		// Edit curve… on one keyframe.
		await marker(page, 'c').click();
		await marker(page, 'c').click({ button: 'right' });
		await menu.getByRole('menuitem', { name: 'Edit curve…' }).click();
		const curve = page.getByRole('dialog', { name: 'Easing curve' });
		await expect(curve).toBeVisible();
		await curve.getByRole('radio', { name: 'Ease out' }).click();
		k = await keyframes(page);
		expect(k[2].easing).toMatchObject({ kind: 'bezier', x1: 0 });
		await expect(marker(page, 'c')).toHaveAttribute('data-easing', 'eased');
		await page.keyboard.press('Escape');
		await page.mouse.click(10, 10);

		await marker(page, 'c').click({ button: 'right' });
		await menu.getByRole('menuitem', { name: 'Delete' }).click();
		expect((await keyframes(page)).map((x) => x.id)).toEqual(['a', 'b']);
	});

	test('scene cards show their framing keyframes', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['quads.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await api(page, `s => {
			const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
			s.edit('f', (p) => ({ ...p, scenes: p.scenes.map((sc) => ({ ...sc,
				frame: { mode: 'custom', bars: 'black', zoom: 1, x: 0, y: 0 },
				keyframes: [
					{ id: 'f1', time: 1, values: { x: 0, y: 0, zoom: 1 }, easing: lin },
					{ id: 'f2', time: 4, values: { x: 0, y: 0, zoom: 2 }, easing: { kind: 'hold' } }
				] })) }));
		}`);
		const card = page.locator('.card-slot').first();
		await expect(card.locator('.kf[data-keyframe]')).toHaveCount(2);
		await card.locator('.kf[data-keyframe="f2"]').click();
		expect(await time(page)).toBeCloseTo(4, 3);
		await expect(card.locator('.kf[data-keyframe="f2"]')).toHaveAttribute('data-easing', 'hold');
		// At 2×, the 4 s moment of the clip is at 2 s on the timeline.
		await api(page, 's => s.setSceneSpeed(s.project.scenes[0].id, 2)');
		await card.locator('.kf[data-keyframe="f2"]').click();
		expect(await time(page)).toBeCloseTo(2, 3);
	});
});
