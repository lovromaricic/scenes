import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, textAreaPixels } from './helpers';

type Api = {
	project: {
		tracks: { id: string; kind: string; name: string }[];
		texts: { id: string; trackId: string; start: number }[];
		overlays: { id: string; trackId: string }[];
	};
	addCardOverlay(start?: number, trackId?: string): string;
	setOverlayCard(id: string, card: object): void;
	setOverlayBox(id: string, box: object): void;
	setOverlayTiming(id: string, start: number, duration: number): void;
	setTrackFlag(id: string, flag: string, on: boolean): void;
	moveTrack(id: string, index: number): void;
	stopEditingText(): void;
	deselect(): void;
};
const api = <T>(page: Page, fn: (s: Api) => T): Promise<T> =>
	page.evaluate(`(${fn.toString()})(window.__scenes)`) as Promise<T>;
const names = (page: Page) => api(page, (s) => s.project.tracks.map((t) => t.name));
const isGreen = ([r, g, b]: [number, number, number]) => g > 200 && r < 60 && b < 60;

async function addTitle(page: Page, words: string) {
	await page.getByRole('button', { name: /^Words Titles/ }).click();
	await page.getByRole('button', { name: /^Title/ }).click();
	await page.keyboard.type(words);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
}

test.describe('Words on tracks', () => {
	test('Words adds to the "Text" track at the playhead, making it when needed', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		expect(await names(page)).toEqual(['Overlay 1', 'Scenes', 'Audio 1']);

		await addTitle(page, 'Hello');
		expect(await names(page)).toEqual(['Text', 'Overlay 1', 'Scenes', 'Audio 1']);
		await expect(page.getByRole('group', { name: 'Text', exact: true }).getByRole('button', { name: /^Words: Hello/ })).toBeVisible();

		// Later on, the same track.
		await page.evaluate(() => (window as unknown as { __scenes: { seek(t: number): void } }).__scenes.seek(4));
		await addTitle(page, 'Again');
		expect(await names(page)).toEqual(['Text', 'Overlay 1', 'Scenes', 'Audio 1']);
		expect(await api(page, (s) => new Set(s.project.texts.map((t) => t.trackId)).size)).toBe(1);

		// A locked (or hidden) Text track isn't used: new words get a Text track of their own.
		await api(page, (s) => s.setTrackFlag(s.project.tracks[0].id, 'locked', true));
		await page.evaluate(() => (window as unknown as { __scenes: { seek(t: number): void } }).__scenes.seek(1));
		await addTitle(page, 'Third');
		expect(await names(page)).toEqual(['Text', 'Text', 'Overlay 1', 'Scenes', 'Audio 1']);
	});

	test('words are drawn by their track’s place: under a card on a higher track, over it when above', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		// A full-frame green card on Overlay 1, the whole time.
		await api(page, (s) => {
			const c = s.addCardOverlay(0, s.project.tracks[0].id);
			s.setOverlayCard(c, { background: '#00ff00', rect: null });
			s.setOverlayBox(c, { x: 0, y: 0, w: 1, h: 1 });
			s.setOverlayTiming(c, 0, 7);
		});
		await addTitle(page, 'Over the card');
		// The Text track is on top: the words show over the green.
		await expect.poll(async () => (await textAreaPixels(page)).filter((p) => !isGreen(p)).length).toBeGreaterThan(5);

		// Drag the words down into the gap between Overlay 1 and Scenes: a new track under the card.
		const text = page.getByRole('button', { name: /^Words: Over the card, from/ });
		const b = (await text.boundingBox())!;
		const card = (await page.getByRole('group', { name: 'Overlay 1', exact: true }).boundingBox())!;
		const scenes = (await page.getByRole('group', { name: 'Scenes', exact: true }).boundingBox())!;
		await page.mouse.move(b.x + 12, b.y + b.height / 2);
		await page.mouse.down();
		await page.mouse.move(b.x + 12, (card.y + card.height + scenes.y) / 2, { steps: 10 });
		await expect(page.locator('.gap-line')).toHaveCount(1);
		await page.mouse.up();
		expect(await names(page)).toEqual(['Text', 'Overlay 1', 'Overlay 2', 'Scenes', 'Audio 1']);
		const onTrack = await api(page, (s) => s.project.tracks.find((t) => t.id === s.project.texts[0].trackId)!.name);
		expect(onTrack).toBe('Overlay 2');
		// Hidden by the card now.
		await expect.poll(async () => (await textAreaPixels(page)).filter((p) => !isGreen(p)).length).toBe(0);

		// Move that track to the top: over the card again.
		await api(page, (s) => s.moveTrack(s.project.texts[0].trackId, 0));
		await expect.poll(async () => (await textAreaPixels(page)).filter((p) => !isGreen(p)).length).toBeGreaterThan(5);
	});
});
