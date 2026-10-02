import { expect, test, type Locator, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

type RGB = [number, number, number];
type Item = { id: string; trackId: string; start: number; duration: number };
type Api = {
	project: {
		tracks: { id: string; kind: string; name: string }[];
		overlays: (Item & { name: string; box: object })[];
		texts: Item[];
		scenes: { id: string; name: string }[];
	};
	media: Record<string, { id: string; name: string }>;
	duration: number;
	ripple: boolean;
	selectedId: string | null;
	player: { readPixel(x: number, y: number): number[]; isFrameReady(): boolean };
	setOverlayTiming(id: string, start: number, duration: number): void;
	setOverlayBox(id: string, box: object): void;
	setSceneLength(id: string, length: number): void;
	addCardOverlay(start?: number, trackId?: string): string;
	setTrackFlag(id: string, flag: string, on: boolean): void;
};
const api = <T>(page: Page, fn: (s: Api) => T): Promise<T> =>
	page.evaluate(`(${fn.toString()})(window.__scenes)`) as Promise<T>;
const round = (v: number) => Math.round(v * 100) / 100;
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

test.describe('Ripple, snapping and the end of the video', () => {
	test('a Logo track with a PNG stretched to the end keeps its length as scenes are added; Extend to end of video stretches it once', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['green.mp4', 'quads.png'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		// The PNG only in "Your media".
		await page.getByRole('button', { name: /^Scene 2, / }).click();
		await page.keyboard.press('Delete');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toHaveCount(0);

		// A new track named "Logo".
		await page.getByRole('button', { name: 'Overlay track' }).click();
		await page.locator('[data-track-header]').first().locator('.name').dblclick();
		await page.getByRole('textbox', { name: 'Track name' }).fill('Logo');
		await page.getByRole('textbox', { name: 'Track name' }).press('Enter');
		const logoLane = page.getByRole('group', { name: 'Logo', exact: true });
		await expect(logoLane).toBeVisible();

		// Drag the PNG from "Your media" onto the Logo track, near the start.
		const laneBox = (await logoLane.boundingBox())!;
		await page.getByRole('button', { name: /^quads\.png, photo/ }).dragTo(logoLane, { targetPosition: { x: 4, y: laneBox.height / 2 } });
		await expect.poll(() => api(page, (s) => s.project.overlays.length)).toBe(1);
		const logo = await api(page, (s) => s.project.overlays[0].id);
		expect(await api(page, (s) => s.project.tracks.find((t) => t.id === s.project.overlays[0].trackId)!.name)).toBe('Logo');

		// Small, top-left; from 0 s.
		await page.evaluate((id) => {
			const s = (window as unknown as { __scenes: Api }).__scenes;
			s.setOverlayBox(id, { x: 0.02, y: 0.03, w: 0.2, h: 0.2 });
			s.setOverlayTiming(id, 0, 1);
		}, logo);

		// Stretch its end to the end of the video with the handle: it snaps there, with a snap line
		// across all tracks.
		const item = page.locator(`[data-item-id="${logo}"]`);
		await item.locator('.item').click();
		const handle = item.locator('[data-trim="end"]');
		const h = await settled(handle);
		const end = (await settled(page.locator('.card-slot').last()))!;
		await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
		await page.mouse.down();
		await page.mouse.move(end.x + end.width - 4, h.y + h.height / 2, { steps: 12 });
		const line = page.locator('.snap-line');
		await expect(line).toBeVisible();
		const lineBox = (await line.boundingBox())!;
		const audio = (await page.getByRole('group', { name: 'Audio 1', exact: true }).boundingBox())!;
		expect(lineBox.y).toBeLessThanOrEqual(laneBox.y);
		expect(lineBox.y + lineBox.height).toBeGreaterThanOrEqual(audio.y + audio.height);
		await page.mouse.up();
		const length = await api(page, (s) => s.duration);
		expect(round(await api(page, (s) => s.project.overlays[0].start + s.project.overlays[0].duration))).toBe(round(length));
		// Nothing marks it as following the end any more.
		await expect(item.locator('.end-marker')).toHaveCount(0);

		// Add more scenes (ripple is off): the logo keeps the length it was given.
		await page.getByRole('button', { name: /^Clips/ }).click();
		await importViaPicker(page, ['red.mp4', 'blue.webm'], 'Choose files');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		const longer = await api(page, (s) => s.duration);
		expect(longer).toBeGreaterThan(length + 5);
		let o = await api(page, (s) => s.project.overlays[0]);
		expect(o.start).toBe(0);
		expect(round(o.start + o.duration)).toBe(round(length));

		// "Extend to end of video" (right-click) stretches it once, to the new end.
		await page.keyboard.press('Escape');
		await item.locator('.item').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Extend to end of video' }).click();
		o = await api(page, (s) => s.project.overlays[0]);
		expect(round(o.start + o.duration)).toBe(round(longer));

		// On the picture near the very end: the logo is there (hiding its track changes that spot).
		await seekTo(page, longer - 0.2);
		const shown = await previewPixel(page, 0.05, 0.06);
		await api(page, (s) => s.setTrackFlag(s.project.tracks[0].id, 'hidden', true));
		const hidden = await previewPixel(page, 0.05, 0.06);
		expect(shown.some((v, i) => Math.abs(v - hidden[i]) > 60)).toBe(true);
		await api(page, (s) => s.setTrackFlag(s.project.tracks[0].id, 'hidden', false));

		// When the video gets shorter, it doesn't shrink with it either.
		await page.getByRole('button', { name: /^Scene 3, / }).click();
		await page.keyboard.press('Delete');
		const o2 = await api(page, (s) => s.project.overlays[0]);
		expect(round(o2.start + o2.duration)).toBe(round(longer));
	});

	test('ripple off keeps items at their times; on, they move with the scenes', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		// red 0–4, green 4–7, blue 7–10. A card over green at 5 s and one over blue at 8 s.
		const [c1, c2] = await api(page, (s) => {
			const a = s.addCardOverlay(5);
			s.setOverlayTiming(a, 5, 1);
			const b = s.addCardOverlay(8);
			s.setOverlayTiming(b, 8, 1);
			return [a, b];
		});
		const starts = () =>
			page.evaluate(
				(ids) => ids.map((id) => Math.round((window as unknown as { __scenes: Api }).__scenes.project.overlays.find((o) => o.id === id)!.start * 100) / 100),
				[c1, c2]
			);
		const toggle = page.getByRole('button', { name: 'Ripple' });
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');

		// Off: deleting the first scene leaves them where they were.
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page.keyboard.press('Delete');
		expect(await starts()).toEqual([5, 8]);
		await page.keyboard.press(`${mod}+z`);
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();

		// On: they move with their scenes.
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page.keyboard.press('Delete');
		expect(await starts()).toEqual([1, 4]);
		// Shortening a scene moves what comes after it by the same amount (and nothing before).
		await api(page, (s) => s.setSceneLength(s.project.scenes[0].id, 2));
		expect(await starts()).toEqual([1, 3]);
		// One undo step each.
		await page.keyboard.press(`${mod}+z`);
		expect(await starts()).toEqual([1, 4]);
		await page.keyboard.press(`${mod}+z`);
		expect(await starts()).toEqual([5, 8]);

		// Remembered on this device.
		await page.reload();
		await expect(page.getByRole('button', { name: 'Ripple' })).toHaveAttribute('aria-pressed', 'true');
	});
});
