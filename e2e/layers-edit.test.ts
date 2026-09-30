import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

type RGB = [number, number, number];
const near = (a: RGB, b: RGB, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

type O = {
	id: string;
	kind: string;
	row: number;
	duration: number;
	box: { x: number; y: number; w: number; h: number };
	crop?: { x: number; y: number; w: number; h: number };
	style: { radius: number; borderWidth: number; borderColor: string; shadow: string; opacity: number };
	enter: string;
	exit: string;
	sound: { on: boolean; volume: number };
	card?: { background: string };
};
const layer = (page: Page, id: string) =>
	scenes(page, (s) => JSON.parse(JSON.stringify((s as unknown as { project: { overlays: O[] } }).project.overlays))).then(
		(all) => (all as O[]).find((o) => o.id === id)!
	);
const layerStart = (page: Page, id: string) =>
	page.evaluate(
		(id) =>
			(window as unknown as { __scenes: { placedOverlays: { overlay: { id: string }; start: number }[] } }).__scenes.placedOverlays.find(
				(p) => p.overlay.id === id
			)!.start,
		id
	);
const settings = (page: Page) => page.getByRole('complementary', { name: 'Settings' });
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Layer options' });

async function previewPixel(page: Page, fx: number, fy: number): Promise<RGB> {
	await expect.poll(() => scenes(page, (s) => s.player.isFrameReady()), { timeout: 10_000 }).toBe(true);
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

/** The long magenta clip as the scene, with a video layer (red | green | blue thirds) at 1 s. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['long.mp4', 'bands.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.getByRole('button', { name: /^Scene 2, / }).click();
	await page.keyboard.press('Delete');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toHaveCount(0);
	const id = await page.evaluate(() => {
		const s = (window as unknown as { __scenes: { media: Record<string, { id: string; name: string }>; addOverlayFromMedia(id: string, start: number): string } }).__scenes;
		return s.addOverlayFromMedia(Object.values(s.media).find((m) => m.name === 'bands.mp4')!.id, 1);
	});
	await seekTo(page, 2);
	await expect(toolbar(page)).toBeVisible();
	return id;
}

const box = (page: Page) => page.locator('.layer-box.selected');

test.describe('Editing layers', () => {
	test('on the preview: select, move with snapping, resize keeping proportions (Shift frees), deselect', async ({ page }) => {
		const id = await setup(page);
		await expect(toolbar(page).getByRole('button')).toHaveText(['Crop', 'Style', 'Animate', 'Remove']);
		await expect(page.getByTestId('layer-size')).toHaveText('512 × 288');

		// Deselect by clicking empty picture; select again by clicking the layer.
		const preview = (await page.getByTestId('preview').boundingBox())!;
		await page.mouse.click(preview.x + 10, preview.y + preview.height - 10);
		await expect(toolbar(page)).toHaveCount(0);
		await page.locator(`[data-layer-box="${id}"] .move`).click();
		await expect(toolbar(page)).toBeVisible();

		// Move it towards the top left, then back near the middle: it snaps to the centre.
		let b = (await box(page).boundingBox())!;
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		await page.mouse.move(b.x + b.width / 2 - 150, b.y + b.height / 2 - 60, { steps: 6 });
		await expect(toolbar(page)).toHaveCount(0); // hidden while dragging
		await page.mouse.move(preview.x + preview.width / 2 + 3, preview.y + preview.height / 2 + 2, { steps: 8 });
		await page.mouse.up();
		let o = await layer(page, id);
		expect((o.box.x + o.box.w / 2) * 1280).toBeCloseTo(640, 0);
		expect((o.box.y + o.box.h / 2) * 720).toBeCloseTo(360, 0);

		// Corner resize keeps the picture's shape…
		b = (await box(page).boundingBox())!;
		const se = (await page.locator('[data-layer-handle="se"]').boundingBox())!;
		await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
		await page.mouse.down();
		await page.mouse.move(se.x + se.width / 2 + 80, se.y + se.height / 2 + 10, { steps: 6 });
		await expect(page.getByTestId('layer-size')).not.toHaveText('512 × 288'); // live
		await page.mouse.up();
		o = await layer(page, id);
		expect((o.box.w * 1280) / (o.box.h * 720)).toBeCloseTo(16 / 9, 1);
		expect(o.box.w * 1280).toBeGreaterThan(560);
		// …Shift frees it.
		const se2 = (await page.locator('[data-layer-handle="se"]').boundingBox())!;
		await page.keyboard.down('Shift');
		await page.mouse.move(se2.x + se2.width / 2, se2.y + se2.height / 2);
		await page.mouse.down();
		await page.mouse.move(se2.x + se2.width / 2 - 100, se2.y + se2.height / 2 + 30, { steps: 6 });
		await page.mouse.up();
		await page.keyboard.up('Shift');
		o = await layer(page, id);
		expect((o.box.w * 1280) / (o.box.h * 720)).toBeLessThan(1.5);

		// One undo step per drag.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+z`);
		expect(((await layer(page, id)).box.w * 1280) / ((await layer(page, id)).box.h * 720)).toBeCloseTo(16 / 9, 1);

		// Esc deselects.
		await page.keyboard.press('Escape');
		await expect(toolbar(page)).toHaveCount(0);
	});

	test('crop from the toolbar: the layer shows just that part, and takes its shape', async ({ page }) => {
		const id = await setup(page);
		expect(near(await previewPixel(page, 0.5, 0.5), [0, 255, 0], 40)).toBe(true); // the green middle band
		await toolbar(page).getByRole('button', { name: 'Crop' }).click();
		await expect(settings(page).getByRole('heading', { name: 'Crop' })).toBeVisible();
		// Keep only the right third (blue).
		const left = settings(page).getByRole('spinbutton', { name: 'Cut from left' });
		await left.fill('427');
		await settings(page).getByRole('button', { name: 'Done' }).click();
		await expect(settings(page).getByRole('heading', { name: 'Layer', exact: true })).toBeVisible();
		const o = await layer(page, id);
		expect(o.crop).toMatchObject({ x: 427, w: 213 });
		// The crop's (tall) shape, around the same centre.
		expect((o.box.w * 1280) / (o.box.h * 720)).toBeCloseTo(213 / 360, 2);
		expect(o.box.x + o.box.w / 2).toBeCloseTo(0.5, 2);
		expect(near(await previewPixel(page, 0.5, 0.5), [0, 0, 255], 40)).toBe(true);
		await settings(page).getByRole('button', { name: 'Remove crop' }).click();
		expect((await layer(page, id)).crop).toBeUndefined();
	});

	test('the right column: position and size, placement, style, timing, animation, sound and order', async ({ page }) => {
		const id = await setup(page);
		const s = settings(page);
		await expect(s.getByRole('heading', { name: 'Layer', exact: true })).toBeVisible();
		for (const name of ['Position and size', 'Crop', 'Style', 'Timing', 'Animation', 'Sound', 'Layer order']) {
			await expect(s.getByRole('region', { name })).toBeVisible();
		}
		// Size and position in pixels.
		await s.getByRole('spinbutton', { name: 'Layer width' }).fill('400');
		await s.getByRole('spinbutton', { name: 'Layer x' }).fill('20');
		let o = await layer(page, id);
		expect(Math.round(o.box.w * 1280)).toBe(400);
		expect(Math.round(o.box.x * 1280)).toBe(20);
		// Quick placement: bottom right, with a small margin.
		await s.getByRole('button', { name: 'Bottom right' }).click();
		o = await layer(page, id);
		expect((o.box.x + o.box.w) * 1280).toBeCloseTo(1280 - 0.04 * 720, 0);
		expect((o.box.y + o.box.h) * 720).toBeCloseTo(720 - 0.04 * 720, 0);
		await expect(page.getByTestId('layer-size')).toHaveText(/^400 × /);

		// Style.
		await s.getByRole('slider', { name: 'Corner radius' }).fill('0.5');
		await s.getByRole('slider', { name: 'Border thickness' }).fill('10');
		await s.getByRole('textbox', { name: 'Border color: hex code' }).fill('#ffe14d');
		await s.getByRole('textbox', { name: 'Border color: hex code' }).press('Enter');
		await s.getByRole('radiogroup', { name: 'Shadow' }).getByRole('radio', { name: 'Strong' }).click();
		await s.getByRole('slider', { name: 'Layer opacity' }).fill('0.8');
		o = await layer(page, id);
		expect(o.style).toEqual({ radius: 0.5, borderWidth: 10, borderColor: '#ffe14d', shadow: 'strong', opacity: 0.8 });
		// It stays selected while editing its settings.
		await expect(toolbar(page)).toBeVisible();

		// Timing: steppers for start and length (a 3 s clip can't be longer than 3 s).
		expect(o.duration).toBe(3);
		await s.getByRole('group', { name: 'Starts at' }).getByRole('button', { name: 'Later' }).click();
		expect(await layerStart(page, id)).toBeCloseTo(1.5);
		await s.getByRole('group', { name: 'Layer length' }).getByRole('button', { name: 'Shorter' }).click();
		expect((await layer(page, id)).duration).toBe(2.5);
		await expect(s.getByRole('group', { name: 'Layer length' }).getByRole('button', { name: 'Longer' })).toBeEnabled();
		await s.getByRole('group', { name: 'Layer length' }).getByRole('button', { name: 'Longer' }).click();
		await expect(s.getByRole('group', { name: 'Layer length' }).getByRole('button', { name: 'Longer' })).toBeDisabled();

		// Animation in and out.
		await s.getByRole('radiogroup', { name: 'Entrance' }).getByRole('radio', { name: 'Pop' }).click();
		await s.getByRole('radiogroup', { name: 'Exit' }).getByRole('radio', { name: 'Slide up' }).click();
		o = await layer(page, id);
		expect([o.enter, o.exit]).toEqual(['pop', 'slide-up']);

		// Sound: off by default; on, with a volume.
		expect(o.sound.on).toBe(false);
		await expect(s.getByRole('slider', { name: 'Layer volume' })).toHaveCount(0);
		await s.getByRole('switch', { name: /Play the clip’s sound/ }).click();
		await s.getByRole('slider', { name: 'Layer volume' }).fill('0.4');
		expect((await layer(page, id)).sound).toEqual({ on: true, volume: 0.4 });

		// Layer order: another layer on top; send this one… no, bring this one forward.
		const other = await page.evaluate(() => {
			const st = (window as unknown as { __scenes: { addCardOverlay(start: number, row: number): string } }).__scenes;
			return st.addCardOverlay(2, 5);
		});
		await page.evaluate((id) => (window as unknown as { __scenes: { select(id: string): void } }).__scenes.select(id), id);
		const before = [(await layer(page, id)).row, (await layer(page, other)).row];
		expect(before[0]).toBeLessThan(before[1]);
		await s.getByRole('button', { name: 'Bring forward' }).click();
		expect((await layer(page, id)).row).toBeGreaterThan((await layer(page, other)).row);
		await s.getByRole('button', { name: 'Send back' }).click();
		expect((await layer(page, id)).row).toBeLessThan((await layer(page, other)).row);
	});

	test('a card layer has the same background and rectangle settings as card scenes', async ({ page }) => {
		await setup(page);
		const card = await page.evaluate(() => {
			const s = (window as unknown as { __scenes: { addCardOverlay(start: number): string; setOverlayBox(id: string, b: object): void } }).__scenes;
			const id = s.addCardOverlay(1);
			s.setOverlayBox(id, { x: 0.05, y: 0.05, w: 0.3, h: 0.3 });
			return id;
		});
		const s = settings(page);
		await expect(s.getByRole('region', { name: 'Card' })).toBeVisible();
		await expect(s.getByRole('region', { name: 'Crop' })).toHaveCount(0);
		await expect(s.getByRole('region', { name: 'Sound' })).toHaveCount(0);
		await expect(toolbar(page).getByRole('button')).toHaveText(['Style', 'Animate', 'Remove']);
		const hex = s.getByRole('textbox', { name: 'Background: hex code' });
		await hex.fill('#336699');
		await hex.press('Enter');
		expect((await layer(page, card)).card?.background).toBe('#336699');
		expect(near(await previewPixel(page, 0.2, 0.2), [51, 102, 153], 6)).toBe(true);
		await s.getByRole('button', { name: 'Add rectangle' }).click();
		await expect(s.getByRole('spinbutton', { name: 'Rectangle width' })).toBeVisible();
	});
});
