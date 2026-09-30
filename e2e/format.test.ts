import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openFormat, setFormat } from './helpers';

const formatButton = (page: Page) => page.getByRole('button', { name: /^Project format:/ });
const previewRatio = (page: Page) =>
	page.evaluate(() => {
		const r = document.querySelector('.preview')!.getBoundingClientRect();
		return r.width / r.height;
	});

test('a new project takes its format from the first clip; later clips don’t change it', async ({
	page
}) => {
	await page.goto('/');
	await expect(formatButton(page)).toContainText('1920 × 1080 · 30 fps');
	// A 360×640, 25 fps phone-shaped clip → Vertical 720p at 25 fps.
	await importViaPicker(page, ['portrait.mp4'], 'Choose photos & videos');
	await expect(formatButton(page)).toContainText('720 × 1280 · 25 fps');
	await expect.poll(() => previewRatio(page)).toBeCloseTo(9 / 16, 2);
	// Adding a landscape clip keeps the format.
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: /^Clips/ }).click();
	await page.getByRole('button', { name: 'Choose files' }).click();
	await (await chooser).setFiles('e2e/fixtures/red.mp4');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await expect(formatButton(page)).toContainText('720 × 1280 · 25 fps');
	// Undoing the first import also undoes the format it chose.
	const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
	await page.keyboard.press(`${mod}+z`);
	await page.keyboard.press(`${mod}+z`);
	await expect(formatButton(page)).toContainText('1920 × 1080 · 30 fps');
});

test('the Project format panel changes shape, size and frame rate; undoable and saved', async ({
	page
}) => {
	await page.goto('/');
	await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
	await expect(formatButton(page)).toContainText('1280 × 720 · 30 fps');

	await setFormat(page, 'Landscape', '1080p');
	await expect(formatButton(page)).toContainText('1920 × 1080');
	await setFormat(page, 'Landscape', '4K');
	await expect(formatButton(page)).toContainText('3840 × 2160');
	await setFormat(page, 'Vertical');
	await expect(formatButton(page)).toContainText('2160 × 3840');
	await expect.poll(() => previewRatio(page)).toBeCloseTo(9 / 16, 2);
	await setFormat(page, 'Portrait', '1080p');
	await expect(formatButton(page)).toContainText('1080 × 1350');
	await setFormat(page, 'Cinematic', '1080p', 24);
	await expect(formatButton(page)).toContainText('2520 × 1080 · 24 fps');
	await expect.poll(() => previewRatio(page)).toBeCloseTo(21 / 9, 2);

	// Custom: rounded to even numbers and kept within limits.
	const panel = await openFormat(page);
	await panel.getByRole('radio', { name: /^Custom/ }).click();
	await panel.getByRole('spinbutton', { name: 'Width' }).fill('1001');
	await panel.getByRole('spinbutton', { name: 'Height' }).fill('9999');
	await panel.getByRole('spinbutton', { name: 'Height' }).press('Enter');
	await expect(formatButton(page)).toContainText('1002 × 4096');
	await panel.getByRole('spinbutton', { name: 'Height' }).fill('100');
	await panel.getByRole('spinbutton', { name: 'Height' }).press('Enter');
	await expect(formatButton(page)).toContainText('1002 × 240');
	await page.keyboard.press('Escape');

	// Undo walks back through the changes.
	const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
	await page.keyboard.press(`${mod}+z`);
	await expect(formatButton(page)).toContainText('1002 × 4096');
	await page.keyboard.press(`${mod}+z`);
	await page.keyboard.press(`${mod}+z`);
	await expect(formatButton(page)).toContainText('2520 × 1080 · 24 fps');

	// Saved with the project.
	await page.reload();
	await expect(formatButton(page)).toContainText('2520 × 1080 · 24 fps');
});
