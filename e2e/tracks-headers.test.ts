import { expect, test, type Page } from '@playwright/test';
import { fixture, importViaPicker, openNewVideo, seekTo } from './helpers';

type RGB = [number, number, number];
type Api = {
	project: {
		tracks: { id: string; kind: string; name: string; hidden: boolean; muted: boolean; locked: boolean }[];
		overlays: { id: string; trackId: string; start: number }[];
		sounds: { id: string; trackId: string }[];
	};
	selectedId: string | null;
	player: { readPixel(x: number, y: number): number[]; isFrameReady(): boolean };
	addCardOverlay(start?: number, trackId?: string): string;
	setOverlayBox(id: string, box: object): void;
	setOverlayCard(id: string, card: object): void;
	mixdown(a: number, b: number): Promise<AudioBuffer>;
};
const api = <T>(page: Page, fn: (s: Api) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__scenes)`) as Promise<T>;
const names = (page: Page) => api(page, (s) => s.project.tracks.map((t) => t.name));
const track = (page: Page, name: string) =>
	page.evaluate(
		(name) => JSON.parse(JSON.stringify((window as unknown as { __scenes: Api }).__scenes.project.tracks.find((t) => t.name === name) ?? null)),
		name
	) as Promise<Api['project']['tracks'][number] | null>;
const header = (page: Page, name: string) => page.locator(`[data-track-header]`).filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function previewPixel(page: Page, fx: number, fy: number): Promise<RGB> {
	await expect.poll(() => api(page, (s) => s.player.isFrameReady()), { timeout: 10_000 }).toBe(true);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	return page.evaluate(
		({ fx, fy }) => {
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const s = (window as unknown as { __scenes: Api }).__scenes;
			const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
			return [p[0], p[1], p[2]] as RGB;
		},
		{ fx, fy }
	);
}

const loudness = (page: Page, from: number, to: number) =>
	page.evaluate(
		async ({ from, to }) => {
			const s = (window as unknown as { __scenes: Api }).__scenes;
			const data = (await s.mixdown(from, to)).getChannelData(0);
			let sum = 0;
			for (const v of data) sum += v * v;
			return Math.sqrt(sum / data.length);
		},
		{ from, to }
	);

/** Red (4 s) and yellow (3 s), a green card top-left on Overlay 1 from 0 s. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'yellow.jpg'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	return api(page, (s) => {
		const card = s.addCardOverlay(0, s.project.tracks[0].id);
		s.setOverlayCard(card, { background: '#00ff00', rect: null });
		s.setOverlayBox(card, { x: 0.6, y: 0.6, w: 0.4, h: 0.4 });
		return card;
	});
}

test.describe('Track headers', () => {
	test('add tracks with the buttons, rename by double-click or the menu; Scenes keeps its name', async ({ page }) => {
		await setup(page);
		expect(await names(page)).toEqual(['Overlay 1', 'Scenes', 'Audio 1']);
		await page.getByRole('button', { name: 'Overlay track' }).click();
		await page.getByRole('button', { name: 'Audio track' }).click();
		expect(await names(page)).toEqual(['Overlay 2', 'Overlay 1', 'Scenes', 'Audio 1', 'Audio 2']);

		// Double-click to rename; Enter keeps it, Esc doesn't.
		await header(page, 'Overlay 2').locator('.name').dblclick();
		const input = page.getByRole('textbox', { name: 'Track name' });
		await expect(input).toBeFocused();
		await input.fill('Logo');
		await input.press('Enter');
		await expect.poll(() => names(page)).toEqual(['Logo', 'Overlay 1', 'Scenes', 'Audio 1', 'Audio 2']);
		await expect(page.getByRole('group', { name: 'Logo', exact: true })).toBeVisible();
		await header(page, 'Audio 2').locator('.name').dblclick();
		await page.getByRole('textbox', { name: 'Track name' }).fill('Nope');
		await page.getByRole('textbox', { name: 'Track name' }).press('Escape');
		expect(await names(page)).toContain('Audio 2');

		// From the menu.
		await page.getByRole('button', { name: 'Audio 2 options' }).click();
		await page.getByRole('menu', { name: 'Audio 2 options' }).getByRole('menuitem', { name: 'Rename' }).click();
		await page.getByRole('textbox', { name: 'Track name' }).fill('Voice');
		await page.getByRole('textbox', { name: 'Track name' }).press('Enter');
		await expect.poll(() => names(page)).toEqual(['Logo', 'Overlay 1', 'Scenes', 'Audio 1', 'Voice']);

		// The Scenes track can't be renamed, and has no menu.
		await header(page, 'Scenes').locator('.name').dblclick();
		await expect(page.getByRole('textbox', { name: 'Track name' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Scenes options' })).toHaveCount(0);

		// Undo takes the renames back one by one.
		await page.keyboard.press(`${mod}+z`);
		await expect.poll(() => names(page)).toContain('Audio 2');
	});

	test('hide leaves a track out of the picture, mute out of the sound; both are dimmed and saved', async ({ page }) => {
		await setup(page);
		await seekTo(page, 1);
		const green = await previewPixel(page, 0.8, 0.8);
		expect(green[1]).toBeGreaterThan(200);
		expect(green[0]).toBeLessThan(80);

		await page.getByRole('button', { name: 'Hide Overlay 1' }).click();
		await expect.poll(async () => (await previewPixel(page, 0.8, 0.8))[0]).toBeGreaterThan(200); // red scene
		await expect(page.locator('[data-track-lane] .lane-items.dimmed')).toHaveCount(1);
		await expect(header(page, 'Overlay 1')).toHaveClass(/dimmed/);
		await page.getByRole('button', { name: 'Show Overlay 1' }).click();
		await expect.poll(async () => (await previewPixel(page, 0.8, 0.8))[1]).toBeGreaterThan(200);

		// Mute: the song is left out of the mix (the clips' own sound is turned off here).
		await page.evaluate(() => {
			const s = (window as unknown as { __scenes: { project: { scenes: { id: string }[] }; setSceneVolume(id: string, v: number): void } }).__scenes;
			for (const sc of s.project.scenes) s.setSceneVolume(sc.id, 0);
		});
		await page.getByRole('button', { name: /^Sound Music/ }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: /^Music Add a song/ }).click();
		await (await chooser).setFiles(fixture('music.m4a'));
		await expect(page.locator('.item-slot.sound')).toHaveCount(1);
		await page.keyboard.press('Escape');
		const loud = await loudness(page, 1, 2);
		expect(loud).toBeGreaterThan(0.01);
		await page.getByRole('button', { name: 'Mute Audio 1' }).click();
		await expect(page.getByRole('button', { name: 'Unmute Audio 1' })).toHaveAttribute('aria-pressed', 'true');
		expect(await loudness(page, 1, 2)).toBeLessThan(0.001);

		// Kept after a reload.
		await page.getByRole('button', { name: 'Hide Overlay 1' }).click();
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		expect((await track(page, 'Overlay 1'))!.hidden).toBe(true);
		expect((await track(page, 'Audio 1'))!.muted).toBe(true);
	});

	test('a locked track’s items can’t be selected, moved or changed', async ({ page }) => {
		const card = await setup(page);
		const item = page.locator(`[data-item-id="${card}"] .item`);
		await page.getByRole('button', { name: 'Lock Overlay 1' }).click();
		await item.click({ force: true });
		expect(await api(page, (s) => s.selectedId)).toBeNull();
		const b = (await item.boundingBox())!;
		await page.mouse.move(b.x + 20, b.y + 10);
		await page.mouse.down();
		await page.mouse.move(b.x + 220, b.y + 10, { steps: 8 });
		await page.mouse.up();
		expect(await api(page, (s) => s.project.overlays[0].start)).toBe(0);
		// Nor on the picture.
		await expect(page.getByRole('button', { name: /^Move layer/ })).toHaveCount(0);

		await page.getByRole('button', { name: 'Unlock Overlay 1' }).click();
		await item.click();
		expect(await api(page, (s) => s.selectedId)).toBe(card);
		// Locking deselects what's on it.
		await page.getByRole('button', { name: 'Lock Overlay 1' }).click();
		expect(await api(page, (s) => s.selectedId)).toBeNull();
	});

	test('duplicate a track with its items; delete asks first when it has items; undo brings it back', async ({ page }) => {
		await setup(page);
		await page.getByRole('button', { name: 'Overlay 1 options' }).click();
		await page.getByRole('menuitem', { name: 'Duplicate track' }).click();
		expect(await names(page)).toEqual(['Overlay 1 copy', 'Overlay 1', 'Scenes', 'Audio 1']);
		expect(await api(page, (s) => s.project.overlays.length)).toBe(2);
		await expect(page.locator('.item-slot.overlay')).toHaveCount(2);

		// With items: a question first. Cancel keeps it.
		await page.getByRole('button', { name: 'Overlay 1 copy options' }).click();
		await page.getByRole('menuitem', { name: 'Delete track' }).click();
		const dialog = page.getByRole('dialog', { name: 'Delete “Overlay 1 copy”?' });
		await expect(dialog).toContainText('The item on it will be removed too');
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		expect(await names(page)).toContain('Overlay 1 copy');
		await page.getByRole('button', { name: 'Overlay 1 copy options' }).click();
		await page.getByRole('menuitem', { name: 'Delete track' }).click();
		await dialog.getByRole('button', { name: 'Delete track' }).click();
		expect(await names(page)).toEqual(['Overlay 1', 'Scenes', 'Audio 1']);
		expect(await api(page, (s) => s.project.overlays.length)).toBe(1);

		// Empty: gone right away.
		await page.getByRole('button', { name: 'Audio 1 options' }).click();
		await page.getByRole('menuitem', { name: 'Delete track' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(await names(page)).toEqual(['Overlay 1', 'Scenes']);

		await page.keyboard.press(`${mod}+z`);
		await page.keyboard.press(`${mod}+z`);
		await expect.poll(() => names(page)).toEqual(['Overlay 1 copy', 'Overlay 1', 'Scenes', 'Audio 1']);
		expect(await api(page, (s) => s.project.overlays.length)).toBe(2);
	});

	test('drag a header to reorder; overlay tracks stay above Scenes and audio tracks below', async ({ page }) => {
		// Tall enough for every track without scrolling (scrolling while dragging is tested elsewhere).
		await page.setViewportSize({ width: 1280, height: 1100 });
		await setup(page);
		await page.getByRole('button', { name: 'Overlay track' }).click();
		await page.getByRole('button', { name: 'Overlay track' }).click();
		await page.getByRole('button', { name: 'Audio track' }).click();
		expect(await names(page)).toEqual(['Overlay 3', 'Overlay 2', 'Overlay 1', 'Scenes', 'Audio 1', 'Audio 2']);
		// A taller storyboard: drag the divider up.
		const divider = (await page.getByRole('separator', { name: 'Resize the storyboard' }).boundingBox())!;
		await page.mouse.move(divider.x + 200, divider.y + 4);
		await page.mouse.down();
		await page.mouse.move(divider.x + 200, divider.y - 300, { steps: 5 });
		await page.mouse.up();

		const drag = async (name: string, toName: string, where: 'above' | 'below') => {
			const from = (await header(page, name).locator('.grip').boundingBox())!;
			const to = (await header(page, toName).boundingBox())!;
			const y = where === 'above' ? to.y + 4 : to.y + to.height - 4;
			await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
			await page.mouse.down();
			await page.mouse.move(from.x + 5, y, { steps: 8 });
			await expect(page.locator('.gap-line')).toHaveCount(1);
			await page.mouse.up();
		};
		// Overlay 1 to the top: drawn above the others now.
		await drag('Overlay 1', 'Overlay 3', 'above');
		expect(await names(page)).toEqual(['Overlay 1', 'Overlay 3', 'Overlay 2', 'Scenes', 'Audio 1', 'Audio 2']);
		// Dragged far down, an overlay track stops just above Scenes.
		await drag('Overlay 3', 'Audio 2', 'below');
		expect(await names(page)).toEqual(['Overlay 1', 'Overlay 2', 'Overlay 3', 'Scenes', 'Audio 1', 'Audio 2']);
		// And an audio track stops just below it.
		await drag('Audio 2', 'Overlay 1', 'above');
		expect(await names(page)).toEqual(['Overlay 1', 'Overlay 2', 'Overlay 3', 'Scenes', 'Audio 2', 'Audio 1']);
		// The card stays on its track, which is now the lowest: drawn first.
		await page.keyboard.press(`${mod}+z`);
		await expect.poll(() => names(page)).toEqual(['Overlay 1', 'Overlay 2', 'Overlay 3', 'Scenes', 'Audio 1', 'Audio 2']);
	});
});
