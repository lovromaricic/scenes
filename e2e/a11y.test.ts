import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { importViaPicker } from './helpers';

/** Automated accessibility checks (contrast, names, roles) on the main screens. */
test.describe('Accessibility', () => {
	const check = async (page: import('@playwright/test').Page) => {
		// Measure colours after entrance fades have finished, not half-way through them.
		await page.evaluate(() =>
			Promise.all(
				document
					.getAnimations()
					.filter((a) => a.effect?.getTiming().iterations !== Infinity)
					.map((a) => a.finished.catch(() => {}))
			)
		);
		const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
		const summary = results.violations.flatMap((v) =>
			v.nodes
				.slice(0, 3)
				.map((n) => `${v.id}: ${n.target.join(' ')} — ${n.any.map((a) => a.message).join('; ')}`)
		);
		expect(summary).toEqual([]);
	};

	test('empty editor', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Start with your photos & videos')).toBeVisible();
		await check(page);
	});

	test('editor with scenes, words and the save dialog', async ({ page }) => {
		await page.goto('/');
		await importViaPicker(page, ['red.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('button', { name: /^Words/ }).click();
		await page.getByRole('button', { name: /^Caption/ }).click();
		await page.keyboard.press('Enter');
		await page.waitForTimeout(4000); // let toasts settle
		await check(page);
		await page.getByRole('button', { name: 'Save video' }).click();
		await expect(page.getByRole('dialog', { name: 'Save video' })).toBeVisible();
		await check(page);
	});

	test('design page', async ({ page }) => {
		await page.goto('/design');
		await check(page);
	});
});
