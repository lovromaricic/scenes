import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixture, importViaPicker, openNewVideo } from './helpers';

type Api = {
	project: {
		tracks: { id: string; kind: string; name: string; collapsed?: boolean }[];
		overlays: { id: string; trackId: string; start: number }[];
	};
	addTrack(kind: 'overlay' | 'audio', index?: number, name?: string): string;
	addCardOverlay(start?: number, trackId?: string): string;
	setOverlayTiming(id: string, start: number, duration: number): void;
	deselect(): void;
};
const api = <T>(page: Page, fn: (s: Api) => T): Promise<T> =>
	page.evaluate(`(${fn.toString()})(window.__scenes)`) as Promise<T>;
const box = async (l: Locator) => (await l.boundingBox())!;
const scroller = (page: Page) => page.locator('.storyboard .tracks');
const scrollState = (page: Page) =>
	scroller(page).evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft, height: el.scrollHeight, client: el.clientHeight }));
const lane = (page: Page, name: string) => page.getByRole('group', { name, exact: true });
const divider = (page: Page) => page.getByRole('separator', { name: 'Resize the storyboard' });
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.keyboard.press('Escape');
}

async function dragDivider(page: Page, dy: number) {
	const d = await box(divider(page));
	await page.mouse.move(d.x + 300, d.y + d.height / 2);
	await page.mouse.down();
	await page.mouse.move(d.x + 300, d.y + d.height / 2 + dy, { steps: 6 });
	await page.mouse.up();
}

