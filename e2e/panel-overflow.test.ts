import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, openNewVideo } from './helpers';

/**
 * Side panels only scroll down, never sideways: Your media with very long file names (the tile
 * names are cut with "…", the full name in the tooltip), the Add and Settings columns, and the
 * font picker, at narrow and wide windows.
 */

const LONG = 'a-very-long-file-name-that-goes-on-and-on-without-any-spaces-at-all-holiday-2026.mp4';
const SPACED = 'Our summer holiday by the sea with the whole family and the dog, day three, evening.mp4';

/** scrollWidth and clientWidth of everything that must not scroll sideways. */
const widths = (page: Page) =>
	page.evaluate(() => {
		const measure = (el: Element | null) => (el ? [(el as HTMLElement).scrollWidth, (el as HTMLElement).clientWidth] : null);
		return {
			media: measure(document.querySelector('[aria-labelledby="library-title"] .grid')),
			library: measure(document.querySelector('[aria-labelledby="library-title"]')),
			add: measure(document.querySelector('[aria-label="Add"] .column, [aria-label="Add"]')),
			settings: measure(document.querySelector('[aria-label="Settings"] .inspector, [aria-label="Settings"]')),
			fonts: measure(document.querySelector('.picker .list'))
		};
	});

function expectNoSideways(w: Record<string, number[] | null>, ...keys: string[]) {
	for (const key of keys) {
		expect(w[key], key).not.toBeNull();
		expect(w[key]![0], `${key} scrolls sideways`).toBe(w[key]![1]);
	}
}

test('Your media and the side panels never scroll sideways, even with very long names and narrow windows', async ({ page }) => {
	await openNewVideo(page);
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Choose photos & videos' }).first().click();
	await (await chooser).setFiles([
		{ name: 'red.mp4', mimeType: 'video/mp4', buffer: readFileSync(fixture('red.mp4')) },
		{ name: LONG, mimeType: 'video/mp4', buffer: readFileSync(fixture('green.mp4')) },
		{ name: SPACED, mimeType: 'video/mp4', buffer: readFileSync(fixture('green.mp4')).subarray(0) }
	]);
	await expect(page.locator('[data-media-id]')).toHaveCount(2); // the same green clip is stored once
	await page.keyboard.press('Escape');
	// A long name given in Your media too.
	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: { project: { library: string[] }; renameMedia(id: string, n: string): void } }).__scenes;
		s.renameMedia(s.project.library[0], 'The red one, from the very first morning of the trip, before anyone else woke up');
	});

	for (const width of [1440, 1100, 900]) {
		await page.setViewportSize({ width, height: 900 });
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		expectNoSideways(await widths(page), 'media', 'library', 'add', 'settings');
		// Each name is one line, cut with an ellipsis, inside its tile; the full name in the tooltip.
		const names = await page.locator('[aria-labelledby="library-title"] li').evaluateAll((items) =>
			items.map((li) => {
				const name = li.querySelector('.name') as HTMLElement;
				const tile = li.querySelector('.item') as HTMLElement;
				const s = getComputedStyle(name);
				return {
					fits: name.getBoundingClientRect().right <= li.getBoundingClientRect().right + 0.5 && name.getBoundingClientRect().left >= li.getBoundingClientRect().left - 0.5,
					cut: name.scrollWidth > name.clientWidth,
					oneLine: s.whiteSpace === 'nowrap' && s.textOverflow === 'ellipsis',
					tooltip: tile.title,
					text: name.textContent
				};
			})
		);
		for (const n of names) {
			expect(n.fits).toBe(true);
			expect(n.oneLine).toBe(true);
			expect(n.tooltip).toBe(n.text);
		}
		expect(names.every((n) => n.cut)).toBe(true);
	}
	await page.setViewportSize({ width: 900, height: 900 });
	await page.screenshot({ path: test.info().outputPath('narrow.png') });

	// The Settings column with a clip selected, and the font picker open, at narrow and wide sizes.
	await page.getByRole('button', { name: /^Scene 1, / }).click();
	expectNoSideways(await widths(page), 'settings');
	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: { seek(t: number): void; addText(k: string): void; stopEditingText(): void } }).__scenes;
		s.seek(1);
		s.addText('caption');
		s.stopEditingText();
	});
	await page.getByRole('button', { name: /^Font: .*Change$/ }).click();
	for (const width of [900, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		expectNoSideways(await widths(page), 'fonts', 'settings', 'media');
	}
});
