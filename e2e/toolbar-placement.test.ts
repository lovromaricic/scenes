import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, setFormat } from './helpers';

/**
 * The floating toolbar of a selected object sits at a fixed spot: centred at the bottom of the
 * video frame, 16 px in. It stays put while the object moves; it's at the top instead when the
 * object covers the bottom spot (decided when a drag ends). Icons only in narrow frames. Clearly
 * visible on black, white and busy pictures.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

type Rect = { x: number; y: number; width: number; height: number };

/** The toolbar, the video frame in view, and which side it's on. */
async function where(page: Page) {
	await frames(page);
	const el = page.getByTestId('selection-toolbar');
	await expect(el).toBeVisible();
	await expect.poll(() => el.evaluate((e) => getComputedStyle(e).visibility)).toBe('visible');
	// Measured once its entrance animation is over.
	await expect.poll(() => el.evaluate((e) => e.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && !(a instanceof CSSAnimation && a.animationName.includes('blink'))).length)).toBe(0);
	const bar = (await el.locator('.bar').boundingBox())!;
	const keys = await el.getByRole('group', { name: 'Keyframes' }).boundingBox();
	const preview = (await page.getByTestId('preview').boundingBox())!;
	const stage = (await page.getByTestId('stage').boundingBox())!;
	const frame: Rect = {
		x: Math.max(preview.x, stage.x),
		y: Math.max(preview.y, stage.y),
		width: Math.min(preview.x + preview.width, stage.x + stage.width) - Math.max(preview.x, stage.x),
		height: Math.min(preview.y + preview.height, stage.y + stage.height) - Math.max(preview.y, stage.y)
	};
	return { bar, keys, frame, side: await el.getAttribute('data-side') };
}

/** The same place, to the pixel. */
function expectSamePlace(a: Rect, b: Rect) {
	for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[k] - b[k]), k).toBeLessThan(1);
}

function expectInside(inner: Rect, outer: Rect, what = 'toolbar') {
	expect(inner.x, `${what} left`).toBeGreaterThanOrEqual(outer.x - 0.5);
	expect(inner.y, `${what} top`).toBeGreaterThanOrEqual(outer.y - 0.5);
	expect(inner.x + inner.width, `${what} right`).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
	expect(inner.y + inner.height, `${what} bottom`).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
}

/** Centred at the bottom (or top) of the frame, 16 px in. */
function expectSpot(w: Awaited<ReturnType<typeof where>>, side: 'bottom' | 'top') {
	expect(w.side).toBe(side);
	expectInside(w.bar, w.frame);
	expect(Math.abs(w.bar.x + w.bar.width / 2 - (w.frame.x + w.frame.width / 2))).toBeLessThan(1.5);
	if (side === 'bottom') expect(w.frame.y + w.frame.height - (w.bar.y + w.bar.height)).toBeCloseTo(16, 0);
	else expect(w.bar.y - w.frame.y).toBeCloseTo(16, 0);
}

async function setup(page: Page, clip = 'solid-red.mp4') {
	await openNewVideo(page);
	await importViaPicker(page, [clip], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	return api<string>(page, `s => {
		s.addText('caption');
		s.stopEditingText();
		const id = s.selectedId;
		s.setTextWords(id, 'Hello there');
		s.setTextAnimation(id, 'none');
		s.setTextTiming(id, 0, 6);
		s.setTextPosition(id, 0.5, 0.4);
		s.seek(1);
		s.select(id);
		return id;
	}`);
}

const wordsBox = async (page: Page) => (await page.locator('.text-box').first().boundingBox())!;

/** The colour of the page at a point (from a screenshot). */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
	const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } });
	return page.evaluate(async (b64) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		const c = new OffscreenCanvas(1, 1);
		const ctx = c.getContext('2d')!;
		ctx.drawImage(img, 0, 0);
		return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
	}, png.toString('base64'));
}

