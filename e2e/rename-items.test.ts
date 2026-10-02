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

		// Its settings: "Scene 1 · Intro" (the file's name underneath).
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await expect(settings(page).getByRole('heading', { name: 'Scene 1 · Intro' })).toBeVisible();

		// Moved to second: the number follows.
		await api(page, 's => s.moveScene(0, 1)');
		await expect(page.getByRole('button', { name: /^Scene 2, Intro, / })).toBeVisible();
		await expect(page.locator('.card-slot').nth(1).locator('.name')).toHaveText('2 · Intro');
		await expect(settings(page).getByRole('heading', { name: 'Scene 2 · Intro' })).toBeVisible();

		// Esc cancels.
		await page.locator('.card-slot').nth(1).locator('.name').dblclick();
		await page.keyboard.type('Nope');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: /^Scene 2, Intro, / })).toBeVisible();

		// From the settings title: clearing the name brings the file's name back.
		await settings(page).getByRole('button', { name: 'Rename Scene 2 · Intro' }).click();
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
		await expect(page.getByRole('button', { name: /^Add red\.mp4 as a new scene/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /^Add Intro/ })).toHaveCount(0);

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
		await expect(settings(page).getByRole('heading', { name: 'Layer · Logo' })).toBeVisible();
		await page.screenshot({ path: test.info().outputPath('layer-renamed.png') });

		// Right-click › Rename, from the settings: Esc leaves it.
		await layer.locator('.item').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Rename' }).click();
		await expect(page.getByRole('textbox', { name: 'Layer name' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(layer.locator('.name')).toHaveText('Logo');

		// Settings title: clear it → "Card" again.
		await settings(page).getByRole('button', { name: 'Rename Layer · Logo' }).click();
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
