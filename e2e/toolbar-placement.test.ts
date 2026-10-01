import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, setFormat } from './helpers';

/**
 * The floating toolbar of a selected object always stays fully inside the video frame (the part
 * in view): above the object when there's room, below when not, pinned at the top otherwise, at
 * the nearest edge for an object outside the frame; icons only when the frame is narrow.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

type Rect = { x: number; y: number; width: number; height: number };

/** The toolbar (with the keyframe buttons), the video frame in view, and where it was placed. */
async function where(page: Page) {
	await frames(page);
	const bar = page.getByTestId('selection-toolbar');
	await expect(bar).toBeVisible();
	await expect.poll(async () => (await bar.evaluate((el) => getComputedStyle(el).visibility)) === 'visible').toBe(true);
	const toolbar = (await bar.boundingBox())!;
	const row = (await bar.locator('[role="toolbar"]').boundingBox())!;
	const keys = await bar.getByRole('group', { name: 'Keyframes' }).boundingBox();
	const preview = (await page.getByTestId('preview').boundingBox())!;
	const stage = (await page.getByTestId('stage').boundingBox())!;
	const frame: Rect = {
		x: Math.max(preview.x, stage.x),
		y: Math.max(preview.y, stage.y),
		width: Math.min(preview.x + preview.width, stage.x + stage.width) - Math.max(preview.x, stage.x),
		height: Math.min(preview.y + preview.height, stage.y + stage.height) - Math.max(preview.y, stage.y)
	};
	return { toolbar, row, keys, frame, placement: await bar.getAttribute('data-placement') };
}

/** Fully inside (to the pixel). */
function expectInside(inner: Rect, outer: Rect, what = 'toolbar') {
	expect(inner.x, `${what} left`).toBeGreaterThanOrEqual(outer.x - 0.5);
	expect(inner.y, `${what} top`).toBeGreaterThanOrEqual(outer.y - 0.5);
	expect(inner.x + inner.width, `${what} right`).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
	expect(inner.y + inner.height, `${what} bottom`).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
}

async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	return api<string>(page, `s => {
		s.addText('caption');
		s.stopEditingText();
		const id = s.selectedId;
		s.setTextWords(id, 'Hello there');
		s.setTextAnimation(id, 'none');
		s.setTextTiming(id, 0, 6);
		s.setTextPosition(id, 0.5, 0.6);
		s.seek(1);
		s.select(id);
		return id;
	}`);
}

const words = (page: Page) => page.locator('.text-box').first().boundingBox().then((b) => b!);

