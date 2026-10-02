import { expect, test, type Page } from '@playwright/test';
import { fixture, importViaPicker, openNewVideo } from './helpers';

/**
 * Scenes and items can be renamed (in this project only): double-click the name on the
 * storyboard, click the title in the settings, or right-click › Rename. Enter or clicking
 * elsewhere saves, Esc cancels, an empty name brings the default back. A scene's number stays
 * automatic ("2 · Intro"). Undoable, saved, and the media keeps its own name.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const settings = (page: Page) => page.getByRole('complementary', { name: 'Settings' });

async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.keyboard.press('Escape');
}

test.describe('Renaming scenes and items', () => {
	test.setTimeout(120_000);

	test('a scene: double-click its name, the number stays automatic, the settings title, Esc, clearing, undo, saved', async ({ page }) => {
		await setup(page);
		const first = page.locator('.card-slot').first();

		// Double-click the name: a field with the name selected; Enter saves.
		await first.locator('.name').dblclick();
		const field = page.getByRole('textbox', { name: 'Scene 1 name' });
		await expect(field).toBeFocused();
		await expect(field).toHaveValue('Red');
		expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 3]);
		await page.screenshot({ path: test.info().outputPath('scene-renaming.png'), clip: (await first.boundingBox())! });
		await page.keyboard.type('Intro');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: /^Scene 1, Intro, / })).toBeVisible();
		await expect(first.locator('.name')).toHaveText('1 · Intro');

		// Its settings: the heading is the name; which scene it is goes underneath.
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await expect(settings(page).getByRole('heading', { name: 'Intro', exact: true })).toBeVisible();
		await expect(settings(page).locator('.subtitle')).toContainText('Scene 1 · Red · starts at');

		// Moved to second: the number follows.
		await api(page, 's => s.moveScene(0, 1)');
		await expect(page.getByRole('button', { name: /^Scene 2, Intro, / })).toBeVisible();
		await expect(page.locator('.card-slot').nth(1).locator('.name')).toHaveText('2 · Intro');
		await expect(settings(page).locator('.subtitle')).toContainText('Scene 2 · Red · starts at');

		// Esc cancels.
		await page.locator('.card-slot').nth(1).locator('.name').dblclick();
		await page.keyboard.type('Nope');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: /^Scene 2, Intro, / })).toBeVisible();

		// From the settings title: clearing the name brings the file's name back.
		await settings(page).getByRole('button', { name: 'Rename Intro' }).click();
		const title = settings(page).getByRole('textbox', { name: 'Scene 2 name' });
		await expect(title).toBeFocused();
		await expect(title).toHaveValue('Intro');
		await title.fill('');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: /^Scene 2, Red, / })).toBeVisible();
		await expect(settings(page).getByRole('heading', { name: 'Scene 2', exact: true })).toBeVisible();

		// Undo brings the name back; one step.
		await page.keyboard.press(`${mod}+z`);
		await expect(page.getByRole('button', { name: /^Scene 2, Intro, / })).toBeVisible();

		// Your media keeps the file's own name.
		const media = page.getByRole('region', { name: 'Your media' });
		await expect(media.getByRole('button', { name: /^red\.mp4, video/ })).toBeVisible();
		await expect(media.getByRole('button', { name: /^Intro/ })).toHaveCount(0);

		// Saved with the project.
		await expect(page.getByText('Saved on this device')).toBeVisible({ timeout: 10_000 });
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 2, Intro, / })).toBeVisible();
	});

	test('a layer, words and a song: double-click, the settings title, right-click › Rename; clicking elsewhere saves; clearing restores the default', async ({ page }) => {
		await setup(page);
		const card = await api<string>(page, 's => { const c = s.addCardOverlay(0); s.deselect(); return c; }');
		const layer = page.locator(`[data-item-id="${card}"]`);

		// Double-click the layer's name; clicking elsewhere saves.
		await layer.locator('.name').dblclick();
		const field = page.getByRole('textbox', { name: 'Layer name' });
		await expect(field).toBeFocused();
		await expect(field).toHaveValue('Card');
		await page.keyboard.type('Logo');
		await page.screenshot({ path: test.info().outputPath('layer-renaming.png') });
		await page.locator('.stage, [data-testid="preview"]').first().click({ position: { x: 5, y: 5 } });
		await expect(layer.locator('.name')).toHaveText('Logo');
		await layer.locator('.item').click();
		await expect(settings(page).getByRole('heading', { name: 'Logo', exact: true })).toBeVisible();
		await expect(settings(page).locator('.subtitle')).toContainText('Layer · Card · starts at');
		await page.screenshot({ path: test.info().outputPath('layer-renamed.png') });

		// Right-click › Rename, from the settings: Esc leaves it.
		await layer.locator('.item').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Rename' }).click();
		await expect(page.getByRole('textbox', { name: 'Layer name' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(layer.locator('.name')).toHaveText('Logo');

		// Settings title: clear it → "Card" again.
		await settings(page).getByRole('button', { name: 'Rename Logo' }).click();
		await settings(page).getByRole('textbox', { name: 'Layer name' }).fill('');
		await page.keyboard.press('Enter');
		await expect(layer.locator('.name')).toHaveText('Card');
		await expect(settings(page).getByRole('heading', { name: 'Layer', exact: true })).toBeVisible();

		// Words show their words until renamed, and again once the name is cleared.
		const words = await api<string>(page, `s => { s.seek(1); s.addText('caption'); s.stopEditingText(); const id = s.selectedId; s.setTextWords(id, 'Hello there'); s.deselect(); return id; }`);
		const item = page.locator(`[data-item-id="${words}"]`);
		await expect(item.locator('.name')).toHaveText('Hello there');
		await item.locator('.item').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Rename' }).click();
		await page.getByRole('textbox', { name: 'Words name' }).fill('Greeting');
		await page.keyboard.press('Enter');
		await expect(item.locator('.name')).toHaveText('Greeting');
		await item.locator('.name').dblclick();
		await page.getByRole('textbox', { name: 'Words name' }).fill('');
		await page.keyboard.press('Enter');
		await expect(item.locator('.name')).toHaveText('Hello there');

		// A song, from its settings.
		await page.getByRole('button', { name: /^Sound Music/ }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: /^Music Add a song/ }).click();
		await (await chooser).setFiles(fixture('music.m4a'));
		await expect(page.locator('.item-slot.sound')).toHaveCount(1);
		await settings(page).getByRole('button', { name: 'Rename Music' }).click();
		await settings(page).getByRole('textbox', { name: 'Music name' }).fill('Theme');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: /^Music: Theme, / })).toBeVisible();
		expect(await api<string>(page, 's => s.project.sounds[0].name')).toBe('music');
	});
});

test('the settings heading: click "Scene 2", type to replace it; the field matches renaming the video, as wide as its text, nothing moves', async ({ page }) => {
	await setup(page);
	await page.evaluate(() => document.fonts.ready);
	await page.getByRole('button', { name: /^Scene 2, / }).click();
	const heading = settings(page).getByRole('heading', { name: 'Scene 2', exact: true });
	await expect(heading).toBeVisible();
	await expect(settings(page).locator('.subtitle')).toContainText('Green · starts at');
	const shown = await heading.evaluate((el) => {
		const s = getComputedStyle(el);
		const r = el.getBoundingClientRect();
		return { x: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft), y: r.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop), font: `${s.fontFamily} ${s.fontStyle} ${s.fontSize}` };
	});

	// The whole heading is the field, with it all selected.
	await settings(page).getByRole('button', { name: 'Rename Scene 2' }).click();
	const field = settings(page).getByRole('textbox', { name: 'Scene 2 name' });
	await expect(field).toBeFocused();
	await expect(field).toHaveValue('Scene 2');
	expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 7]);
	await expect(settings(page).getByText('Scene 2 ·', { exact: true })).toHaveCount(0);
	const look = await field.evaluate((el) => {
		const s = getComputedStyle(el);
		const r = el.getBoundingClientRect();
		return {
			x: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft),
			y: r.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop),
			font: `${s.fontFamily} ${s.fontStyle} ${s.fontSize}`,
			width: r.width,
			textWidth: (() => {
				const c = document.createElement('canvas').getContext('2d')!;
				c.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
				return c.measureText((el as HTMLInputElement).value).width;
			})(),
			border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
			background: s.backgroundColor,
			boxShadow: s.boxShadow,
			selection: getComputedStyle(el, '::selection').backgroundColor
		};
	});
	expect(look.font).toBe(shown.font);
	expect(Math.abs(look.x - shown.x)).toBeLessThan(0.5);
	expect(Math.abs(look.y - shown.y)).toBeLessThan(0.5);
	// As wide as its text (plus its padding and border), not the whole panel.
	expect(look.width).toBeLessThan(look.textWidth + 30);
	expect(look.boxShadow).toBe('none');
	await page.screenshot({ path: test.info().outputPath('heading-editing.png'), clip: { x: 1140, y: 70, width: 300, height: 90 } });

	// The same look as renaming the video's title.
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /, rename$/ }).click();
	const titleLook = await page.getByRole('textbox', { name: 'Video title' }).evaluate((el) => {
		const s = getComputedStyle(el);
		return { border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, background: s.backgroundColor, selection: getComputedStyle(el, '::selection').backgroundColor };
	});
	expect({ border: look.border, background: look.background, selection: look.selection }).toEqual(titleLook);
	await page.keyboard.press('Escape');

	// Type "Intro": the heading is "Intro", "Scene 2" goes underneath, the storyboard says "2 · Intro".
	await page.getByRole('button', { name: /^Scene 2, / }).click();
	await settings(page).getByRole('button', { name: 'Rename Scene 2' }).click();
	await expect(field).toBeFocused();
	await page.keyboard.type('Intro');
	await page.keyboard.press('Enter');
	await expect(settings(page).getByRole('heading', { name: 'Intro', exact: true })).toBeVisible();
	await expect(settings(page).locator('.subtitle')).toContainText('Scene 2 · Green · starts at');
	await expect(page.locator('.card-slot').nth(1).locator('.name')).toHaveText('2 · Intro');
	await page.screenshot({ path: test.info().outputPath('heading-renamed.png'), clip: { x: 1140, y: 70, width: 300, height: 90 } });

	// Typing the plain heading back (or clearing it) brings "Scene 2" back.
	await settings(page).getByRole('button', { name: 'Rename Intro' }).click();
	await field.fill('Scene 2');
	await page.keyboard.press('Enter');
	await expect(settings(page).getByRole('heading', { name: 'Scene 2', exact: true })).toBeVisible();
	expect(await api(page, 's => s.project.scenes[1].label ?? null')).toBeNull();
	await expect(page.locator('.card-slot').nth(1).locator('.name')).toHaveText('2 · Green');
});
