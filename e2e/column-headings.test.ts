import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

/** "Add" and "Your media" share one heading style: font, size, weight, line height and the space under it. */

const look = (page: Page, name: string) =>
	page.getByRole('heading', { name, exact: true }).evaluate((el) => {
		const s = getComputedStyle(el);
		// The heading's block: just the heading, or its row (with "Remove unused" beside or under it).
		const block = el.closest('.head') ?? el;
		const next = block.nextElementSibling as HTMLElement;
		return {
			font: `${s.fontFamily} | ${s.fontStyle} | ${s.fontWeight} | ${s.fontSize} | ${s.lineHeight} | ${s.letterSpacing}`,
			size: s.fontSize,
			oneLine: Math.round(el.getBoundingClientRect().height) === parseFloat(s.lineHeight),
			under: Math.round((next.getBoundingClientRect().top - block.getBoundingClientRect().bottom) * 10) / 10
		};
	});

test('"Add" and "Your media" headings look the same, with the same space under them', async ({ page }) => {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	// One unused file, so "Remove unused" sits beside the heading too.
	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: { project: { scenes: { id: string }[] }; deleteScene(id: string): void } }).__scenes;
		s.deleteScene(s.project.scenes[1].id);
	});
	await expect(page.getByRole('button', { name: 'Remove unused' })).toBeVisible();

	for (const width of [1440, 1100]) {
		await page.setViewportSize({ width, height: 1000 });
		const add = await look(page, 'Add');
		const media = await look(page, 'Your media');
		expect(add.font).toBe(media.font);
		expect(add.size).toBe('22px');
		expect(add.oneLine && media.oneLine).toBe(true);
		// "Remove unused" on one line too.
		expect(await page.getByRole('button', { name: 'Remove unused' }).evaluate((b) => b.getBoundingClientRect().height < 24)).toBe(true);
		expect(add.under).toBe(8);
		expect(media.under).toBe(8);
		await page.locator('[aria-label="Add"]').screenshot({ path: test.info().outputPath(`headings-${width}.png`) });
	}
});

test('the section headings in the Settings column all share one style', async ({ page }) => {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	// A card layer: its settings have the most sections (and keyframes and card fields).
	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: { addCardOverlay(t: number): string; select(id: string): void } }).__scenes;
		s.select(s.addCardOverlay(0));
	});
	const settings = page.getByRole('complementary', { name: 'Settings' });
	const fonts = await settings.locator('.section-title').evaluateAll((els) =>
		els.map((el) => {
			const s = getComputedStyle(el);
			return `${s.fontFamily} | ${s.fontStyle} | ${s.fontWeight} | ${s.fontSize}`;
		})
	);
	expect(fonts.length).toBeGreaterThan(4);
	expect(new Set(fonts).size).toBe(1);
});
