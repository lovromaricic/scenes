import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, scenes } from './helpers';

type Placed = { overlay: { id: string; row: number; duration: number; sceneId: string | null; name: string }; start: number; end: number };
type Store = {
	placedOverlays: Placed[];
	project: { scenes: { id: string; mediaId: string; name: string }[]; overlays: unknown[] };
	addOverlayFromMedia(mediaId: string, start?: number, row?: number): string | null;
	moveScene(from: number, to: number): void;
	trimScene(id: string, edge: 'start' | 'end', delta: number): void;
	undo(): void;
};

const layers = (page: Page) =>
	scenes(page, (s) =>
		(s as unknown as Store).placedOverlays.map((p) => ({
			id: p.overlay.id,
			name: p.overlay.name,
			row: p.overlay.row,
			start: Math.round(p.start * 100) / 100,
			duration: Math.round(p.overlay.duration * 100) / 100,
			sceneId: p.overlay.sceneId
		}))
	);

/** Scenes: red 4 s, green 3 s, blue 3 s (10 s). Also a photo in "Your media". */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm', 'yellow.jpg'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 4, / })).toBeVisible();
	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: { project: { scenes: { id: string }[] }; deleteScene(id: string): void } }).__scenes;
		s.deleteScene(s.project.scenes[3].id); // keep the photo only in "Your media"
	});
	await expect(page.getByRole('button', { name: /^Scene 4, / })).toHaveCount(0);
}

const mediaId = (page: Page, name: string) =>
	page.evaluate(
		(name) =>
			Object.values((window as unknown as { __scenes: { media: Record<string, { id: string; name: string }> } }).__scenes.media).find(
				(m) => m.name === name
			)!.id,
		name
	);

const add = (page: Page, name: string, start: number, row?: number) =>
	mediaId(page, name).then((id) =>
		page.evaluate(
			({ id, start, row }) =>
				(window as unknown as { __scenes: Store }).__scenes.addOverlayFromMedia(id, start, row),
			{ id, start, row }
		)
	);

const slot = (page: Page, id: string) => page.locator(`[data-overlay-id="${id}"]`);

/** A box once it has stopped moving (items and scene cards slide when things change). */
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
const settledBox = (page: Page, id: string) => settled(slot(page, id));

