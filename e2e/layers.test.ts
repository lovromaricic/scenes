import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, scenes } from './helpers';

type Store = {
	project: {
		scenes: { id: string }[];
		overlays: { id: string; name: string; trackId: string; start: number; duration: number }[];
		tracks: { id: string; kind: string; name: string }[];
	};
	addOverlayFromMedia(mediaId: string, start?: number, trackId?: string): string | null;
};

const state = (page: Page) =>
	scenes(page, (s) => {
		const p = (s as unknown as Store).project;
		return {
			tracks: p.tracks.map((t) => t.name),
			layers: p.overlays.map((o) => ({
				id: o.id,
				name: o.name,
				track: p.tracks.find((t) => t.id === o.trackId)!.name,
				start: Math.round(o.start * 100) / 100,
				duration: Math.round(o.duration * 100) / 100
			}))
		};
	});

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

const trackId = (page: Page, name: string) =>
	scenes(page, (s) => (s as unknown as Store).project.tracks).then((t) => t.find((x) => x.name === name)!.id);

const add = async (page: Page, name: string, start: number, track?: string) => {
	const id = await mediaId(page, name);
	const onto = track ? await trackId(page, track) : undefined;
	return page.evaluate(
		({ id, start, onto }) => (window as unknown as { __scenes: Store }).__scenes.addOverlayFromMedia(id, start, onto),
		{ id, start, onto }
	);
};

const slot = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);

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

test.describe('Overlay tracks', () => {
	test('a new video has an overlay track above the scenes and an audio track below', async ({ page }) => {
		await setup(page);
		const overlay = (await page.getByRole('group', { name: 'Overlay 1', exact: true }).boundingBox())!;
		const scenesRow = (await page.getByRole('group', { name: 'Scenes' }).boundingBox())!;
		const audio = (await page.getByRole('group', { name: 'Audio 1', exact: true }).boundingBox())!;
		expect(overlay.y + overlay.height).toBeLessThanOrEqual(scenesRow.y);
		expect(scenesRow.y + scenesRow.height).toBeLessThanOrEqual(audio.y);
		const headers = await page.locator('.storyboard .track-header .name').allInnerTexts();
		expect(headers).toEqual(['Overlay 1', 'Scenes', 'Audio 1']);
	});

	test('items show like scene cards, move in time, and trim (a video no longer than its clip)', async ({ page }) => {
		await setup(page);
		const id = (await add(page, 'yellow.jpg', 1))!;
		await expect(slot(page, id)).toBeVisible();
		await expect(slot(page, id).getByRole('button', { name: /^Layer: Yellow, from 1s for 5s/ })).toBeVisible();
		await expect(slot(page, id)).toContainText('Yellow');
		// It starts at 1 s: a quarter of the way into the 4 s red scene.
		const scene1 = await settled(page.locator('.card-slot').first());
		let box = await settled(slot(page, id));
		expect(box.x).toBeCloseTo(scene1.x + scene1.width / 4, -1);

		// Drag it right by about 2 s (Alt: no snapping): a gap before it, no problem.
		const pxPerSec = scene1.width / 4;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.keyboard.down('Alt');
		await page.mouse.move(box.x + box.width / 2 + pxPerSec * 2, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		await page.keyboard.up('Alt');
		await expect.poll(async () => (await state(page)).layers[0].start).toBeCloseTo(3, 0);

		// Drag its end edge left: shorter.
		box = await settled(slot(page, id));
		const end = slot(page, id).locator('[data-trim="end"]');
		const e = (await end.boundingBox())!;
		await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
		await page.mouse.down();
		await page.keyboard.down('Alt');
		await page.mouse.move(e.x + e.width / 2 - pxPerSec * 2, e.y + e.height / 2, { steps: 8 });
		await page.mouse.up();
		await page.keyboard.up('Alt');
		await expect.poll(async () => (await state(page)).layers[0].duration).toBeCloseTo(3, 0);

		// A 4 s video overlay can't be stretched past 4 s.
		const vid = (await add(page, 'red.mp4', 5, 'Overlay 1'))!;
		expect((await state(page)).layers.find((l) => l.id === vid)!.duration).toBe(4);
		const vend = slot(page, vid).locator('[data-trim="end"]');
		await expect(vend).toBeAttached();
		const ve = (await settled(slot(page, vid)))!;
		await page.mouse.move(ve.x + ve.width - 2, ve.y + ve.height / 2);
		await page.mouse.down();
		await page.keyboard.down('Alt');
		await page.mouse.move(ve.x + ve.width + pxPerSec * 3, ve.y + ve.height / 2, { steps: 8 });
		await page.mouse.up();
		await page.keyboard.up('Alt');
		await expect.poll(async () => (await state(page)).layers.find((l) => l.id === vid)!.duration).toBe(4);
	});

	test('overlapping items go on a new track just above; tracks draw in order', async ({ page }) => {
		await setup(page);
		const a = (await add(page, 'yellow.jpg', 0, 'Overlay 1'))!;
		const b = (await add(page, 'yellow.jpg', 2, 'Overlay 1'))!;
		// b overlaps a on Overlay 1, so it went on a new track just above.
		let s = await state(page);
		expect(s.tracks).toEqual(['Overlay 2', 'Overlay 1', 'Scenes', 'Audio 1']);
		expect(s.layers.find((l) => l.id === a)!.track).toBe('Overlay 1');
		expect(s.layers.find((l) => l.id === b)!.track).toBe('Overlay 2');
		const aBox = await settled(slot(page, a));
		const bBox = await settled(slot(page, b));
		expect(bBox.y).toBeLessThan(aBox.y); // higher track, higher on screen

		// Drag b down into a free spot on Overlay 1 (after a): the empty track stays (tracks are
		// yours to keep or delete).
		const scene1 = await settled(page.locator('.card-slot').first());
		const pxPerSec = scene1.width / 4;
		await page.mouse.move(bBox.x + 10, bBox.y + bBox.height / 2);
		await page.mouse.down();
		await page.keyboard.down('Alt');
		await page.mouse.move(bBox.x + 10 + pxPerSec * 3.2, aBox.y + aBox.height / 2, { steps: 10 });
		await page.mouse.up();
		await page.keyboard.up('Alt');
		s = await state(page);
		expect(s.layers.map((l) => l.track)).toEqual(['Overlay 1', 'Overlay 1']);
		expect(s.tracks).toEqual(['Overlay 2', 'Overlay 1', 'Scenes', 'Audio 1']);
	});
});
