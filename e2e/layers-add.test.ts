import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

type Placed = { overlay: { id: string; kind: string; name: string; trackId: string; duration: number; box: { x: number; y: number; w: number; h: number } }; start: number };
const layers = (page: Page) =>
	scenes(page, (s) =>
		(s as unknown as { placedOverlays: Placed[] }).placedOverlays.map((p) => ({
			...p.overlay,
			start: Math.round(p.start * 100) / 100
		}))
	);
const sceneNames = (page: Page) =>
	scenes(page, (s) => (s as unknown as { project: { scenes: { name: string }[] } }).project.scenes.map((x) => x.name));

type Payload = { media?: string; card?: boolean; files?: { name: string; type: string; data: string }[] };

/** Dispatch drag events at a point, as a drag from "Your media", the Cards button or the computer. */
async function drag(page: Page, x: number, y: number, payload: Payload, types: string[]) {
	await page.evaluate(
		({ x, y, payload, types }) => {
			const dt = new DataTransfer();
			if (payload.media) dt.setData('application/x-scenes-media', payload.media);
			if (payload.card) dt.setData('application/x-scenes-card', 'card');
			for (const f of payload.files ?? []) {
				dt.items.add(new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
			}
			const target = document.elementFromPoint(x, y)!;
			for (const type of types) {
				target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
			}
		},
		{ x, y, payload, types }
	);
}
const hover = (page: Page, x: number, y: number, p: Payload) => drag(page, x, y, p, ['dragenter', 'dragover']);
const drop = (page: Page, x: number, y: number, p: Payload) => drag(page, x, y, p, ['dragenter', 'dragover', 'drop']);
const file = (name: string, type: string) => ({ name, type, data: readFileSync(fixture(name)).toString('base64') });

const mediaId = (page: Page, name: string) =>
	page.evaluate(
		(name) =>
			Object.values((window as unknown as { __scenes: { media: Record<string, { id: string; name: string }> } }).__scenes.media).find(
				(m) => m.name === name
			)!.id,
		name
	);

/** Scenes: red 4 s, green 3 s, blue 3 s; the yellow photo only in "Your media". */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm', 'yellow.jpg'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 4, / })).toBeVisible();
	await page.getByRole('button', { name: /^Scene 4, / }).click();
	await page.keyboard.press('Delete');
	await expect(page.getByRole('button', { name: /^Scene 4, / })).toHaveCount(0);
}

