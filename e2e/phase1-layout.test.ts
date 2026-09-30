import { expect, test } from '@playwright/test';
import { importViaPicker } from './helpers';

test.describe('Phase 1: design system and layout', () => {
	test('design page shows every component', async ({ page }) => {
		await page.goto('/design');
		await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Save video' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Watch' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'Length' }).first()).toBeVisible();
		await expect(page.getByRole('radiogroup', { name: 'Speed' })).toBeVisible();
		await expect(page.getByRole('radiogroup', { name: 'Mood' })).toBeVisible();
		await expect(page.getByRole('radiogroup', { name: 'Video shape' })).toBeVisible();
		await expect(page.getByRole('toolbar', { name: 'Text options' })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Scene 1' })).toBeVisible();

		// Stepper, chips and toolbar respond.
		await page.getByRole('button', { name: 'Longer' }).click();
		await expect(page.getByRole('group', { name: 'Length' }).first()).toContainText('4.5 sec');
		await page.getByRole('radio', { name: '2×' }).click();
		await expect(page.getByRole('radio', { name: '2×' })).toHaveAttribute('aria-checked', 'true');
		await page.getByRole('button', { name: 'Animate' }).click();
		await expect(page.getByText('Last action: Animate')).toBeVisible();
	});

	test('editor layout has every region', async ({ page }) => {
		await page.goto('/');
		await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
		// Top bar
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(page.getByText(/\d+ scenes · \d+ sec/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Redo' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Watch' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Save video' })).toBeVisible();
		// Add column
		for (const name of ['Clips', 'Words', 'Sound', 'Looks']) {
			await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
		}
		// Stage
		await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(page.getByText(/0:\d\d\s*of\s*0:\d\d/)).toBeVisible();
		await expect(page.getByRole('radiogroup', { name: 'Video shape' })).toBeVisible();
		// Storyboard
		await expect(page.getByRole('region', { name: 'Storyboard' })).toBeVisible();
		await expect(page.getByRole('button', { name: /^Scene 1,/ })).toBeVisible();
		await expect(
			page.getByRole('button', { name: /Transition between scene 1 and 2/ })
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Scene', exact: true })).toBeVisible();
		await expect(page.getByRole('group', { name: 'Words' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'Sound' })).toBeVisible();
	});

	test('add panels open and close with Escape', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: /^Looks/ }).click();
		await expect(page.getByRole('radiogroup', { name: 'Mood for the whole video' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('radiogroup', { name: 'Mood for the whole video' })).toHaveCount(0);
	});

	test('no horizontal page scroll at 1280 and tablet landscape', async ({ page }) => {
		for (const width of [1280, 1024]) {
			await page.setViewportSize({ width, height: 768 });
			await page.goto('/');
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow).toBeLessThanOrEqual(0);
		}
	});
});