test.describe('The floating toolbar at a fixed spot', () => {
	test.setTimeout(120_000);

	test('bottom centre of the frame; it stays put while the words are dragged around', async ({ page }) => {
		await setup(page);
		const w0 = await where(page);
		expectSpot(w0, 'bottom');
		// One bar: the keyframe buttons are inside it.
		expectInside(w0.keys!, w0.bar, 'keyframe buttons');

		// Drag the words around the upper half: the toolbar doesn't move (and stays visible).
		const b = await wordsBox(page);
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		for (const [dx, dy] of [
			[-120, -40],
			[150, -60],
			[60, 20]
		]) {
			await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 5 });
			const w = await where(page);
			expectSamePlace(w.bar, w0.bar);
		}
		await page.mouse.up();
		expectSamePlace((await where(page)).bar, w0.bar);

		// Turned and scaled: still put.
		const id = await api<string>(page, 's => s.selectedId');
		await api(page, `s => s.setItemValues('${id}', { rotation: 30, scaleX: 1.5, scaleY: 1.5 })`);
		expectSamePlace((await where(page)).bar, w0.bar);
	});

	test('a caption at the bottom puts it at the top; switched when a drag ends, not during it', async ({ page }, info) => {
		const id = await setup(page);
		await api(page, `s => s.setTextPosition('${id}', 0.5, 0.88)`);
		expectSpot(await where(page), 'top');
		await page.screenshot({ path: info.outputPath('top.png') });

		// Back up: bottom again.
		await api(page, `s => s.setTextPosition('${id}', 0.5, 0.3)`);
		const bottom = await where(page);
		expectSpot(bottom, 'bottom');

		// Dragged down onto the bottom spot: it stays at the bottom while dragging...
		const b = await wordsBox(page);
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		await page.mouse.move(b.x + b.width / 2, bottom.bar.y + bottom.bar.height / 2, { steps: 8 });
		const during = await where(page);
		expect(during.side).toBe('bottom');
		expectSamePlace(during.bar, bottom.bar);
		// ...and goes to the top when the drag ends.
		await page.mouse.up();
		expectSpot(await where(page), 'top');

		// Huge words covering the frame: at the top, inside.
		await api(page, `s => { s.setTextPosition('${id}', 0.5, 0.5); s.setTextSize('${id}', 2000 / 720); }`);
		expectSpot(await where(page), 'top');
	});

	test('layers too, and when zoomed in it stays inside the part of the frame in view', async ({ page }) => {
		await setup(page);
		const card = await api<string>(page, `s => {
			const c = s.addCardOverlay(0);
			s.setOverlayTiming(c, 0, 6);
			s.setOverlayBox(c, { x: 0.3, y: 0.2, w: 0.4, h: 0.3 });
			s.select(c);
			return c;
		}`);
		expectSpot(await where(page), 'bottom');
		await api(page, `s => s.setOverlayBox('${card}', { x: 0.3, y: 0.7, w: 0.4, h: 0.25 })`);
		expectSpot(await where(page), 'top');

		await page.getByTestId('zoom').click();
		await page.getByRole('menuitem', { name: '100%' }).click();
		await api(page, `s => s.select('${card}')`);
		const w = await where(page);
		expectInside(w.bar, w.frame);
	});

	test('a narrow 9:16 frame: icons only, still inside, bottom centre', async ({ page }, info) => {
		await setup(page);
		await setFormat(page, 'Vertical');
		await api(page, `s => s.select(s.project.texts[0].id)`);
		const w = await where(page);
		expectSpot(w, 'bottom');
		const bar = page.getByTestId('selection-toolbar').getByRole('toolbar');
		await expect(bar.locator('button span')).toHaveCount(0);
		await expect(bar.getByRole('button', { name: 'Style' })).toHaveAttribute('title', 'Style');
		await page.screenshot({ path: info.outputPath('vertical.png') });
		await setFormat(page, 'Landscape');
		await api(page, `s => s.select(s.project.texts[0].id)`);
		await expect(bar.locator('button span').first()).toBeVisible();
	});

	test('clearly visible on a black card, a white card and a busy video', async ({ page }, info) => {
		await setup(page);
		const el = page.getByTestId('selection-toolbar').locator('.bar');
		// A light 1 px edge and a soft shadow.
		const look = await el.evaluate((e) => {
			const cs = getComputedStyle(e);
			return { border: cs.borderTopWidth, color: cs.borderTopColor, shadow: cs.boxShadow };
		});
		expect(look.border).toBe('1px');
		expect(look.color).toMatch(/rgba\(255, 255, 255, 0\.15\)/);
		expect(look.shadow).not.toBe('none');

		for (const color of ['#000000', '#ffffff']) {
			await api(page, `s => {
				const c = s.project.overlays[0]?.id ?? s.addCardOverlay(0);
				s.setOverlayTiming(c, 0, 6);
				s.setOverlayCard(c, { background: '${color}', rect: null });
				s.setOverlayBox(c, { x: 0, y: 0, w: 1, h: 1 });
				s.select(s.project.texts[0].id);
			}`);
			const w = await where(page);
			// The bar's edge stands out from the card right next to it.
			const edge = await pixel(page, w.bar.x + w.bar.width / 2, w.bar.y);
			const inside = await pixel(page, w.bar.x + 6, w.bar.y + w.bar.height / 2);
			const outside = await pixel(page, w.bar.x + w.bar.width / 2, w.bar.y - 30);
			const lum = (p: number[]) => (p[0] + p[1] + p[2]) / 3;
			if (color === '#000000') expect(lum(edge) - lum(outside)).toBeGreaterThan(20);
			else expect(lum(outside) - lum(inside)).toBeGreaterThan(150);
			await page.screenshot({ path: info.outputPath(`on-${color.slice(1)}.png`) });
		}
	});

	test('on a busy video', async ({ page }, info) => {
		await setup(page, 'quads.mp4');
		const w = await where(page);
		expectSpot(w, 'bottom');
		await page.screenshot({ path: info.outputPath('busy.png') });
	});
});