test.describe('Storyboard size and scrolling', () => {
	test('with 10 tracks the preview keeps its size; the tracks scroll under a fixed ruler and toolbar', async ({ page }) => {
		await setup(page);
		const preview = await box(page.getByTestId('preview'));
		const board = await box(page.getByRole('region', { name: 'Storyboard' }));
		// 7 more tracks: 10 in all.
		await api(page, (s) => {
			for (let i = 0; i < 7; i++) s.addTrack(i % 2 ? 'audio' : 'overlay');
		});
		await expect.poll(() => api(page, (s) => s.project.tracks.length)).toBe(10);
		expect(await box(page.getByTestId('preview'))).toEqual(preview);
		expect((await box(page.getByRole('region', { name: 'Storyboard' }))).height).toBeCloseTo(board.height, 0);

		const s = await scrollState(page);
		expect(s.height).toBeGreaterThan(s.client + 100);
		const view = await box(scroller(page));
		const fit = await box(page.getByRole('button', { name: 'Fit' }));
		// Scrolled to the bottom: the ruler and the toolbar are still at the top.
		await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
		const ruler = await box(page.locator('.storyboard .ruler'));
		expect(Math.abs(ruler.y - view.y)).toBeLessThan(2);
		expect(await box(page.getByRole('button', { name: 'Fit' }))).toEqual(fit);
		// Headers scroll with their tracks.
		const header = await box(page.locator('[data-track-header]').last());
		const last = await box(page.locator('[data-track-lane]').last());
		expect(Math.abs(header.y + header.height / 2 - (last.y + last.height / 2))).toBeLessThan(3);
		await expect(page.getByRole('button', { name: 'Audio track' })).toBeInViewport();
		// The Scenes track scrolls like the others (nothing hides behind it): at the top, the
		// overlay tracks fill the view.
		await scroller(page).evaluate((el) => (el.scrollTop = 0));
		await expect(lane(page, 'Scenes')).not.toBeInViewport({ ratio: 1 });
	});

	test('the wheel scrolls up and down, Shift + wheel sideways, Ctrl/Cmd + wheel zooms', async ({ page }) => {
		await setup(page);
		await api(page, (s) => {
			for (let i = 0; i < 6; i++) s.addTrack('overlay');
		});
		await page.getByRole('slider', { name: 'Storyboard zoom' }).fill('0.7');
		await scroller(page).evaluate((el) => {
			el.scrollTop = 0;
			el.scrollLeft = 0;
		});
		const v = await box(scroller(page));
		await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
		await page.mouse.wheel(0, 120);
		await expect.poll(async () => (await scrollState(page)).top).toBeGreaterThan(50);
		expect((await scrollState(page)).left).toBe(0);
		await page.keyboard.down('Shift');
		await page.mouse.wheel(0, 200);
		await page.keyboard.up('Shift');
		await expect.poll(async () => (await scrollState(page)).left).toBeGreaterThan(50);
		const width = (await scrollState(page)).height;
		const before = await scroller(page).evaluate((el) => el.scrollWidth);
		await page.keyboard.down(mod);
		await page.mouse.wheel(0, 200);
		await page.keyboard.up(mod);
		await expect.poll(() => scroller(page).evaluate((el) => el.scrollWidth)).toBeLessThan(before);
		expect(width).toBeGreaterThan(0);
	});

	test('the divider trades space between preview and storyboard, within limits, and is remembered', async ({ page }) => {
		await setup(page);
		const sep = divider(page);
		await expect(sep).toBeVisible();
		await sep.hover();
		await expect(sep).toHaveCSS('cursor', 'ns-resize');
		await expect(sep.locator('.grip')).toHaveCSS('opacity', '1');
		const board = () => box(page.getByRole('region', { name: 'Storyboard' }));
		const stage = () => box(page.locator('.workspace'));
		const initial = (await board()).height;

		// Up: a taller storyboard, a smaller preview.
		const previewBefore = await box(page.getByTestId('preview'));
		await dragDivider(page, -60);
		expect((await board()).height).toBeCloseTo(initial + 60, 0);
		expect((await box(page.getByTestId('preview'))).height).toBeLessThan(previewBefore.height);

		// Never past 40% of the window for the preview's area…
		await dragDivider(page, -2000);
		const windowH = await page.evaluate(() => innerHeight);
		expect((await stage()).height).toBeGreaterThanOrEqual(windowH * 0.4 - 1);
		expect((await stage()).height).toBeLessThan(windowH * 0.4 + 4);
		// …and never smaller than the ruler plus the Scenes track.
		await dragDivider(page, 2000);
		const small = await board();
		const scenes = await box(lane(page, 'Scenes'));
		const ruler = await box(page.locator('.storyboard .ruler'));
		const tracks = await box(scroller(page));
		expect(tracks.height).toBeGreaterThanOrEqual(ruler.height + scenes.height);
		expect(small.height).toBeLessThan(initial);

		// Remembered after a reload.
		await dragDivider(page, -80);
		const chosen = (await board()).height;
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		expect((await board()).height).toBeCloseTo(chosen, 0);

		// Double-click: back to the default.
		await divider(page).dblclick();
		expect((await board()).height).toBeCloseTo(initial, 0);
		// The keyboard moves it too.
		await divider(page).focus();
		await page.keyboard.press('ArrowUp');
		expect((await board()).height).toBeCloseTo(initial + 16, 0);
	});

	test('the default shows the ruler and about four tracks', async ({ page }) => {
		await setup(page);
		await api(page, (s) => {
			const t = s.project.tracks.find((x) => x.name === 'Overlay 1')!.id;
			s.addCardOverlay(0.5, t);
			s.addTrack('overlay', 0, 'Text');
			s.deselect();
		});
		// Text, Overlay 1, Scenes, Audio 1: all in view without scrolling.
		for (const name of ['Text', 'Overlay 1', 'Scenes', 'Audio 1']) await expect(lane(page, name)).toBeInViewport({ ratio: 1 });
		const s = await scrollState(page);
		expect(s.height).toBeLessThanOrEqual(s.client + 2);
	});

	test('slimmer tracks: pictures at 60% of Scenes, text and audio about 40 px', async ({ page }) => {
		await setup(page);
		await page.getByRole('button', { name: /^Words Titles/ }).click();
		await page.getByRole('button', { name: /^Title/ }).click();
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: /^Sound Music/ }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: /^Music Add a song/ }).click();
		await (await chooser).setFiles(fixture('music.m4a'));
		await expect(page.locator('.item-slot.sound')).toHaveCount(1);
		await page.keyboard.press('Escape');
		await api(page, (s) => {
			s.addCardOverlay(0.5, s.project.tracks.find((x) => x.name === 'Overlay 1')!.id);
			s.deselect();
		});
		const h = async (name: string) => (await box(lane(page, name))).height;
		const scenes = await h('Scenes');
		expect(await h('Overlay 1')).toBeCloseTo(scenes * 0.6, -1);
		expect(await h('Text')).toBeCloseTo(40, 0);
		expect(await h('Audio 1')).toBeCloseTo(40, 0);
		// Still readable: the words, the song's name and waveform, the card's thumbnail and name.
		await expect(lane(page, 'Text').getByText('Your title')).toBeVisible();
		await expect(lane(page, 'Audio 1').getByText('music')).toBeVisible();
		await expect(lane(page, 'Audio 1').locator('canvas, svg').first()).toBeVisible();
		await expect(lane(page, 'Overlay 1').locator('.thumb')).toBeVisible();
		// Handles are there to grab.
		await lane(page, 'Audio 1').locator('.item').click();
		const handle = await box(lane(page, 'Audio 1').locator('[data-trim="end"]'));
		expect(handle.height).toBeGreaterThanOrEqual(28);
	});

	test('tracks collapse to a thin strip with bars, and expand again; saved with the project', async ({ page }) => {
		await setup(page);
		const card = await api(page, (s) => {
			const c = s.addCardOverlay(1, s.project.tracks.find((x) => x.name === 'Overlay 1')!.id);
			s.deselect();
			return c;
		});
		await page.getByRole('button', { name: 'Collapse Overlay 1' }).click();
		expect((await box(lane(page, 'Overlay 1'))).height).toBeCloseTo(20, 0);
		await expect(lane(page, 'Overlay 1').locator(`[data-bar-id="${card}"]`)).toBeVisible();
		await expect(lane(page, 'Overlay 1').locator('.item')).toHaveCount(0);
		// Undo and redo (of adding the card) leave it collapsed; it's saved with the project.
		await page.keyboard.press(`${mod}+z`);
		await expect(lane(page, 'Overlay 1').locator('.bar')).toHaveCount(0);
		await page.keyboard.press(`${mod}+Shift+z`);
		await expect(lane(page, 'Overlay 1').locator('.bar')).toHaveCount(1);
		expect((await box(lane(page, 'Overlay 1'))).height).toBeCloseTo(20, 0);
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		expect(await api(page, (s) => s.project.tracks.find((t) => t.name === 'Overlay 1')!.collapsed)).toBe(true);
		await expect(page.getByRole('button', { name: 'Expand Overlay 1' })).toHaveAttribute('aria-expanded', 'false');
		await page.getByRole('button', { name: 'Expand Overlay 1' }).click();
		expect((await box(lane(page, 'Overlay 1'))).height).toBeGreaterThan(50);
		await expect(lane(page, 'Overlay 1').locator('.item')).toHaveCount(1);
	});

	test('dragging near the top or bottom edge scrolls; dragging still works when scrolled', async ({ page }) => {
		await setup(page);
		// Nine overlay tracks; a card on the top one.
		const card = await api(page, (s) => {
			for (let i = 0; i < 8; i++) s.addTrack('overlay', 0);
			const c = s.addCardOverlay(0, s.project.tracks[0].id);
			s.setOverlayTiming(c, 0, 2);
			s.deselect();
			return c;
		});
		await scroller(page).evaluate((el) => (el.scrollTop = 0));
		const item = page.locator(`[data-item-id="${card}"] .item`);
		const b = await box(item);
		const view = await box(scroller(page));
		await page.mouse.move(b.x + 20, b.y + b.height / 2);
		await page.mouse.down();
		await page.keyboard.down('Alt');
		// Hold at the bottom edge: the tracks scroll down until Overlay 1 (just above Scenes) shows.
		await page.mouse.move(b.x + 20, view.y + view.height - 6, { steps: 8 });
		await expect.poll(async () => (await scrollState(page)).top, { timeout: 5000 }).toBeGreaterThan(150);
		await expect(lane(page, 'Overlay 1')).toBeInViewport({ timeout: 10_000 });
		// The dragged card stays under the pointer.
		const moving = await box(page.locator(`[data-item-id="${card}"]`));
		expect(Math.abs(moving.y + moving.height / 2 - (view.y + view.height - 6))).toBeLessThan(40);
		// Drop it on Overlay 1: first away from the edges (the scrolling stops), then onto it.
		await page.mouse.move(b.x + 20, view.y + view.height / 2, { steps: 2 });
		const settledTop = (await scrollState(page)).top;
		await expect.poll(async () => (await scrollState(page)).top).toBe(settledTop);
		const target = await box(lane(page, 'Overlay 1'));
		await page.mouse.move(b.x + 20, target.y + target.height / 2);
		await page.mouse.up();
		await page.keyboard.up('Alt');
		expect(await api(page, (s) => s.project.tracks.find((t) => t.id === s.project.overlays[0].trackId)!.name)).toBe('Overlay 1');

		// Scrolled down, a plain drag in time works as before.
		const now = await box(item);
		const pps = (await box(page.locator('.card-slot').first())).width / 4;
		await page.mouse.move(now.x + 20, now.y + now.height / 2);
		await page.mouse.down();
		await page.keyboard.down('Alt');
		await page.mouse.move(now.x + 20 + pps, now.y + now.height / 2, { steps: 6 });
		await page.mouse.up();
		await page.keyboard.up('Alt');
		expect(await api(page, (s) => Math.round(s.project.overlays[0].start * 10) / 10)).toBeCloseTo(1, 0);

		// And back up: hold at the top edge.
		const up = await box(item);
		await page.mouse.move(up.x + 20, up.y + up.height / 2);
		await page.mouse.down();
		await page.mouse.move(up.x + 20, view.y + 30, { steps: 8 });
		await expect.poll(async () => (await scrollState(page)).top, { timeout: 5000 }).toBe(0);
		await page.mouse.up();
	});

	test('a new track scrolls into view', async ({ page }) => {
		await setup(page);
		await api(page, (s) => {
			for (let i = 0; i < 6; i++) s.addTrack('overlay');
		});
		await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
		// "+ Overlay track" stays in the fixed ruler corner; the new top track comes into view.
		await page.getByRole('button', { name: 'Overlay track' }).click();
		const top = await api(page, (s) => s.project.tracks[0].name);
		await expect(lane(page, top)).toBeInViewport();
		// "+ Audio track" at the bottom: the new audio track shows.
		await page.getByRole('button', { name: 'Audio track' }).click();
		await expect(lane(page, 'Audio 2')).toBeInViewport();
	});
});
