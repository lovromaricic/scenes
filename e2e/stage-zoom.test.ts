import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * Zooming the stage: Cmd/Ctrl + scroll (and pinch) zoom around the stage's centre, 10% a step;
 * at Fit and below the frame is always centred (no panning); beyond Fit, scroll, Shift + scroll
 * and Space + drag pan, clamped; zooming back re-centres it smoothly; double-click the
 * percentage for Fit. Plain scroll zooms a picture only in Custom framing (selected). The
 * pasteboard is light gray, and a white frame stands out against it.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function stage(page: Page) {
	return page.evaluate(() => {
		const rect = (sel: string) => {
			const r = document.querySelector(sel)!.getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		};
		return {
			frame: rect('.preview'),
			stage: rect('.viewport'),
			zoom: document.querySelector('[data-testid="zoom"]')?.textContent?.trim() ?? ''
		};
	});
}
type View = Awaited<ReturnType<typeof stage>>;
const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
function expectCentred(v: View) {
	expect(centre(v.frame).x).toBeCloseTo(centre(v.stage).x, 0);
	expect(centre(v.frame).y).toBeCloseTo(centre(v.stage).y, 0);
}

/** Cmd/Ctrl + scroll by `dy` (negative: in) with the pointer at (x, y). */
async function zoomWheel(page: Page, x: number, y: number, dy: number) {
	await page.mouse.move(x, y);
	await page.keyboard.down(mod);
	await page.mouse.wheel(0, dy);
	await page.keyboard.up(mod);
}

async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await page.keyboard.press('Escape');
	await api(page, 's => s.deselect()');
}

