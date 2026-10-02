import { expect, test, type Locator, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

type Item = { id: string; trackId: string; start: number; duration: number };
type Api = {
	project: {
		tracks: { id: string; kind: string; name: string }[];
		overlays: (Item & { name: string; kind: string })[];
		texts: Item[];
		sounds: Item[];
		scenes: { id: string; name: string }[];
	};
	media: Record<string, { id: string; name: string }>;
	selectedIds: string[];
	activeTrackId: string | null;
	addCardOverlay(start?: number, trackId?: string): string;
	addTrack(kind: 'overlay' | 'audio', index?: number, name?: string): string;
	setOverlayTiming(id: string, start: number, duration: number): void;
};
const api = <T>(page: Page, fn: (s: Api) => T): Promise<T> =>
	page.evaluate(`(${fn.toString()})(window.__scenes)`) as Promise<T>;
const names = (page: Page) => api(page, (s) => s.project.tracks.map((t) => t.name));
/** Each overlay as [track name, start] (rounded), in the order they were added. */
const placement = (page: Page) =>
	api(page, (s) =>
		s.project.overlays.map((o) => [s.project.tracks.find((t) => t.id === o.trackId)!.name, Math.round(o.start * 10) / 10])
	);
const lane = (page: Page, name: string) => page.getByRole('group', { name, exact: true });
const card = (page: Page, id: string) => page.locator(`[data-item-id="${id}"] .item`);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function settled(locator: Locator) {
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

async function dragTo(page: Page, item: Locator, x: number, y: number) {
	const b = (await item.boundingBox())!;
	await page.mouse.move(b.x + 12, b.y + b.height / 2);
	await page.mouse.down();
	await page.keyboard.down('Alt'); // no snapping
	await page.mouse.move(x, y, { steps: 10 });
	await page.mouse.up();
	await page.keyboard.up('Alt');
}

/**
 * Red (4 s) and green (3 s) scenes; tracks Overlay 2 and Overlay 1; cards A (0–2 s) on Overlay 1
 * and B (4–6 s) on Overlay 2. Returns their ids and the pixels per second.
 */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4', 'yellow.jpg'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
	await page.getByRole('button', { name: /^Scene 3, / }).click();
	await page.keyboard.press('Delete');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toHaveCount(0);
	const ids = await api(page, (s) => {
		const low = s.project.tracks.find((t) => t.kind === 'overlay')!.id;
		const high = s.addTrack('overlay', 0);
		const a = s.addCardOverlay(0, low);
		s.setOverlayTiming(a, 0, 2);
		const b = s.addCardOverlay(4, high);
		s.setOverlayTiming(b, 4, 2);
		return { a, b };
	});
	const scene = await settled(page.locator('.card-slot').first());
	return { ...ids, pps: scene.width / 4 };
}

test.describe('Placing and moving items on tracks', () => {
	test('drag between tracks of the right kind; into a gap or above the top track makes a new track', async ({ page }) => {
		const { a, b, pps } = await setup(page);
		expect(await names(page)).toEqual(['Overlay 2', 'Overlay 1', 'Scenes', 'Audio 1']);

		// A up onto Overlay 2, at 1 s.
		const high = (await lane(page, 'Overlay 2').boundingBox())!;
		const aBox = (await card(page, a).boundingBox())!;
		await dragTo(page, card(page, a), aBox.x + 12 + pps, high.y + high.height / 2);
		expect(await placement(page)).toEqual([['Overlay 2', 1], ['Overlay 2', 4]]);

		// Not onto the audio track: it stays on its own track (time still changes).
		const audio = (await lane(page, 'Audio 1').boundingBox())!;
		const bBox = (await card(page, b).boundingBox())!;
		await dragTo(page, card(page, b), bBox.x + 12, audio.y + audio.height / 2);
		expect((await placement(page))[1][0]).toBe('Overlay 2');

		// Into the gap between Overlay 2 and Overlay 1: a new track there.
		const low = (await lane(page, 'Overlay 1').boundingBox())!;
		const gapY = (high.y + high.height + low.y) / 2;
		const bNow = (await card(page, b).boundingBox())!;
		await page.mouse.move(bNow.x + 12, bNow.y + bNow.height / 2);
		await page.mouse.down();
		await page.mouse.move(bNow.x + 12, gapY, { steps: 10 });
		await expect(page.locator('.gap-line')).toHaveCount(1);
		await page.mouse.up();
		expect(await names(page)).toEqual(['Overlay 2', 'Overlay 3', 'Overlay 1', 'Scenes', 'Audio 1']);
		expect(await placement(page)).toEqual([['Overlay 2', 1], ['Overlay 3', 4]]);

		// Above the top track: a new top track.
		const top = (await lane(page, 'Overlay 2').boundingBox())!;
		const aNow = (await card(page, a).boundingBox())!;
		await dragTo(page, card(page, a), aNow.x + 12, top.y - 2);
		expect((await names(page))[0]).toBe('Overlay 4');
		expect((await placement(page))[0]).toEqual(['Overlay 4', 1]);
	});

	test('dropped on another item, it goes on a new track just above', async ({ page }) => {
		const { a, b } = await setup(page);
		const bBox = (await card(page, b).boundingBox())!;
		const aBox = (await card(page, a).boundingBox())!;
		// A onto B (same time, Overlay 2).
		await dragTo(page, card(page, a), bBox.x + 12, bBox.y + bBox.height / 2);
		expect(await names(page)).toEqual(['Overlay 3', 'Overlay 2', 'Overlay 1', 'Scenes', 'Audio 1']);
		const [pa, pb] = await placement(page);
		expect(pa[0]).toBe('Overlay 3');
		expect(pa[1]).toBeCloseTo(4, 0);
		expect(pb).toEqual(['Overlay 2', 4]);
		expect(aBox).toBeTruthy();
	});

	test('media dropped on the picture goes to the top overlay track free at the playhead, or a new one', async ({ page }) => {
		const { a, b } = await setup(page);
		expect(a).toBeTruthy();
		// B later (6–7 s), so a 5 s photo from 0.5 s fits on Overlay 2 (the whole photo must fit).
		await page.evaluate((b) => (window as unknown as { __scenes: Api }).__scenes.setOverlayTiming(b, 6, 1), b);
		const tile = page.getByRole('button', { name: /^yellow\.jpg, photo/ });
		// At 0.5 s: Overlay 2 is free there.
		await page.keyboard.press('Escape');
		await seekTo(page, 0.5);
		await tile.dragTo(page.getByTestId('preview'), { targetPosition: { x: 20, y: 20 } });
		await expect.poll(async () => (await placement(page)).length).toBe(3);
		expect((await placement(page))[2]).toEqual(['Overlay 2', 0.5]);
		// Again at 0.5 s: both tracks are busy now, so a new top track.
		await page.keyboard.press('Escape');
		await tile.dragTo(page.getByTestId('preview'), { targetPosition: { x: 20, y: 20 } });
		await expect.poll(async () => (await placement(page)).length).toBe(4);
		expect((await placement(page))[3]).toEqual(['Overlay 3', 0.5]);
		expect((await names(page))[0]).toBe('Overlay 3');
	});

	test('select several with Shift-click or a selection box; they move and delete together', async ({ page }) => {
		const { a, b, pps } = await setup(page);
		await card(page, a).click();
		await card(page, b).click({ modifiers: ['Shift'] });
		expect((await api(page, (s) => s.selectedIds)).sort()).toEqual([a, b].sort());
		await expect(page.locator('.item.selected')).toHaveCount(2);

		// Dragging one moves both by the same amount (each on its own track).
		const aBox = (await card(page, a).boundingBox())!;
		await dragTo(page, card(page, a), aBox.x + 12 + pps, aBox.y + aBox.height / 2);
		expect(await placement(page)).toEqual([['Overlay 1', 1], ['Overlay 2', 5]]);

		// Shift-click takes one out again.
		await card(page, b).click({ modifiers: ['Shift'] });
		expect(await api(page, (s) => s.selectedIds)).toEqual([a]);

		// A box from an empty spot selects everything it touches.
		await page.keyboard.press('Escape');
		const high = (await lane(page, 'Overlay 2').boundingBox())!;
		const low = (await lane(page, 'Overlay 1').boundingBox())!;
		await page.mouse.move(high.x + high.width - 20, high.y + 4);
		await page.mouse.down();
		await page.mouse.move(high.x + 2, low.y + low.height - 4, { steps: 8 });
		await expect(page.locator('.band')).toBeVisible();
		await page.mouse.up();
		await expect(page.locator('.band')).toHaveCount(0);
		expect((await api(page, (s) => s.selectedIds)).sort()).toEqual([a, b].sort());

		// Delete removes both, as one step.
		await page.keyboard.press('Delete');
		expect(await placement(page)).toEqual([]);
		await page.keyboard.press(`${mod}+z`);
		expect((await placement(page)).length).toBe(2);
	});

	test('copy, cut and paste: to the selected track at the playhead, keeping their spacing', async ({ page }) => {
		const { a, b } = await setup(page);
		// Copy A, paste at 5 s: on A's track (the selected one).
		await card(page, a).click();
		await page.keyboard.press(`${mod}+c`);
		await seekTo(page, 5);
		await page.keyboard.press(`${mod}+v`);
		expect(await placement(page)).toEqual([['Overlay 1', 0], ['Overlay 2', 4], ['Overlay 1', 5]]);
		// The copy is selected, and is a card like A.
		const copy = await api(page, (s) => s.selectedIds[0]);
		expect(copy).not.toBe(a);

		// Click an empty spot on Overlay 2 to make it the selected track; paste at 0.5 s.
		const high = (await lane(page, 'Overlay 2').boundingBox())!;
		await page.mouse.click(high.x + high.width - 10, high.y + high.height / 2);
		expect(await api(page, (s) => s.activeTrackId)).toBe(await api(page, (s) => s.project.tracks[0].id));
		await seekTo(page, 0.5);
		await page.keyboard.press(`${mod}+v`);
		expect((await placement(page))[3]).toEqual(['Overlay 2', 0.5]);

		// Both A and B together: pasted at 6 s, 4 s apart as before; B's copy overlaps nothing.
		await card(page, a).click();
		await card(page, b).click({ modifiers: ['Shift'] });
		await page.keyboard.press(`${mod}+c`);
		await seekTo(page, 6.9);
		await page.keyboard.press(`${mod}+v`);
		const after = await placement(page);
		expect(after.length).toBe(6);
		const pasted = after.slice(4).map((p) => p[1]);
		expect((pasted[1] as number) - (pasted[0] as number)).toBeCloseTo(4, 1);
		expect(await api(page, (s) => s.selectedIds.length)).toBe(2);

		// Cut removes; paste brings them back at the playhead. One undo each.
		await page.keyboard.press(`${mod}+x`);
		expect((await placement(page)).length).toBe(4);
		await seekTo(page, 1);
		await page.keyboard.press(`${mod}+v`);
		expect((await placement(page)).length).toBe(6);
		await page.keyboard.press(`${mod}+z`);
		expect((await placement(page)).length).toBe(4);
	});
});
