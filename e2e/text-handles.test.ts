import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * Selected words have handles like layers: four corners (scale), left and right (width: Fixed
 * width, re-wrapping live), and the turn handle; no top or bottom. "Auto width" goes back to one
 * line.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

const WORDS = 'Sunny day at the old harbour';

async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	return api<string>(page, `s => {
		s.addText('caption');
		s.stopEditingText();
		const id = s.selectedId;
		s.setTextWords(id, ${JSON.stringify(WORDS)});
		s.setTextStyle(id, 'clean');
		s.setTextAnimation(id, 'none');
		s.setTextTiming(id, 0, 6);
		s.setTextPosition(id, 0.5, 0.4);
		s.setTextWidth(id, 'auto');
		s.seek(1);
		s.select(id);
		return id;
	}`);
}

const textBox = async (page: Page) => {
	await frames(page);
	return (await page.locator('.text-box').first().boundingBox())!;
};
const handle = (page: Page, h: string) => page.locator(`.text-box [data-text-handle="${h}"]`).first();
const item = (page: Page) =>
	api<{ width?: number | 'auto'; scaleX?: number; scaleY?: number; x: number }>(page, 's => JSON.parse(JSON.stringify(s.project.texts[0]))');

/** Drag a handle by (dx, dy), in steps. */
async function drag(page: Page, h: string, dx: number, dy: number, alt = false) {
	const b = (await handle(page, h).boundingBox())!;
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
	await page.mouse.down();
	if (alt) await page.keyboard.down('Alt');
	for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 + (dx * i) / 8, b.y + b.height / 2 + (dy * i) / 8);
	return async () => {
		await page.mouse.up();
		if (alt) await page.keyboard.up('Alt');
	};
}

test.describe('Handles on words', () => {
	test.setTimeout(120_000);

	test('corners, left and right, and the turn handle; constant size; no top or bottom', async ({ page }) => {
		const id = await setup(page);
		for (const h of ['nw', 'ne', 'se', 'sw', 'w', 'e', 'rotate']) await expect(handle(page, h)).toBeVisible();
		for (const h of ['n', 's']) await expect(handle(page, h)).toHaveCount(0);
		const size = (await handle(page, 'se').boundingBox())!;
		// Words scaled up: the handles stay the same size on screen, at the scaled corners.
		await api(page, `s => s.setItemValues('${id}', { scaleX: 2, scaleY: 2 })`);
		const big = (await handle(page, 'se').boundingBox())!;
		expect(big.width).toBeCloseTo(size.width, 0);
		const b = await textBox(page);
		expect(Math.abs(big.x + big.width / 2 - (b.x + b.width))).toBeLessThan(2);
		expect(Math.abs(big.y + big.height / 2 - (b.y + b.height))).toBeLessThan(2);
	});

	test('a side handle sets the width: the words re-wrap live, from one line to several and back', async ({ page }, info) => {
		await setup(page);
		const one = await textBox(page);
		// Narrower from the right: the left side stays, the words wrap onto more lines as it goes.
		const done = await drag(page, 'e', -one.width * 0.6, 0);
		const during = await textBox(page);
		expect(during.height).toBeGreaterThan(one.height * 1.8);
		expect(Math.abs(during.x - one.x)).toBeLessThan(1.5);
		await expect(page.getByTestId('text-size-label')).toHaveText(/^\d+ px$/);
		await page.screenshot({ path: info.outputPath('narrow.png') });
		await done();
		const narrow = await item(page);
		expect(typeof narrow.width).toBe('number');
		await expect(page.getByTestId('text-size-label')).toHaveCount(0);
		await expect(page.getByTestId('text-width')).toContainText(/Fixed: \d+ px/);

		// Wider again: one line.
		const back = await drag(page, 'e', one.width * 0.9, 0);
		await expect.poll(async () => (await textBox(page)).height).toBeLessThan(one.height * 1.2);
		await back();

		// One undo step per drag.
		await page.keyboard.press(undoKey);
		expect((await item(page)).width).toBeCloseTo(narrow.width as number, 6);
		await page.keyboard.press(undoKey);
		expect((await item(page)).width).toBe('auto');
	});

	test('never narrower than the widest word; Alt keeps the centre; Auto width brings back one line', async ({ page }) => {
		await setup(page);
		const one = await textBox(page);
		// Squeezed far: one word per line, and no narrower than "harbour".
		const done = await drag(page, 'e', -one.width * 2, 0);
		const thin = await textBox(page);
		await done();
		expect(thin.height).toBeGreaterThan(one.height * 3.5); // "harbour" sets the width: short words share lines
		expect(thin.width).toBeGreaterThan(one.width / 6);

		// With Alt, from the centre: the centre stays.
		const before = await textBox(page);
		const alt = await drag(page, 'w', -60, 0, true);
		await alt();
		const after = await textBox(page);
		expect(Math.abs(after.x + after.width / 2 - (before.x + before.width / 2))).toBeLessThan(1.5);
		expect(after.width).toBeGreaterThan(before.width + 80);

		// Auto width: one line again.
		await page.getByRole('button', { name: 'Auto width' }).click();
		expect((await item(page)).width).toBe('auto');
		await expect.poll(async () => (await textBox(page)).height).toBeLessThan(one.height * 1.2);
		await expect(page.getByTestId('text-width')).toContainText('Auto');
	});

	test('corner handles scale the words, keeping proportions, with a live percentage', async ({ page }) => {
		await setup(page);
		const done = await drag(page, 'se', 60, 25);
		await expect(page.getByTestId('text-size-label')).toHaveText(/^\d+%$/);
		await done();
		const it = await item(page);
		expect(it.scaleX).toBeGreaterThan(1.2);
		expect(it.scaleY).toBeCloseTo(it.scaleX!, 6);
		// The width mode is untouched.
		expect(it.width).toBe('auto');
	});

	test('handles stay grabbable with the words partly outside the frame', async ({ page }) => {
		const id = await setup(page);
		await api(page, `s => s.setTextPosition('${id}', 0.02, 0.4)`);
		const preview = (await page.getByTestId('preview').boundingBox())!;
		const w = (await handle(page, 'w').boundingBox())!;
		expect(w.x + w.width / 2).toBeLessThan(preview.x); // on the pasteboard
		const one = await textBox(page);
		const done = await drag(page, 'w', 120, 0);
		await done();
		const after = await textBox(page);
		expect(after.width).toBeLessThan(one.width - 80);
		expect(Math.abs(after.x + after.width - (one.x + one.width))).toBeLessThan(1.5); // the right side stayed
	});
});