/** A box once it has stopped moving (cards slide when scenes change). */
async function box(page: Page, selector: string) {
	const locator = page.locator(selector).first();
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

test.describe('Adding layers by dragging', () => {
	test('from Your media onto the picture: a layer on the scene at the playhead, centred at 40%', async ({ page }) => {
		await setup(page);
		await seekTo(page, 5);
		const preview = (await page.getByTestId('preview').boundingBox())!;

		// While dragging over the picture, it shows where the layer goes.
		const id = await mediaId(page, 'yellow.jpg');
		await hover(page, preview.x + preview.width / 2, preview.y + preview.height / 2, { media: id });
		await expect(page.locator('.drop-target')).toBeVisible();
		await expect(page.locator('.drop-target')).toContainText('Drop to place on top of this scene');
		await drag(page, preview.x + 5, preview.y + 5, { media: id }, ['dragleave']);

		// A real drag and drop with the mouse.
		const tile = page.getByRole('button', { name: /^yellow\.jpg, photo/ });
		await tile.dragTo(page.getByTestId('preview'));
		await expect.poll(async () => (await layers(page)).length).toBe(1);
		const [layer] = await layers(page);
		expect(layer).toMatchObject({ kind: 'photo', name: 'Yellow', start: 5, duration: 5 });
		expect(layer.box.w).toBeCloseTo(0.4);
		expect(layer.box.x + layer.box.w / 2).toBeCloseTo(0.5);
		expect(layer.box.y + layer.box.h / 2).toBeCloseTo(0.5);
		await expect(page.locator('.drop-target')).toHaveCount(0);
		// Not a new scene.
		expect(await sceneNames(page)).toEqual(['Red', 'Green', 'Blue']);

		// A clip shorter than 5 s keeps its own length.
		await seekTo(page, 1);
		await drop(page, preview.x + preview.width / 2, preview.y + preview.height / 2, { media: await mediaId(page, 'green.mp4') });
		const green = (await layers(page)).find((l) => l.name === 'Green')!;
		expect(green).toMatchObject({ kind: 'video', start: 1, duration: 3 });
	});

	test('the Cards button and files from the computer onto an overlay track, at that time', async ({ page }) => {
		await setup(page);
		const lane = await box(page, '[data-track-lane]');
		const scene1 = await box(page, '.card-slot');
		const pxPerSec = scene1.width / 4;
		const x = lane.x + pxPerSec * 6; // 6 s
		const y = lane.y + lane.height / 2;

		await hover(page, x, y, { card: true });
		await expect(page.locator('[data-track-lane] .drop-ghost')).toBeVisible();
		await expect(page.locator('[data-track-lane] .drop-ghost')).toContainText('Place here');
		await drop(page, x, y, { card: true });
		await expect(page.locator('[data-track-lane] .drop-ghost')).toHaveCount(0);
		let list = await layers(page);
		expect(list).toHaveLength(1);
		const overlay1 = await scenes(page, (s) => (s as unknown as { project: { tracks: { id: string; name: string }[] } }).project.tracks.find((t) => t.name === 'Overlay 1')!.id);
		expect(list[0]).toMatchObject({ kind: 'card', trackId: overlay1 });
		expect(list[0].start).toBeCloseTo(6, 0);

		// A photo from the computer onto the same time: it overlaps, so it goes on a new track above.
		// (The card goes on past the last scene, so the video got longer and Fit rescaled: 6 s again.)
		const pxNow = (await box(page, '.card-slot')).width / 4;
		const x6 = lane.x + pxNow * 6;
		await drop(page, x6, y, { files: [file('yellow.jpg', 'image/jpeg')] });
		await expect.poll(async () => (await layers(page)).length).toBe(2);
		list = await layers(page);
		const photo = list.find((l) => l.kind === 'photo')!;
		expect(photo.start).toBeCloseTo(6, 0);
		const tracks = await scenes(page, (s) => (s as unknown as { project: { tracks: { id: string; name: string }[] } }).project.tracks);
		expect(tracks.map((t) => t.name)).toEqual(['Overlay 2', 'Overlay 1', 'Scenes', 'Audio 1']);
		expect(photo.trackId).toBe(tracks[0].id);
		expect(await sceneNames(page)).toEqual(['Red', 'Green', 'Blue']);
	});

	test('onto the Scenes track it becomes a scene, where dropped; the page hint shows while dragging files', async ({ page }) => {
		await setup(page);
		const first = await box(page, '.card-slot');
		// Between scene 1 and 2.
		const x = first.x + first.width - 4;
		const y = first.y + first.height / 2;
		await hover(page, x, y, { media: await mediaId(page, 'yellow.jpg') });
		await expect(page.locator('.drop-marker')).toBeVisible();
		await drop(page, x, y, { media: await mediaId(page, 'yellow.jpg') });
		await expect.poll(() => sceneNames(page)).toEqual(['Red', 'Yellow', 'Green', 'Blue']);

		// Files from the computer onto the Scenes track: scenes at that spot.
		const blue = (await page.locator('.card-slot').nth(3).boundingBox())!;
		await drop(page, blue.x + 6, blue.y + blue.height / 2, { files: [file('green.mp4', 'video/mp4')] });
		await expect.poll(() => sceneNames(page)).toEqual(['Red', 'Yellow', 'Green', 'Green', 'Blue']);
		expect(await layers(page)).toEqual([]);

		// Dragging files over the page: a hint says where they can go.
		const preview = (await page.getByTestId('preview').boundingBox())!;
		await hover(page, preview.x + 10, preview.y + 10, { files: [file('yellow.jpg', 'image/jpeg')] });
		await expect(page.getByText('Drop on the picture or an overlay track to place on top')).toBeVisible();
	});

	test('with no scenes yet, a drop on the picture makes the first scene', async ({ page }) => {
		await openNewVideo(page);
		const preview = (await page.getByTestId('preview').boundingBox())!;
		await drop(page, preview.x + preview.width / 2, preview.y + preview.height / 2, {
			files: [file('red.mp4', 'video/mp4')]
		});
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		expect(await layers(page)).toEqual([]);
	});
});
