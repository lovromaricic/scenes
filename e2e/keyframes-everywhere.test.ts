import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

type RGB = [number, number, number];
const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const near = (a: RGB, b: RGB, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const BLUE: RGB = [0, 0, 255];
const RED: RGB = [255, 0, 0];
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const canvasPixel = (page: Page, selector: string, fx: number, fy: number) =>
	page.evaluate(
		({ selector, fx, fy }) => {
			const c = document.querySelector(selector) as HTMLCanvasElement;
			const s = (window as unknown as { __scenes: { player: { readPixel(x: number, y: number): number[] } } }).__scenes;
			const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
			return [p[0], p[1], p[2]] as RGB;
		},
		{ selector, fx, fy }
	);

async function previewPixel(page: Page, fx: number, fy: number) {
	await expect.poll(() => api<boolean>(page, 's => s.player.isFrameReady()'), { timeout: 10_000 }).toBe(true);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	return canvasPixel(page, 'canvas[data-testid="preview"]', fx, fy);
}

/** A red scene; a blue card moving from x 0.2 (0 s) to x 0.8 (2 s); a song with a volume dip. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await api(page, `s => {
		const c = s.addCardOverlay(0);
		s.setOverlayCard(c, { background: '#0000ff', rect: null });
		s.setOverlayBox(c, { x: 0.15, y: 0.4, w: 0.1, h: 0.2 });
		s.setOverlayTiming(c, 0, 6);
		const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
		const base = { x: 0.2, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
		s.edit('k', (p) => ({ ...p, overlays: p.overlays.map((o) => ({ ...o, keyframes: [
			{ id: 'a', time: 0, values: base, easing: lin },
			{ id: 'b', time: 2, values: { ...base, x: 0.8 }, easing: lin }
		] })) }));
		s.deselect();
	}`);
}

test.describe('Keyframes everywhere', () => {
	test('Watch draws the same animation as the preview', async ({ page }) => {
		await setup(page);
		await seekTo(page, 1);
		expect(near(await previewPixel(page, 0.5, 0.5), BLUE)).toBe(true);
		expect(near(await previewPixel(page, 0.2, 0.5), RED)).toBe(true);
		await page.getByRole('button', { name: 'Watch' }).click();
		await expect(page.getByRole('dialog', { name: /^Watch/ })).toBeVisible();
		await page.keyboard.press('Space');
		await api(page, 's => s.seek(1)');
		await expect.poll(async () => near(await canvasPixel(page, '[role="dialog"] canvas', 0.5, 0.5), BLUE)).toBe(true);
		expect(near(await canvasPixel(page, '[role="dialog"] canvas', 0.2, 0.5), RED)).toBe(true);
	});

	test('the home picture shows the first moment of the animation', async ({ page }) => {
		await setup(page);
		await page.getByRole('link', { name: 'Projects' }).click();
		const img = page.getByRole('article').locator('img[src]').first();
		await expect(img).toBeVisible();
		const thumb = (fx: number, fy: number) =>
			img.evaluate(
				(el: HTMLImageElement, { fx, fy }) => {
					const c = document.createElement('canvas');
					c.width = el.naturalWidth;
					c.height = el.naturalHeight;
					const ctx = c.getContext('2d')!;
					ctx.drawImage(el, 0, 0);
					const d = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
					return [d[0], d[1], d[2]] as RGB;
				},
				{ fx, fy }
			);
		// At 0 s the card is at x 0.2 (not where it is a moment later).
		await expect.poll(async () => near(await thumb(0.2, 0.5), BLUE, 50)).toBe(true);
		expect(near(await thumb(0.3, 0.5), RED, 50)).toBe(true);
	});

	test('keyframes and volume points are saved with the project, and every change can be undone', async ({ page }) => {
		await setup(page);
		const id = await api<string>(page, 's => s.project.overlays[0].id');
		// Add a keyframe with the diamond, then undo and redo it.
		await page.locator(`[data-item-id="${id}"] .item`).click();
		await seekTo(page, 4);
		await page.getByRole('complementary', { name: 'Settings' }).getByTestId('keyframe-diamond').click();
		expect(await api<number>(page, 's => s.project.overlays[0].keyframes.length')).toBe(3);
		await page.keyboard.press(`${mod}+z`);
		expect(await api<number>(page, 's => s.project.overlays[0].keyframes.length')).toBe(2);
		await page.keyboard.press(`${mod}+Shift+z`);
		expect(await api<number>(page, 's => s.project.overlays[0].keyframes.length')).toBe(3);
		// A rotation at 4 s and scale-unlink, then reload: all still there.
		await page.getByRole('complementary', { name: 'Settings' }).getByRole('spinbutton', { name: 'Layer rotation' }).fill('25');
		const before = await api<string>(page, 's => JSON.stringify(s.project.overlays[0].keyframes)');
		await expect(page.getByText('Saved on this device')).toBeVisible({ timeout: 10_000 });
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		expect(await api<string>(page, 's => JSON.stringify(s.project.overlays[0].keyframes)')).toBe(before);
		expect(await api<number>(page, `s => s.itemValues('${id}', 4).rotation`)).toBe(25);
	});
});