test.describe('The floating toolbar stays inside the video frame', () => {
	test.setTimeout(120_000);

	test('above small words, below near the top, pinned at the top for 2000 px words', async ({ page }) => {
		const id = await setup(page);
		let w = await where(page);
		expect(w.placement).toBe('above');
		expectInside(w.toolbar, w.frame);
		// One unit: the keyframe buttons are on the same row, inside it too.
		expect(w.keys).not.toBeNull();
		expectInside(w.keys!, w.toolbar, 'keyframe buttons');
		expect(w.toolbar.y + w.toolbar.height).toBeLessThan((await words(page)).y);
		// Centred on the words.
		const b = await words(page);
		expect(Math.abs(w.toolbar.x + w.toolbar.width / 2 - (b.x + b.width / 2))).toBeLessThan(2);

		// Near the top: below the words.
		await api(page, `s => s.setTextPosition('${id}', 0.5, 0.08)`);
		w = await where(page);
		expect(w.placement).toBe('below');
		expectInside(w.toolbar, w.frame);
		expect(w.toolbar.y).toBeGreaterThan((await words(page)).y + (await words(page)).height);

		// Huge: pinned at the top of the frame, a small margin in.
		for (const px of [600, 2000]) {
			await api(page, `s => { s.setTextPosition('${id}', 0.5, 0.5); s.setTextSize('${id}', ${px} / 720); }`);
			w = await where(page);
			expect(w.placement).toBe('pinned');
			expectInside(w.toolbar, w.frame);
			expect(w.toolbar.y - w.frame.y).toBeCloseTo(8, 0);
		}
	});

	test('partly or fully outside the frame, turned, near any edge: always inside', async ({ page }, info) => {
		const id = await setup(page);
		const spots: [number, number, number][] = [
			[-0.05, 0.5, 0],
			[1.05, 0.5, 0],
			[0.5, -0.02, 0],
			[0.5, 1.02, 0],
			[0.02, 0.03, 30],
			[0.98, 0.97, -40],
			[0.95, 0.5, 90]
		];
		for (const [x, y, r] of spots) {
			await api(page, `s => { s.setTextPosition('${id}', ${x}, ${y}); s.setItemValues('${id}', { rotation: ${r} }); }`);
			const w = await where(page);
			expectInside(w.toolbar, w.frame);
		}
		// Entirely outside on the left: at the frame's left edge, level with the words.
		await api(page, `s => { s.setItemValues('${id}', { rotation: 0 }); s.setTextPosition('${id}', -0.6, 0.5); }`);
		const w = await where(page);
		expect(w.placement).toBe('edge');
		expect(w.toolbar.x - w.frame.x).toBeCloseTo(8, 0);
		expectInside(w.toolbar, w.frame);
		await page.screenshot({ path: info.outputPath('edge.png') });
		// Entirely below the frame: at its bottom edge.
		await api(page, `s => s.setTextPosition('${id}', 0.5, 1.6)`);
		const below = await where(page);
		expect(below.placement).toBe('edge');
		expect(below.frame.y + below.frame.height - (below.toolbar.y + below.toolbar.height)).toBeCloseTo(8, 0);
	});

	test('layers too: a card covering the frame pins it; a card at the bottom has it above', async ({ page }) => {
		await setup(page);
		const card = await api<string>(page, `s => {
			const c = s.addCardOverlay(0);
			s.setOverlayTiming(c, 0, 6);
			s.setOverlayBox(c, { x: -0.1, y: -0.1, w: 1.2, h: 1.2 });
			s.select(c);
			return c;
		}`);
		let w = await where(page);
		expect(w.placement).toBe('pinned');
		expectInside(w.toolbar, w.frame);
		await api(page, `s => s.setOverlayBox('${card}', { x: 0.3, y: 0.75, w: 0.4, h: 0.2 })`);
		w = await where(page);
		expect(w.placement).toBe('above');
		expectInside(w.toolbar, w.frame);
		// Scaled up and turned by keyframe values: still inside.
		await api(page, `s => s.setItemValues('${card}', { scaleX: 3, scaleY: 3, rotation: 25 })`);
		w = await where(page);
		expectInside(w.toolbar, w.frame);
	});

	test('a narrow 9:16 frame: icons only, still inside', async ({ page }, info) => {
		await setup(page);
		await setFormat(page, 'Vertical');
		await api(page, `s => s.select(s.project.texts[0].id)`);
		const w = await where(page);
		expectInside(w.toolbar, w.frame);
		const bar = page.getByTestId('selection-toolbar').getByRole('toolbar');
		// Icon-only buttons, still named (and with tooltips).
		await expect(bar.locator('button span')).toHaveCount(0);
		await expect(bar.getByRole('button', { name: 'Style' })).toHaveAttribute('title', 'Style');
		await page.screenshot({ path: info.outputPath('vertical.png') });
		// Back to a wide frame: names again.
		await setFormat(page, 'Landscape');
		await api(page, `s => s.select(s.project.texts[0].id)`);
		await expect(bar.locator('button span').first()).toBeVisible();
	});

	test('follows panning, zooming, the window size and moves; hidden while dragging', async ({ page }) => {
		const id = await setup(page);
		// Zoomed in past the stage: inside the part of the frame in view.
		await page.getByTestId('zoom').click();
		await page.getByRole('menuitem', { name: '100%' }).click();
		await api(page, `s => s.select('${id}')`);
		let w = await where(page);
		expectInside(w.toolbar, w.frame);
		// Panned so the words are near the stage's top edge.
		const st = (await page.getByTestId('stage').boundingBox())!;
		await page.mouse.move(st.x + st.width / 2, st.y + st.height / 2);
		await page.mouse.wheel(0, 260);
		w = await where(page);
		expectInside(w.toolbar, w.frame);
		await page.getByTestId('zoom').click();
		await page.getByRole('menuitem', { name: /Fit/ }).click();

		// A smaller window.
		await page.setViewportSize({ width: 1100, height: 760 });
		w = await where(page);
		expectInside(w.toolbar, w.frame);

		// While dragging the words it's out of the way; after, it's back, inside.
		const b = await words(page);
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		await page.mouse.move(b.x + b.width / 2 + 40, b.y - 120, { steps: 6 });
		await expect(page.getByTestId('selection-toolbar')).toHaveCount(0);
		await page.mouse.up();
		w = await where(page);
		expectInside(w.toolbar, w.frame);
	});
});