test.describe('Layers track', () => {
	test('an empty Layers row sits above Scenes, with a hint', async ({ page }) => {
		await setup(page);
		const lane = page.getByRole('group', { name: 'Layers' });
		await expect(lane).toContainText('Drop videos, images or cards here to place them on top');
		const layersBox = (await lane.boundingBox())!;
		const scenesBox = (await page.getByRole('group', { name: 'Scenes' }).boundingBox())!;
		expect(layersBox.y + layersBox.height).toBeLessThanOrEqual(scenesBox.y);
		// Order of the labels: Layers, Scenes, Words, Sound.
		const labels = await page.locator('.storyboard .labels .label').allInnerTexts();
		expect(labels.filter(Boolean)).toEqual(['Layers', 'Scenes', 'Words', 'Sound']);
	});

	test('items show like scene cards, move in time, and trim (a video no longer than its clip)', async ({ page }) => {
		await setup(page);
		const id = (await add(page, 'yellow.jpg', 1))!;
		await expect(slot(page, id)).toBeVisible();
		await expect(slot(page, id).getByRole('button', { name: /^Layer: Yellow, from 1s for 5s/ })).toBeVisible();
		await expect(slot(page, id)).toContainText('Yellow');
		await expect(page.getByRole('group', { name: 'Layers' })).not.toContainText('Drop videos');
		// It starts at 1 s: a quarter of the way into the 4 s red scene.
		const scene1 = await settled(page.locator('.card-slot').first());
		let box = await settledBox(page, id);
		expect(box.x).toBeCloseTo(scene1.x + scene1.width / 4, -1);

		// Drag it right by about 2 s: a gap before it, no problem.
		const pxPerSec = scene1.width / 4;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + pxPerSec * 2, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		await expect.poll(async () => (await layers(page))[0].start).toBeCloseTo(3, 0);
		const [moved] = await layers(page);
		expect(moved.sceneId).toBe(await scenes(page, (s) => (s as unknown as Store).project.scenes[0].id));

		// Drag its end edge left: shorter.
		box = await settledBox(page, id);
		await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width - 2 - pxPerSec * 2, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		await expect.poll(async () => (await layers(page))[0].duration).toBeCloseTo(3, 0);

		// A 4 s video overlay can't be stretched past 4 s.
		const vid = (await add(page, 'red.mp4', 5, 5))!;
		expect((await layers(page)).find((l) => l.id === vid)!.duration).toBe(4);
		box = await settledBox(page, vid);
		await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width + pxPerSec * 3, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		await expect.poll(async () => (await layers(page)).find((l) => l.id === vid)!.duration).toBe(4);
	});

	test('overlapping items get a new row above; empty rows go away', async ({ page }) => {
		await setup(page);
		const a = (await add(page, 'yellow.jpg', 0, 0))!;
		const b = (await add(page, 'yellow.jpg', 2, 0))!;
		// b overlaps a in row 0, so it went into a new row above.
		let list = await layers(page);
		expect(list.find((l) => l.id === a)!.row).toBe(0);
		expect(list.find((l) => l.id === b)!.row).toBe(1);
		const aBox = await settledBox(page, a);
		const bBox = await settledBox(page, b);
		expect(bBox.y).toBeLessThan(aBox.y); // higher row, higher on screen

		// Drag b into a free spot of row 0 (after a): row 1 empties and goes away.
		const scene1 = (await page.locator('.card-slot').first().boundingBox())!;
		const pxPerSec = scene1.width / 4;
		await page.mouse.move(bBox.x + 10, bBox.y + bBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(bBox.x + 10 + pxPerSec * 3.2, aBox.y + aBox.height / 2, { steps: 10 });
		await page.mouse.up();
		await expect.poll(async () => (await layers(page)).map((l) => l.row).sort()).toEqual([0, 0]);

		// Drag a above the top row onto b's time: a new top row.
		const a2 = await settledBox(page, a);
		await page.mouse.move(a2.x + 10, a2.y + a2.height / 2);
		await page.mouse.down();
		await page.mouse.move(a2.x + 10 + pxPerSec * 5, a2.y + a2.height / 2 - 60, { steps: 10 });
		// Showing the new row grows the track upwards; it must not flicker away under the pointer.
		await page.waitForTimeout(300);
		await expect(page.locator('.layers .new-row')).toBeVisible();
		await page.mouse.up();
		list = await layers(page);
		expect(list.find((l) => l.id === a)!.row).toBe(1);
		expect(list.find((l) => l.id === b)!.row).toBe(0);
	});

	test('items move with their scene, show a link line, and removing the scene asks', async ({ page }) => {
		await setup(page);
		// Over the green scene (4–7 s), 1 s in.
		const id = (await add(page, 'yellow.jpg', 5))!;
		const green = await scenes(page, (s) => (s as unknown as Store).project.scenes[1].id);
		expect((await layers(page))[0]).toMatchObject({ start: 5, sceneId: green });
		await expect(page.locator('.layers svg.link')).toBeVisible(); // selected: linked to its scene

		// Move green to the front: the item goes with it.
		await page.evaluate(() => (window as unknown as { __scenes: Store }).__scenes.moveScene(1, 0));
		expect((await layers(page))[0].start).toBe(1);
		// Trim the (now first) green scene's start by 1 s: its item comes along.
		await page.evaluate(() => (window as unknown as { __scenes: Store }).__scenes.undo());
		const red = await scenes(page, (s) => (s as unknown as Store).project.scenes[0].id);
		await page.evaluate((red) => (window as unknown as { __scenes: Store }).__scenes.trimScene(red, 'end', -1), red);
		expect((await layers(page))[0].start).toBe(4);

		// Remove the green scene: asked what to do with its layer. Keep in place…
		await page.getByRole('button', { name: /^Scene 2, / }).click();
		await page.getByRole('complementary', { name: 'Settings' }).getByRole('button', { name: 'Remove' }).click();
		const ask = page.getByRole('dialog', { name: 'Remove this scene’s layers too?' });
		await expect(ask).toContainText('One layer starts over this scene');
		await ask.getByRole('button', { name: 'Keep in place' }).click();
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toHaveCount(0);
		const kept = (await layers(page))[0];
		expect(kept.start).toBe(4);
		expect(kept.sceneId).not.toBe(green);
		// …or undo, and remove them too (one undo step each).
		await page.evaluate(() => (window as unknown as { __scenes: Store }).__scenes.undo());
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		await page.getByRole('button', { name: /^Scene 2, / }).click();
		await page.keyboard.press('Delete');
		await ask.getByRole('button', { name: 'Remove them too' }).click();
		expect(await layers(page)).toEqual([]);
		await expect(page.getByRole('group', { name: 'Layers' })).toContainText('Drop videos');
		void id;
	});
});
