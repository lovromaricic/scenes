import { expect, test } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

test.describe('Save dialog', () => {
	test('two choices at the top (what, save as), and the size, length and file size before saving', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		const what = dialog.getByRole('radiogroup', { name: 'What' });
		await expect(what.getByRole('radio', { name: 'Whole video' })).toHaveAttribute('aria-checked', 'true');
		// No range yet: Range is there but can't be chosen, and says how to set one.
		await expect(what.getByRole('radio', { name: 'Range' })).toBeDisabled();
		await expect(what.getByRole('radio', { name: 'Range' })).toHaveAttribute('title', /I for its start, O for its end/);
		await expect(dialog.getByRole('radiogroup', { name: 'Save as' }).getByRole('radio', { name: 'Video' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await expect(dialog.getByTestId('export-summary')).toHaveText(/^\d+ × \d+ · 7 sec · about [\d.]+ MB$/);
		// The quality changes the size and estimate.
		const before = await dialog.getByTestId('export-summary').textContent();
		await dialog.getByRole('radio', { name: /Small file/ }).click();
		await expect(dialog.getByTestId('export-summary')).not.toHaveText(before!);
	});
});
