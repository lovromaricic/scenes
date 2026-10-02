import { expect, test, type Locator, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * Renaming in place (the video's title, a track's name, a video on the home page): one quiet
 * outline (a 1px border-colour border on the soft surface, no focus ring on top), the text
 * doesn't move, keyboard focus on the shown title is a single ring, and selected text is tinted
 * with the accent instead of the browser's blue.
 */

/** The colour a CSS colour expression resolves to, as the browser reports it. */
const resolve = (page: Page, css: string) =>
	page.evaluate((css) => {
		const el = document.createElement('span');
		el.style.color = css;
		document.body.append(el);
		const c = getComputedStyle(el).color;
		el.remove();
		return c;
	}, css);

const look = (l: Locator) =>
	l.evaluate((el) => {
		const s = getComputedStyle(el);
		const r = el.getBoundingClientRect();
		return {
			border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
			background: s.backgroundColor,
			boxShadow: s.boxShadow,
			outline: s.outlineStyle,
			radius: s.borderTopLeftRadius,
			font: `${s.fontFamily} ${s.fontStyle} ${s.fontSize} ${s.fontWeight} ${s.lineHeight}`,
			// Where the text starts: inside the border and padding.
			textX: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft),
			textY: r.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop),
			selection: getComputedStyle(el, '::selection').backgroundColor
		};
	});

async function expectInlineEdit(page: Page, field: Locator) {
	const l = await look(field);
	expect(l.border).toBe(`1px solid ${await resolve(page, 'var(--color-border)')}`);
	expect(l.background).toBe(await resolve(page, 'var(--color-surface)'));
	expect(l.boxShadow).toBe('none');
	expect(l.outline).toBe('none');
	expect(l.radius).toBe('8px');
	return l;
}

test('renaming the video: one quiet outline, the text stays put, keyboard focus is one ring, selection is accent-tinted', async ({ page }) => {
	await openNewVideo(page);
	// Measure once the fonts are in (until then the names around it change width).
	await page.evaluate(() => document.fonts.ready);
	const shown = page.getByRole('button', { name: /, rename$/ });
	const before = await look(shown);

	// Keyboard focus on the shown title (not editing): the app's single focus ring.
	await page.getByRole('link', { name: 'Projects' }).focus();
	await page.keyboard.press('Tab');
	await expect(shown).toBeFocused();
	const ring = (await look(shown)).boxShadow;
	const ref = await page.evaluate(() => {
		const b = document.createElement('button');
		b.style.boxShadow = 'var(--focus-ring)';
		document.body.append(b);
		const s = getComputedStyle(b).boxShadow;
		b.remove();
		return s;
	});
	expect(ring).toBe(ref);
	expect((await look(shown)).outline).toBe('none');

	// Editing (Enter on the focused title).
	await page.keyboard.press('Enter');
	const input = page.getByRole('textbox', { name: 'Video title' });
	await expect(input).toBeFocused();
	const editing = await expectInlineEdit(page, input);
	expect(editing.font).toBe(before.font);
	expect(Math.abs(editing.textX - before.textX)).toBeLessThan(0.5);
	expect(Math.abs(editing.textY - before.textY)).toBeLessThan(0.5);
	// The whole title is selected, in the accent tint.
	expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 'Untitled video'.length]);
	expect(editing.selection).toBe(await resolve(page, 'var(--color-text-selection)'));
	await page.locator('.topbar').screenshot({ path: test.info().outputPath('title-editing.png') });

	await input.fill('Picnic');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Picnic');
	const after = await look(page.getByRole('button', { name: /, rename$/ }));
	expect(Math.abs(after.textX - before.textX)).toBeLessThan(0.5);
});

test('track names and video names on the home page use the same outline, and the text stays put', async ({ page }) => {
	await openNewVideo(page);
	await page.evaluate(() => document.fonts.ready);
	const name = page.locator('[data-track-header] .name').filter({ hasText: 'Overlay 1' });
	const before = await look(name);
	await name.dblclick();
	const input = page.getByRole('textbox', { name: 'Track name' });
	await expect(input).toBeFocused();
	const editing = await expectInlineEdit(page, input);
	expect(Math.abs(editing.textX - before.textX)).toBeLessThan(0.5);
	await page.locator('[data-track-header]').first().screenshot({ path: test.info().outputPath('track-editing.png') });
	await page.keyboard.press('Escape');

	// On the home page (a video with a clip, so it's kept).
	await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await page.getByRole('link', { name: 'Projects' }).click();
	await page.getByRole('button', { name: 'More for Untitled video' }).click();
	await page.getByRole('menuitem', { name: 'Rename' }).click();
	const rename = page.getByRole('textbox', { name: 'Video name' });
	await expect(rename).toBeFocused();
	const r = await expectInlineEdit(page, rename);
	expect(r.selection).toBe(await resolve(page, 'var(--color-text-selection)'));
	await page.getByRole('article', { name: 'Untitled video' }).screenshot({ path: test.info().outputPath('home-rename.png') });
});