test.describe('Zooming the stage', () => {
	test.setTimeout(120_000);

	test('Cmd/Ctrl + scroll zooms around the stage’s centre, 10% a step, wherever the pointer is', async ({ page }) => {
		await setup(page);
		const fit = await stage(page);
		expect(fit.zoom).toBe('Fit');
		expectCentred(fit);
		// The pointer near a corner: the frame still grows around the centre.
		await zoomWheel(page, fit.stage.x + 30, fit.stage.y + 30, -100);
		const one = await stage(page);
		expect(one.frame.w / fit.frame.w).toBeCloseTo(1.1, 2);
		expectCentred(one);
		await zoomWheel(page, fit.stage.x + fit.stage.w - 20, fit.stage.y + fit.stage.h - 20, -200);
		const three = await stage(page);
		expect(three.frame.w / fit.frame.w).toBeCloseTo(1.1 ** 3, 2);
		expect(three.zoom).toMatch(/^\d+%$/);
		// Out, below Fit: centred all the way.
		await zoomWheel(page, fit.stage.x + 10, fit.stage.y + 10, 600);
		const small = await stage(page);
		expect(small.frame.w).toBeLessThan(fit.frame.w * 0.8);
		expectCentred(small);
	});

	test('at Fit and below the frame stays centred: scroll and Space + drag don’t move it, Space plays', async ({ page }) => {
		await setup(page);
		const fit = await stage(page);
		await page.mouse.move(centre(fit.stage).x, centre(fit.stage).y);
		await page.mouse.wheel(80, 40);
		await page.keyboard.down('Shift');
		await page.mouse.wheel(0, 60);
		await page.keyboard.up('Shift');
		expect((await stage(page)).frame).toEqual(fit.frame);
		// Space + drag: nothing to pan; Space plays (and pauses) as always.
		await page.keyboard.down(' ');
		await expect.poll(() => api<boolean>(page, 's => s.playing')).toBe(true);
		await page.mouse.down();
		await page.mouse.move(centre(fit.stage).x + 60, centre(fit.stage).y + 30, { steps: 4 });
		await page.mouse.up();
		await page.keyboard.up(' ');
		expect((await stage(page)).frame).toEqual(fit.frame);
		await page.keyboard.press(' ');
		await expect.poll(() => api<boolean>(page, 's => s.playing')).toBe(false);
		// Zoomed out below Fit: still no panning.
		await zoomWheel(page, centre(fit.stage).x, centre(fit.stage).y, 300);
		const small = await stage(page);
		await page.mouse.wheel(100, 100);
		expect((await stage(page)).frame).toEqual(small.frame);
	});

	test('beyond Fit: scroll, Shift + scroll and Space + drag pan, clamped; zooming back re-centres it', async ({ page }, info) => {
		await setup(page);
		const fit = await stage(page);
		const c = centre(fit.stage);
		await zoomWheel(page, c.x, c.y, -500);
		const zoomed = await stage(page);
		expectCentred(zoomed);
		// Scroll pans.
		await page.mouse.move(c.x, c.y);
		await page.mouse.wheel(80, 40);
		await expect.poll(async () => (await stage(page)).frame.x).toBeCloseTo(zoomed.frame.x - 80, 0);
		expect((await stage(page)).frame.y).toBeCloseTo(zoomed.frame.y - 40, 0);
		// Shift + scroll: sideways.
		const before = await stage(page);
		await page.keyboard.down('Shift');
		await page.mouse.wheel(0, 50);
		await page.keyboard.up('Shift');
		expect((await stage(page)).frame.x).toBeCloseTo(before.frame.x - 50, 0);
		// Space + drag pans (and doesn't play).
		const b2 = await stage(page);
		await page.keyboard.down(' ');
		await page.mouse.down();
		await page.mouse.move(c.x + 60, c.y + 25, { steps: 5 });
		await page.mouse.up();
		await page.keyboard.up(' ');
		const panned = await stage(page);
		expect(panned.frame.x - b2.frame.x).toBeCloseTo(60, 0);
		expect(panned.frame.y - b2.frame.y).toBeCloseTo(25, 0);
		expect(await api<boolean>(page, 's => s.playing')).toBe(false);
		// Never completely out of view, however far.
		await page.mouse.wheel(-20000, -20000);
		const far = await stage(page);
		const overlapW = Math.min(far.frame.x + far.frame.w, far.stage.x + far.stage.w) - Math.max(far.frame.x, far.stage.x);
		const overlapH = Math.min(far.frame.y + far.frame.h, far.stage.y + far.stage.h) - Math.max(far.frame.y, far.stage.y);
		expect(overlapW).toBeGreaterThan(far.stage.w * 0.2);
		expect(overlapH).toBeGreaterThan(far.stage.h * 0.2);
		await page.screenshot({ path: info.outputPath('panned.png') });

		// Zoom back out to Fit and below: centred again (with a short animation).
		await zoomWheel(page, c.x, c.y, 900);
		await expect(page.locator('.preview.recentering')).toHaveCount(1);
		await expect.poll(async () => Math.abs(centre((await stage(page)).frame).x - c.x)).toBeLessThan(1);
		expectCentred(await stage(page));
		await expect(page.locator('.preview.recentering')).toHaveCount(0);
	});

	test('the zoom menu: Fit, 50%, 100%; double-click the percentage for Fit; cut off at the stage at 100%', async ({ page }) => {
		await setup(page);
		const fit = await stage(page);
		const W = await api<number>(page, 's => s.project.format.width');
		await page.getByTestId('zoom').click();
		await page.getByRole('menuitem', { name: '50%' }).click();
		await expect.poll(async () => (await stage(page)).frame.w).toBeCloseTo(W / 2, 0);
		expect((await stage(page)).zoom).toBe('50%');
		await page.getByTestId('zoom').click();
		await page.getByRole('menuitem', { name: '100%' }).click();
		await expect.poll(async () => (await stage(page)).frame.w).toBeCloseTo(W, 0);
		const big = await stage(page);
		expectCentred(big);
		const covering = await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.closest('.clip') !== null,
			{ x: big.stage.x + big.stage.w + 4, y: big.stage.y + big.stage.h / 2 }
		);
		expect(covering).toBe(false);
		// Double-click the percentage: Fit.
		await page.getByTestId('zoom').dblclick();
		await expect.poll(async () => (await stage(page)).zoom).toBe('Fit');
		await expect(page.getByRole('menu', { name: 'Zoom' })).toHaveCount(0);
		// (After its short move back to the centre.)
		await expect.poll(async () => Math.abs((await stage(page)).frame.w - fit.frame.w)).toBeLessThan(0.5);
		const back = await stage(page);
		for (const k of ['x', 'y', 'w', 'h'] as const) expect(back.frame[k]).toBeCloseTo(fit.frame[k], 0);
	});

	test('plain scroll zooms the picture only in Custom framing, with its scene selected; Cmd/Ctrl + scroll zooms the stage there too', async ({ page }) => {
		await setup(page);
		const id = await api<string>(page, `s => {
			const sc = s.project.scenes[0];
			s.setSceneFrame(sc.id, { ...(sc.frame ?? { mode: 'fill', x: 0.5, y: 0.5, zoom: 1, bars: 'black' }), mode: 'custom' });
			s.select(sc.id);
			return sc.id;
		}`);
		// ("video" for a video scene, "picture" for a photo: the words match the media.)
		await expect(page.getByText('Drag the video to move it. Scroll over it to zoom.')).toBeVisible();
		const frameZoom = () => api<number>(page, `s => s.frameValues('${id}').zoom`);
		const z0 = await frameZoom();
		const fit = await stage(page);
		const c = centre(fit.frame);
		// Plain scroll over the picture: the picture zooms in its frame; the stage doesn't.
		await page.mouse.move(c.x, c.y);
		await page.mouse.wheel(0, -200);
		await expect.poll(frameZoom).toBeGreaterThan(z0 + 0.05);
		expect((await stage(page)).zoom).toBe('Fit');
		// Cmd/Ctrl + scroll there: the stage zooms; the picture doesn't.
		const z1 = await frameZoom();
		await zoomWheel(page, c.x, c.y, -100);
		expect((await stage(page)).zoom).toMatch(/^\d+%$/);
		expect(await frameZoom()).toBeCloseTo(z1, 6);
		await page.getByTestId('zoom').dblclick();

		// Not selected: plain scroll does nothing to it (or to the stage at Fit).
		await api(page, 's => s.deselect()');
		await page.mouse.move(c.x, c.y);
		await page.mouse.wheel(0, -200);
		expect(await frameZoom()).toBeCloseTo(z1, 6);
		expect((await stage(page)).zoom).toBe('Fit');
	});

	test('the pasteboard is light gray; a white card stands out with the frame’s border and shadow', async ({ page }, info) => {
		await setup(page);
		await api(page, `s => {
			const c = s.addCardOverlay(0);
			s.setOverlayTiming(c, 0, 4);
			s.setOverlayCard(c, { background: '#ffffff', rect: null });
			s.setOverlayBox(c, { x: 0, y: 0, w: 1, h: 1 });
			s.deselect();
		}`);
		const look = await page.evaluate(() => ({
			bg: getComputedStyle(document.querySelector('.viewport')!).backgroundColor,
			token: getComputedStyle(document.documentElement).getPropertyValue('--pasteboard').trim(),
			edge: getComputedStyle(document.querySelector('.frame-edge')!).boxShadow,
			shadow: getComputedStyle(document.querySelector('.preview .clip')!).boxShadow
		}));
		expect(look.token).toBe('#f4f4f5');
		expect(look.bg).toBe('rgb(244, 244, 245)');
		expect(look.edge).toContain('rgb(228, 228, 231) 0px 0px 0px 1px'); // the border colour, 1 px
		expect(look.shadow).not.toBe('none');
		await expect.poll(() => api<boolean>(page, 's => s.player.isFrameReady()')).toBe(true);
		const v = await stage(page);
		await page.screenshot({ path: info.outputPath('white-card.png') });
		// Inside: white; the border: darker than the pasteboard; the pasteboard: its gray.
		const pixel = async (x: number, y: number) => {
			const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } });
			return page.evaluate(async (b64) => {
				const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
				const c = new OffscreenCanvas(1, 1).getContext('2d')!;
				c.drawImage(img, 0, 0);
				return Array.from(c.getImageData(0, 0, 1, 1).data.slice(0, 3));
			}, png.toString('base64'));
		};
		const midY = v.frame.y + v.frame.h / 2;
		const inside = await pixel(v.frame.x + 10, midY);
		const border = await pixel(v.frame.x - 1, midY);
		const outside = await pixel(v.frame.x - 40, midY);
		expect(inside[0]).toBeGreaterThan(250);
		expect(border[0]).toBeLessThan(outside[0]);
		expect(Math.abs(outside[0] - 244)).toBeLessThan(6);
	});
});
