import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
/** The card's x at timeline times. */
const xs = (page: Page, times: number[]) =>
	api<number[]>(page, `s => ${JSON.stringify(times)}.map((t) => s.itemValues(s.project.overlays[0].id, t).x)`);
const settings = (page: Page) => page.getByRole('complementary', { name: 'Settings' });

async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	// A card from x 0.2 (0 s) to 0.8 (2 s), linear.
	const id = await api<string>(page, `s => {
		const c = s.addCardOverlay(0);
		s.setOverlayTiming(c, 0, 5);
		const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
		const base = { x: 0.2, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
		s.edit('Keyframes', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [
			{ id: 'a', time: 0, values: base, easing: lin },
			{ id: 'b', time: 2, values: { ...base, x: 0.8 }, easing: lin }
		] })) }));
		return c;
	}`);
	await page.locator(`[data-item-id="${id}"] .item`).click();
	await seekTo(page, 1);
	return id;
}

test.describe('Keyframes: easing', () => {
	test('presets shape the motion between two keyframes; the curve editor names them', async ({ page }) => {
		await setup(page);
		const section = settings(page).getByRole('region', { name: 'Keyframes' });
		await expect(section).toContainText('2 keyframes');
		await section.getByRole('button', { name: /Linear/ }).click();
		const popover = page.getByRole('dialog', { name: 'Easing curve' });
		await expect(popover.getByTestId('easing-name')).toHaveText('Linear');
		const pick = (name: string) => popover.getByRole('radio', { name, exact: true }).click();

		expect((await xs(page, [1]))[0]).toBeCloseTo(0.5, 3);
		await pick('Ease in');
		expect((await xs(page, [1]))[0]).toBeLessThan(0.45);
		await pick('Ease out');
		expect((await xs(page, [1]))[0]).toBeGreaterThan(0.55);
		await pick('Ease in and out');
		expect((await xs(page, [0.5, 1, 1.5]))[1]).toBeCloseTo(0.5, 2);
		await expect(popover.getByTestId('easing-name')).toHaveText('Ease in and out');

		// Hold: stays until the next keyframe, then jumps.
		await pick('Hold');
		expect(await xs(page, [1.9, 2])).toEqual([0.2, 0.8]);
		// Overshoot: passes 0.8 and settles back on it.
		await pick('Overshoot');
		const over = await xs(page, Array.from({ length: 21 }, (_, i) => i / 10));
		expect(Math.max(...over)).toBeGreaterThan(0.84);
		expect(over.at(-1)).toBeCloseTo(0.8);
		// Bounce: never past 0.8, and comes back down at least once.
		await pick('Bounce');
		const b = await xs(page, Array.from({ length: 41 }, (_, i) => i / 20));
		expect(Math.max(...b)).toBeLessThanOrEqual(0.8 + 1e-6);
		expect(b.some((x, i) => i > 0 && x < b[i - 1] - 0.005)).toBe(true);
		// Not editable shapes: no handles.
		await expect(popover.locator('[data-curve-handle]')).toHaveCount(0);
	});

	test('dragging a curve handle makes a custom curve; one undo step per drag', async ({ page }) => {
		await setup(page);
		await settings(page).getByRole('region', { name: 'Keyframes' }).getByRole('button', { name: /Linear/ }).click();
		const popover = page.getByRole('dialog', { name: 'Easing curve' });
		const handle = popover.locator('[data-curve-handle="1"]');
		await handle.scrollIntoViewIfNeeded();
		const h = (await handle.boundingBox())!;
		await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
		await page.mouse.down();
		await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2, { steps: 6 });
		await page.mouse.up();
		await expect(popover.getByTestId('easing-name')).toHaveText('Custom');
		const e = await api<{ kind: string; x1: number; y1: number }>(page, 's => s.project.overlays[0].keyframes[0].easing');
		expect(e.kind).toBe('bezier');
		expect(e.x1).toBeGreaterThan(0.25);
		// Pulling the first handle right makes the start slower.
		expect((await xs(page, [1]))[0]).toBeLessThan(0.5);
		// The keyboard moves a handle too.
		await handle.focus();
		await page.keyboard.press('ArrowUp');
		expect(await api<number>(page, 's => s.project.overlays[0].keyframes[0].easing.y1')).toBeCloseTo(e.y1 + 0.01, 3);
		// Undo: the drag and the key are separate steps; two undos give Linear back.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press('Escape');
		await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
		await page.keyboard.press(`${mod}+z`);
		await page.keyboard.press(`${mod}+z`);
		expect(await api<string>(page, 's => JSON.stringify(s.project.overlays[0].keyframes[0].easing)')).toBe(
			JSON.stringify({ kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 })
		);
	});

	test('the easing for new keyframes is a setting, remembered on this device', async ({ page }) => {
		const id = await setup(page);
		expect(await api<string>(page, 's => s.defaultEasing')).toBe('ease-in-out');
		await settings(page).getByRole('region', { name: 'Keyframes' }).getByRole('button', { name: /Linear/ }).click();
		const popover = page.getByRole('dialog', { name: 'Easing curve' });
		await popover.getByRole('radio', { name: 'Bounce' }).click();
		await popover.getByRole('button', { name: 'Use for new keyframes' }).click();
		await expect(popover.getByRole('button', { name: 'Default for new keyframes' })).toBeDisabled();
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		expect(await api<string>(page, 's => s.defaultEasing')).toBe('bounce');
		// A new keyframe (changing the card at 3 s) gets it.
		await api(page, `s => { s.seek(3); s.setItemValues('${id}', { x: 0.5 }); }`);
		const kfs = await api<{ time: number; easing: { kind: string } }[]>(page, 's => s.project.overlays[0].keyframes');
		expect(kfs.find((k) => k.time === 3)!.easing.kind).toBe('bounce');
	});
});
