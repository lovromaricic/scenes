import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, scenes } from './helpers';

type Store = {
	placedOverlays: { overlay: { id: string; kind: string; name: string; duration: number; box: { w: number } }; start: number }[];
	project: { scenes: { name: string; sourceStart: number; sourceEnd: number }[] };
	placed: { scene: { name: string }; start: number }[];
	addOverlayFromMedia(id: string, start?: number, row?: number): string | null;
	media: Record<string, { id: string; name: string }>;
};
const state = (page: Page) =>
	scenes(page, (s) => {
		const st = s as unknown as Store;
		return {
			scenes: st.placed.map((p) => `${p.scene.name}@${Math.round(p.start * 10) / 10}`),
			layers: st.placedOverlays.map((p) => ({
				name: p.overlay.name,
				kind: p.overlay.kind,
				start: Math.round(p.start * 10) / 10,
				duration: Math.round(p.overlay.duration * 10) / 10,
				w: p.overlay.box.w
			}))
		};
	});

async function settled(locator: import('@playwright/test').Locator) {
	let last = '';
	await expect
		.poll(async () => {
			const now = JSON.stringify(await locator.boundingBox());
			const same = now === last;
			last = now;
			return same;
		}, { intervals: [80] })
		.toBe(true);
	return (await locator.boundingBox())!;
}

/** Red 4 s, green 3 s, blue 3 s. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Moving between Scenes and Layers', () => {
	test('drag a scene up into Layers: it becomes a layer, and the scenes close the gap', async ({ page }) => {
		await setup(page);
		const green = await settled(page.locator('.card-slot').nth(1));
		const lane = await settled(page.locator('.layers'));
		const red = await settled(page.locator('.card-slot').first());
		const pxPerSec = red.width / 4;
		await page.mouse.move(green.x + 20, green.y + green.height / 2);
		await page.mouse.down();
		// Up into the Layers row, over 1 s into the red scene.
		await page.mouse.move(red.x + pxPerSec + 20, lane.y + lane.height / 2, { steps: 12 });
		await expect(page.locator('.layers .drop-ghost')).toContainText('Make it a layer');
		await page.mouse.up();

		await expect.poll(async () => (await state(page)).scenes).toEqual(['Red@0', 'Blue@4']);
		const { layers } = await state(page);
		expect(layers).toHaveLength(1);
		expect(layers[0]).toMatchObject({ name: 'Green', kind: 'video', duration: 3 });
		expect(layers[0].start).toBeCloseTo(1, 0);
		expect(layers[0].w).toBeCloseTo(0.4); // the default layer size
		await expect(page.getByRole('complementary', { name: 'Settings' }).getByRole('heading', { level: 2 })).toHaveText('Layer');

		// One undo step puts it back.
		await page.keyboard.press(`${mod}+z`);
		await expect.poll(async () => (await state(page)).scenes).toEqual(['Red@0', 'Green@4', 'Blue@7']);
		expect((await state(page)).layers).toEqual([]);
	});

	test('drag a layer down into Scenes: it becomes a full-frame scene where dropped', async ({ page }) => {
		await setup(page);
		await page.evaluate(() => {
			const s = (window as unknown as { __scenes: Store }).__scenes;
			const green = Object.values(s.media).find((m) => m.name === 'green.mp4')!;
			s.addOverlayFromMedia(green.id, 1);
		});
		await expect(page.locator('.layer-slot')).toHaveCount(1);
		const item = await settled(page.locator('.layer-slot'));
		const blue = await settled(page.locator('.card-slot').nth(2));
		await page.mouse.move(item.x + 20, item.y + item.height / 2);
		await page.mouse.down();
		// Down onto the start of the blue scene: between green and blue.
		await page.mouse.move(blue.x + 6, blue.y + blue.height / 2, { steps: 12 });
		await expect(page.locator('.drop-marker')).toBeVisible();
		await page.mouse.up();

		await expect.poll(async () => (await state(page)).scenes).toEqual(['Red@0', 'Green@4', 'Green@7', 'Blue@10']);
		expect((await state(page)).layers).toEqual([]);
		await expect(page.locator('.drop-marker')).toHaveCount(0);
		// The new scene is the whole 3 s clip, full frame.
		const scene = await scenes(page, (s) => (s as unknown as Store).project.scenes[2]);
		expect(scene).toMatchObject({ sourceStart: 0, sourceEnd: 3 });

		await page.keyboard.press(`${mod}+z`);
		await expect.poll(async () => (await state(page)).scenes).toEqual(['Red@0', 'Green@4', 'Blue@7']);
		expect((await state(page)).layers).toHaveLength(1);
	});
});
