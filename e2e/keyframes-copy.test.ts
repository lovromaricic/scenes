import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
type K = { id: string; time: number; values: Record<string, number>; easing: { kind: string } };

/**
 * quads.mp4 as the scene (6 s); card A (0–6 s) with keyframes at 1 s (x 0.2, 30°, bounce) and
 * 2 s (x 0.6, 60°, scale 1.5); card B (2–6 s, upright, at x 0.5); words (0.5–3.5 s).
 */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['quads.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	return api<{ a: string; b: string; w: string }>(page, `s => {
		const a = s.addCardOverlay(0);
		s.setOverlayTiming(a, 0, 6);
		const b = s.addCardOverlay(2);
		s.setOverlayTiming(b, 2, 4);
		const base = { x: 0.2, y: 0.5, scaleX: 1, scaleY: 1, rotation: 30, opacity: 1 };
		s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => o.id !== a ? o : { ...o, keyframes: [
			{ id: 'k1', time: 1, values: base, easing: { kind: 'bounce' } },
			{ id: 'k2', time: 2, values: { ...base, x: 0.6, rotation: 60, scaleX: 1.5, scaleY: 1.5 }, easing: { kind: 'hold' } }
		] }) }));
		s.seek(0.5);
		s.addText('title');
		s.stopEditingText();
		return { a, b, w: s.project.texts[0].id };
	}`);
}

async function copyBoth(page: Page, a: string) {
	await page.locator(`.kf[data-keyframe-item="${a}"][data-keyframe="k1"]`).click();
	await page.locator(`.kf[data-keyframe-item="${a}"][data-keyframe="k2"]`).click({ modifiers: ['Shift'] });
	await page.keyboard.press(`${mod}+c`);
}

test.describe('Keyframes: copy and paste', () => {
	test('onto another layer: the first lands at the playhead, keeping the spacing and easing', async ({ page }) => {
		const { a, b } = await setup(page);
		await copyBoth(page, a);
		// Copying keyframes doesn't copy the layer.
		await page.locator(`[data-item-id="${b}"] .item`).click();
		await seekTo(page, 3);
		await page.keyboard.press(`${mod}+v`);
		const kf = await api<K[]>(page, `s => s.project.overlays.find((o) => o.id === '${b}').keyframes`);
		// B starts at 2 s: keyframes at 1 s and 2 s into it (timeline 3 s and 4 s).
		expect(kf.map((k) => k.time)).toEqual([1, 2]);
		expect(kf.map((k) => k.values.x)).toEqual([0.2, 0.6]);
		expect(kf.map((k) => k.values.rotation)).toEqual([30, 60]);
		expect(kf.map((k) => k.easing.kind)).toEqual(['bounce', 'hold']);
		expect(await api<number>(page, 's => s.project.overlays.length')).toBe(2);
		// The pasted keyframes are selected.
		expect(await api<number>(page, 's => s.selectedKeyframes.length')).toBe(2);
	});

	test('onto words (everything is shared) and onto a scene’s framing (position and size only)', async ({ page }) => {
		const { a, w } = await setup(page);
		await copyBoth(page, a);
		await page.locator(`[data-item-id="${w}"] .item`).click();
		await seekTo(page, 1);
		await page.keyboard.press(`${mod}+v`);
		let kf = await api<K[]>(page, `s => s.project.texts[0].keyframes`);
		expect(kf.map((k) => Math.round(k.time * 1000) / 1000)).toEqual([0.5, 1.5]);
		expect(kf[1].values).toMatchObject({ x: 0.6, rotation: 60, scaleX: 1.5 });

		// A scene with Custom framing: x and y are offsets from the centre, and the scale is the zoom.
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page.getByRole('complementary', { name: 'Settings' }).getByRole('radiogroup', { name: 'Frame' }).getByRole('radio', { name: 'Custom' }).click();
		await seekTo(page, 2);
		await page.keyboard.press(`${mod}+v`);
		kf = await api<K[]>(page, `s => s.project.scenes[0].keyframes`);
		expect(kf).toHaveLength(2);
		expect(kf[0].values.x).toBeCloseTo(0.2 - 0.5);
		expect(kf[1].values.x).toBeCloseTo(0.6 - 0.5);
		expect(kf[1].values.zoom).toBeCloseTo(1.5);
		expect(Object.keys(kf[0].values).sort()).toEqual(['x', 'y', 'zoom']);
	});

	test('from a scene onto a layer: position and size; the rest stays the layer’s own', async ({ page }) => {
		const { b } = await setup(page);
		await api(page, `s => {
			const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
			s.edit('f', (p) => ({ ...p, scenes: p.scenes.map((sc) => ({ ...sc,
				frame: { mode: 'custom', bars: 'black', zoom: 1, x: 0, y: 0 },
				keyframes: [{ id: 'f1', time: 1, values: { x: 0.1, y: -0.1, zoom: 2 }, easing: lin }] })) }));
			s.setItemValues('${b}', { rotation: 12 });
		}`);
		await page.locator('.card-slot').first().locator('.kf[data-keyframe="f1"]').click();
		await page.keyboard.press(`${mod}+c`);
		await page.locator(`[data-item-id="${b}"] .item`).click();
		await seekTo(page, 2.5);
		await page.keyboard.press(`${mod}+v`);
		const kf = await api<K[]>(page, `s => s.project.overlays.find((o) => o.id === '${b}').keyframes`);
		expect(kf[0].values).toMatchObject({ x: 0.6, y: 0.4, scaleX: 2, scaleY: 2, rotation: 12 });
	});

	test('right-click Copy, and pasting with nothing to paste onto says so', async ({ page }) => {
		const { a } = await setup(page);
		const m = page.locator(`.kf[data-keyframe-item="${a}"][data-keyframe="k2"]`);
		await m.click({ button: 'right' });
		await page.getByRole('menu', { name: 'Keyframe' }).getByRole('menuitem', { name: 'Copy' }).click();
		await page.keyboard.press('Escape');
		await api(page, 's => s.deselect()');
		await page.keyboard.press(`${mod}+v`);
		await expect(page.getByText(/to paste the keyframes on/)).toBeVisible();
	});
});
