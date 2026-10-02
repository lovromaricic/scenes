import { expect, test } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

test.describe('Save dialog', () => {
	test('what to save (only when the range is part of the video), save as, and the size, length and file size before saving', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		// The range is the whole video: nothing to choose, it's all of it.
		await expect(dialog.getByRole('radiogroup', { name: 'What' })).toHaveCount(0);
		await expect(dialog.getByRole('radiogroup', { name: 'Save as' }).getByRole('radio', { name: 'Video' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await expect(dialog.getByTestId('export-summary')).toHaveText(/^\d+ × \d+ · 7 sec · about [\d.]+ MB$/);
		// The quality changes the size and estimate.
		const before = await dialog.getByTestId('export-summary').textContent();
		await dialog.getByRole('radio', { name: /Small file/ }).click();
		await expect(dialog.getByTestId('export-summary')).not.toHaveText(before!);
		await page.keyboard.press('Escape');

		// With a range that's part of the video: both choices, the range chosen.
		await page.evaluate(() => (window as unknown as { __scenes: { setRange(r: object): void } }).__scenes.setRange({ start: 1, end: 3 }));
		await page.getByRole('button', { name: 'Save video' }).click();
		const what = page.getByRole('dialog', { name: 'Save video' }).getByRole('radiogroup', { name: 'What' });
		await expect(what.getByRole('radio', { name: /^Range/ })).toHaveAttribute('aria-checked', 'true');
		await expect(what.getByRole('radio', { name: 'Whole video' })).toHaveAttribute('aria-checked', 'false');
	});
});
