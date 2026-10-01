import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
type V = { x: number; y: number; scaleX: number; scaleY: number; rotation: number; opacity: number };
const valuesAt = (page: Page, id: string, t: number) => api<V>(page, `s => s.itemValues('${id}', ${t})`);
const keyframes = (page: Page, id: string) =>
	api<{ time: number; values: V }[]>(page, `s => (s.project.overlays.find((o) => o.id === '${id}') ?? s.project.texts.find((o) => o.id === '${id}')).keyframes ?? []`);
const settings = (page: Page) => page.getByRole('complementary', { name: 'Settings' });
const diamond = (page: Page) => settings(page).getByTestId('keyframe-diamond');
const time = (page: Page) => api<number>(page, 's => s.time');

async function dragBy(page: Page, x: number, y: number, dx: number, dy: number, shift = false) {
	await page.mouse.move(x, y);
	await page.mouse.down();
	if (shift) await page.keyboard.down('Shift');
	await page.mouse.move(x + dx, y + dy, { steps: 8 });
	await page.mouse.up();
	if (shift) await page.keyboard.up('Shift');
}

/** Red video scene; the quads picture as a "logo" layer from 0 to 6 s, selected. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4', 'quads.png'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.getByRole('button', { name: /^Scene 2, / }).click();
	await page.keyboard.press('Delete');
	const id = await api<string>(page, `s => {
		const m = Object.values(s.media).find((x) => x.name === 'quads.png');
		const id = s.addOverlayFromMedia(m.id, 0);
		s.setOverlayTiming(id, 0, 6);
		s.setOverlayBox(id, { x: 0.05, y: 0.05, w: 0.2, h: 0.2 });
		return id;
	}`);
	await page.locator(`[data-item-id="${id}"] .item`).click();
	return id;
}

const box = (page: Page, id: string) => page.locator(`[data-layer-box="${id}"]`);

test.describe('Keyframes: adding and editing', () => {
	test('animate a logo with the diamond: add a keyframe, move the playhead, move and scale it', async ({ page }) => {
		const id = await setup(page);
		await seekTo(page, 0.5);
		await expect(diamond(page)).toHaveAttribute('aria-pressed', 'false');
		await diamond(page).click();
		await expect(diamond(page)).toHaveAttribute('aria-pressed', 'true');
		expect(await keyframes(page, id)).toHaveLength(1);
		const start = await valuesAt(page, id, 0.5);

		// Later, drag the logo on the preview: a keyframe is added there.
		await seekTo(page, 2.5);
		await expect(diamond(page)).toHaveAttribute('aria-pressed', 'false');
		const b = (await box(page, id).boundingBox())!;
		await dragBy(page, b.x + b.width / 2, b.y + b.height / 2, 300, 120);
		expect((await keyframes(page, id)).map((k) => k.time)).toEqual([0.5, 2.5]);
		await expect(diamond(page)).toHaveAttribute('aria-pressed', 'true');
		const moved = await valuesAt(page, id, 2.5);
		expect(moved.x).toBeGreaterThan(start.x + 0.15);
		expect(moved.y).toBeGreaterThan(start.y + 0.1);
		// The start keyframe didn't change; between them it moves.
		expect((await valuesAt(page, id, 0.5)).x).toBeCloseTo(start.x, 5);
		const mid = await valuesAt(page, id, 1.5);
		expect(mid.x).toBeGreaterThan(start.x);
		expect(mid.x).toBeLessThan(moved.x);

		// Scaling with a corner handle changes the scale at the playhead (not the base size).
		const b2 = (await box(page, id).boundingBox())!;
		const baseW = await api<number>(page, `s => s.project.overlays[0].box.w`);
		await dragBy(page, b2.x + b2.width, b2.y + b2.height, 80, 45);
		expect(await api<number>(page, `s => s.project.overlays[0].box.w`)).toBeCloseTo(baseW, 6);
		expect((await valuesAt(page, id, 2.5)).scaleX).toBeGreaterThan(1.2);
		expect((await valuesAt(page, id, 0.5)).scaleX).toBeCloseTo(1);
		// The scale field shows it, at the playhead.
		const scale = Number(await settings(page).getByRole('spinbutton', { name: 'Layer scale' }).inputValue());
		expect(scale).toBeGreaterThan(120);

		// A motion path with a dot at each keyframe.
		await expect(page.getByTestId('motion-path')).toBeAttached();
		await expect(page.locator('[data-path-dot]')).toHaveCount(2);

		// Previous / next keyframe.
		await settings(page).getByRole('button', { name: 'Previous keyframe' }).click();
		expect(await time(page)).toBeCloseTo(0.5, 3);
		await settings(page).getByRole('button', { name: 'Next keyframe' }).click();
		expect(await time(page)).toBeCloseTo(2.5, 3);
		// The same buttons are on the floating toolbar over the preview.
		await expect(page.getByRole('group', { name: 'Keyframes' })).toHaveCount(2);
	});

	test('the rotation handle turns it at the playhead; Shift snaps to 15°', async ({ page }) => {
		const id = await setup(page);
		await seekTo(page, 1);
		await diamond(page).click();
		await seekTo(page, 3);
		const knob = box(page, id).locator('[data-layer-handle="rotate"]');
		const k = (await knob.boundingBox())!;
		const b = (await box(page, id).boundingBox())!;
		// Around the box's centre: from straight above to the right is about +90°.
		await dragBy(page, k.x + k.width / 2, k.y + k.height / 2, b.x + b.width + 60 - (k.x + k.width / 2), b.y + b.height / 2 - (k.y + k.height / 2) + 3, true);
		const r = (await valuesAt(page, id, 3)).rotation;
		expect(r % 15).toBeCloseTo(0, 6);
		expect(r).toBeGreaterThanOrEqual(60);
		expect((await valuesAt(page, id, 1)).rotation).toBe(0);
		await expect(box(page, id)).toHaveCSS('rotate', `${r}deg`);
		// The rotation field shows it.
		await expect(settings(page).getByRole('spinbutton', { name: 'Layer rotation' })).toHaveValue(String(r));
	});

	test('drag the motion path to move the whole animation; arrow keys nudge it', async ({ page }) => {
		const id = await setup(page);
		await api(page, `s => {
			const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
			const base = { x: 0.2, y: 0.3, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
			s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [
				{ id: 'a', time: 0.5, values: base, easing: lin },
				{ id: 'b', time: 2.5, values: { ...base, x: 0.7, y: 0.6 }, easing: lin }
			] })) }));
		}`);
		await seekTo(page, 4);
		const path = page.getByTestId('motion-path');
		await expect(path).toBeAttached();
		// A point on the line near its start, clear of the layer's toolbar (which stays inside the
		// frame, so it may be over part of the line).
		const preview = (await page.getByTestId('preview').boundingBox())!;
		const bar = (await page.getByTestId('selection-toolbar').boundingBox())!;
		let px = 0;
		let py = 0;
		for (let f = 0.02; f < 0.6; f += 0.02) {
			px = preview.x + preview.width * (0.2 + (0.7 - 0.2) * f);
			py = preview.y + preview.height * (0.3 + (0.6 - 0.3) * f);
			const onBar = px > bar.x - 6 && px < bar.x + bar.width + 6 && py > bar.y - 6 && py < bar.y + bar.height + 6;
			if (!onBar) break;
		}
		const dx = preview.width * 0.1;
		const dy = preview.height * 0.05;
		await dragBy(page, px, py, dx, dy);
		const after = await keyframes(page, id);
		expect(after[0].values.x).toBeCloseTo(0.3, 2);
		expect(after[1].values.x).toBeCloseTo(0.8, 2);
		expect(after[0].values.y).toBeCloseTo(0.35, 2);
		expect(after[1].values.y).toBeCloseTo(0.65, 2);
		// Selected: arrow keys move the whole animation (1 px, Shift 10 px).
		await expect(path).toHaveAttribute('aria-pressed', 'true');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowDown');
		const nudged = await keyframes(page, id);
		const W = await api<number>(page, 's => s.project.format.width');
		const H = await api<number>(page, 's => s.project.format.height');
		expect(nudged[0].values.x - after[0].values.x).toBeCloseTo(1 / W, 6);
		expect(nudged[1].values.y - after[1].values.y).toBeCloseTo(10 / H, 6);
		// The playhead didn't move (the keys went to the path).
		expect(await time(page)).toBeCloseTo(4, 3);
	});

	test('the filled diamond removes that keyframe; Remove all keeps the values at the playhead', async ({ page }) => {
		const id = await setup(page);
		await seekTo(page, 0.5);
		await diamond(page).click();
		await seekTo(page, 2.5);
		await settings(page).getByRole('spinbutton', { name: 'Layer rotation' }).fill('40');
		expect(await keyframes(page, id)).toHaveLength(2);
		// On the keyframe: the diamond removes it.
		await expect(diamond(page)).toHaveAttribute('aria-pressed', 'true');
		await diamond(page).click();
		expect(await keyframes(page, id)).toHaveLength(1);
		// Again, with two, then remove all at 1.5 s.
		await settings(page).getByRole('spinbutton', { name: 'Layer rotation' }).fill('40');
		await seekTo(page, 1.5);
		const here = await valuesAt(page, id, 1.5);
		await settings(page).getByRole('button', { name: 'Remove all keyframes' }).click();
		await page.getByRole('dialog', { name: 'Remove all keyframes?' }).getByRole('button', { name: 'Remove all' }).click();
		expect(await keyframes(page, id)).toHaveLength(0);
		const o = await api<{ rotation: number; box: { x: number; w: number } }>(page, 's => s.project.overlays[0]');
		expect(o.rotation).toBeCloseTo(here.rotation, 5);
		expect(o.box.x + o.box.w / 2).toBeCloseTo(here.x, 5);
		await expect(diamond(page)).toHaveAttribute('aria-pressed', 'false');
	});

	test('scenes with Custom framing and words get the diamond too', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['quads.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		// Not until it's Custom.
		await expect(diamond(page)).toHaveCount(0);
		await settings(page).getByRole('radiogroup', { name: 'Frame' }).getByRole('radio', { name: 'Custom' }).click();
		await seekTo(page, 1);
		await diamond(page).click();
		await seekTo(page, 4);
		await settings(page).getByRole('slider', { name: 'Zoom' }).fill('2');
		const zoom = (t: number) => api<number>(page, `s => s.frameValues(s.project.scenes[0].id, ${t}).zoom`);
		expect(await zoom(1)).toBeCloseTo(1);
		expect(await zoom(4)).toBeCloseTo(2);
		expect(await zoom(2.5)).toBeGreaterThan(1.1);
		expect(await zoom(2.5)).toBeLessThan(1.9);

		// Words: the diamond, then dragging the words adds a keyframe.
		await seekTo(page, 0.5);
		await page.getByRole('button', { name: /^Words Titles/ }).click();
		await page.getByRole('button', { name: /^Title/ }).click();
		await page.keyboard.press('Escape');
		const words = await api<string>(page, 's => s.project.texts[0].id');
		await page.locator(`[data-item-id="${words}"] .item`).click();
		await seekTo(page, 0.5);
		await diamond(page).click();
		await seekTo(page, 2);
		const t = (await page.locator('.text-box').first().boundingBox())!;
		await dragBy(page, t.x + t.width / 2, t.y + t.height / 2, -150, 0);
		// Seconds from the words' start (0.5 s).
		expect((await keyframes(page, words)).map((k) => k.time)).toEqual([0, 1.5]);
	});
});
