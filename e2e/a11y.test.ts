import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

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
		await openNewVideo(page);
		await expect(page.getByText('Start with your photos & videos')).toBeVisible();
		await check(page);
	});

	test('editor with scenes, words and the save dialog', async ({ page }) => {
		await openNewVideo(page);
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

	test('home screen, empty and with projects, menu and delete dialog', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Your videos will appear here.')).toBeVisible();
		await check(page);
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await page.getByRole('link', { name: 'Projects' }).click();
		await expect(page.getByRole('article')).toHaveCount(1);
		await expect(page.getByRole('article').locator('img')).toHaveCount(1);
		await check(page);
		await page.getByRole('button', { name: 'More for Untitled video' }).click();
		await expect(page.getByRole('menu')).toBeVisible();
		await check(page);
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await check(page);
	});

	test('editor video menu, and the dialog for a file that can’t be opened', async ({ page }) => {
		await openNewVideo(page);
		await page.getByRole('button', { name: 'Video menu' }).click();
		await expect(page.getByRole('menu')).toBeVisible();
		await check(page);
		await page.keyboard.press('Escape');
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.items.add(new File(['not a project'], 'notes.scenes'));
			for (const type of ['dragenter', 'dragover', 'drop']) {
				document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
			}
		});
		await expect(page.getByRole('dialog', { name: /Couldn’t open/ })).toBeVisible();
		await check(page);
	});

	test('a selected layer: its panel, toolbar and style popover, and the Layers track', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.evaluate(() => {
			const s = (window as unknown as { __scenes: { media: Record<string, { id: string; name: string }>; addOverlayFromMedia(id: string, t: number): string } }).__scenes;
			s.addOverlayFromMedia(Object.values(s.media).find((m) => m.name === 'blue.webm')!.id, 0.5);
		});
		await expect(page.getByRole('toolbar', { name: 'Layer options' })).toBeVisible();
		await page.waitForTimeout(4000); // let toasts settle
		await check(page);
		await page.getByRole('toolbar', { name: 'Layer options' }).getByRole('button', { name: 'Style' }).click();
		await expect(page.getByRole('dialog', { name: 'Layer style' })).toBeVisible();
		await check(page);
	});

	test('design page', async ({ page }) => {
		await page.goto('/design');
		await check(page);
	});
});
