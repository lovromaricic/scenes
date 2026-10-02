import { expect, test, type Page } from '@playwright/test';
import { fixture, importViaPicker, openNewVideo } from './helpers';

/**
 * Your media: select (Shift/Cmd-click for several), right-click to add, find in the timeline,
 * rename or delete. Unused files go right away (undoable); used ones ask first and take their
 * uses with them (one undo step). "Remove unused" clears them for good and frees storage.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const library = (page: Page) => page.getByRole('region', { name: 'Your media' });
const tile = (page: Page, name: string) => library(page).getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}, `) });
const menu = (page: Page) => page.getByRole('menu');
const entries = (page: Page) => menu(page).getByRole('menuitem').evaluateAll((els) => els.map((e) => e.querySelector('.text')!.textContent!.trim()));
const counts = (page: Page) =>
	api<{ scenes: number; overlays: number; sounds: number; library: number }>(
		page,
		's => ({ scenes: s.project.scenes.length, overlays: s.project.overlays.length, sounds: s.project.sounds.length, library: s.project.library.length })'
	);
/** The ids of the files stored on this device. */
const stored = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<string[]>((resolve, reject) => {
				const open = indexedDB.open('scenes');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const q = open.result.transaction('media').objectStore('media').getAllKeys();
					q.onsuccess = () => {
						resolve(q.result as string[]);
						open.result.close();
					};
				};
			})
	);
const idOf = (page: Page, name: string) => api<string>(page, `s => s.project.library.find((id) => s.media[id].name === '${name}')`);

/** Red, green and yellow scenes, and a song. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4', 'yellow.jpg'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /^Sound Music/ }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: /^Music Add a song/ }).click();
	await (await chooser).setFiles(fixture('music.m4a'));
	await expect(page.locator('.item-slot.sound')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(library(page).locator('[data-media-id]')).toHaveCount(4);
}

test.describe('Your media', () => {
	test.setTimeout(120_000);

	test('right-click: add as a scene, a layer or sound; show in the timeline; selection; rename here only', async ({ page }) => {
		await setup(page);
		const redHasSound = await api<boolean>(page, `s => s.media[s.project.library[0]].hasAudio`);

		// The options for a video, and for a song.
		await tile(page, 'red.mp4').click({ button: 'right' });
		expect(await entries(page)).toEqual([
			'Add as scene',
			'Add as layer at playhead',
			...(redHasSound ? ['Add to audio track'] : []),
			'Show in timeline',
			'Rename',
			'Delete'
		]);
		await page.screenshot({ path: test.info().outputPath('media-menu.png') });
		await page.keyboard.press('Escape');
		await tile(page, 'music.m4a').click({ button: 'right' });
		expect(await entries(page)).toEqual(['Add to audio track', 'Show in timeline', 'Rename', 'Delete']);
		await menu(page).getByRole('menuitem', { name: 'Add to audio track' }).click();
		await expect.poll(async () => (await counts(page)).sounds).toBe(2);

		// Add as scene (at the end) and as a layer at the playhead.
		await tile(page, 'red.mp4').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Add as scene' }).click();
		await expect(page.getByRole('button', { name: /^Scene 4, Red/ })).toBeVisible();
		await api(page, 's => s.seek(1)');
		await tile(page, 'red.mp4').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Add as layer at playhead' }).click();
		await expect.poll(async () => (await counts(page)).overlays).toBe(1);
		expect(await api(page, 's => s.project.overlays[0].start')).toBe(1);

		// Show in timeline: every scene and item using it, selected; the first one in view.
		await tile(page, 'red.mp4').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Show in timeline' }).click();
		const uses = await api<string[]>(page, `s => s.mediaUses([s.project.library[0]])`);
		expect(uses).toHaveLength(3);
		expect(await api<string[]>(page, 's => s.selectedIds')).toEqual(uses);
		await expect(page.getByRole('button', { name: /^Scene 1, Red/ })).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('button', { name: /^Scene 4, Red/ })).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('button', { name: /^Scene 1, Red/ })).toBeInViewport();

		// Selecting: a click, then Shift-click (or Cmd/Ctrl-click) for more; the menu is for all.
		await tile(page, 'green.mp4').click();
		await expect(tile(page, 'green.mp4')).toHaveAttribute('aria-pressed', 'true');
		await tile(page, 'yellow.jpg').click({ modifiers: ['Shift'] });
		await tile(page, 'music.m4a').click({ modifiers: [mod] });
		await expect(library(page).locator('[aria-pressed="true"]')).toHaveCount(3);
		await tile(page, 'yellow.jpg').click({ button: 'right' });
		expect(await entries(page)).toEqual(['Show in timeline', 'Delete 3 files']);
		await page.keyboard.press('Escape');

		// Rename: only here (the file and the scenes keep their names).
		await tile(page, 'red.mp4').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Rename' }).click();
		const field = library(page).getByRole('textbox', { name: 'Name in Your media' });
		await expect(field).toBeFocused();
		await expect(field).toHaveValue('red.mp4');
		await page.keyboard.type('Opening shot');
		await page.screenshot({ path: test.info().outputPath('media-rename.png') });
		await page.keyboard.press('Enter');
		await expect(tile(page, 'Opening shot')).toBeVisible();
		await expect(page.getByRole('button', { name: /^Scene 1, Red/ })).toBeVisible();
		expect(await api(page, 's => s.media[s.project.library[0]].name')).toBe('red.mp4');
		// Clearing the name brings the file's back; undo, the given one.
		await tile(page, 'Opening shot').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Rename' }).click();
		await field.fill('');
		await page.keyboard.press('Enter');
		await expect(tile(page, 'red.mp4')).toBeVisible();
		await page.keyboard.press(`${mod}+z`);
		await expect(tile(page, 'Opening shot')).toBeVisible();
	});

	test('deleting: unused right away (undoable, also with the Delete key); used asks first, removes its uses in one step; not the only scenes', async ({ page }) => {
		await setup(page);
		// Yellow, no longer used.
		await api(page, 's => s.deleteScene(s.project.scenes[2].id)');
		await expect(tile(page, 'yellow.jpg')).toContainText('Not used');
		await tile(page, 'yellow.jpg').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Delete' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(tile(page, 'yellow.jpg')).toHaveCount(0);
		await page.keyboard.press(`${mod}+z`);
		await expect(tile(page, 'yellow.jpg')).toBeVisible();
		// The Delete key, on the selected file.
		await tile(page, 'yellow.jpg').click();
		await page.keyboard.press('Delete');
		await expect(tile(page, 'yellow.jpg')).toHaveCount(0);
		expect((await counts(page)).scenes).toBe(2);

		// Green is used by a scene: asked first; "Show in timeline" from there.
		await tile(page, 'green.mp4').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Delete' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText('This is used in 1 place in your video. Deleting it removes that too.');
		await page.screenshot({ path: test.info().outputPath('media-delete-confirm.png') });
		await dialog.getByRole('button', { name: 'Show in timeline' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Scene 2, Green/ })).toHaveAttribute('aria-pressed', 'true');
		expect((await counts(page)).scenes).toBe(2);
		// Cancel leaves it.
		await tile(page, 'green.mp4').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Delete' }).click();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		expect((await counts(page)).scenes).toBe(2);
		// Delete: the file and its scene go (the gap closes); one undo brings both back.
		await tile(page, 'green.mp4').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Delete' }).click();
		await dialog.getByRole('button', { name: 'Delete' }).click();
		await expect(tile(page, 'green.mp4')).toHaveCount(0);
		await expect.poll(() => counts(page)).toMatchObject({ scenes: 1, library: 2 });
		await page.keyboard.press(`${mod}+z`);
		await expect.poll(() => counts(page)).toMatchObject({ scenes: 2, library: 3 });
		await expect(page.getByRole('button', { name: /^Scene 2, Green/ })).toBeVisible();

		// Red and green together are every scene: blocked, with why.
		await tile(page, 'red.mp4').click();
		await tile(page, 'green.mp4').click({ modifiers: ['Shift'] });
		await tile(page, 'green.mp4').click({ button: 'right' });
		const del = menu(page).getByRole('menuitem', { name: /Delete 2 files/ });
		await expect(del).toBeDisabled();
		await expect(del).toContainText('Your video needs at least one scene.');
		await page.keyboard.press('Escape');
	});

	test('Remove unused clears them and frees storage; files deleted while editing are freed on leaving', async ({ page }) => {
		await setup(page);
		const green = await idOf(page, 'green.mp4');
		const yellow = await idOf(page, 'yellow.jpg');
		const red = await idOf(page, 'red.mp4');
		// Green and yellow no longer used (and a fresh session, so no undo step needs them).
		await api(page, 's => { s.deleteScene(s.project.scenes[2].id); s.deleteScene(s.project.scenes[1].id); }');
		await expect(page.getByText('Saved on this device')).toBeVisible({ timeout: 10_000 });
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		expect(await stored(page)).toEqual(expect.arrayContaining([green, yellow]));

		await library(page).getByRole('button', { name: 'Remove unused' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText('Remove 2 unused files?');
		await expect(dialog).toContainText(/freeing .*(MB|GB) of storage/);
		await page.screenshot({ path: test.info().outputPath('remove-unused.png') });
		await dialog.getByRole('button', { name: 'Remove' }).click();
		await expect(page.getByText(/Removed 2 unused files/)).toBeVisible();
		await expect(library(page).locator('[data-media-id]')).toHaveCount(2);
		await expect(library(page).getByRole('button', { name: 'Remove unused' })).toHaveCount(0);
		await expect.poll(() => stored(page)).not.toContain(green);
		expect(await stored(page)).not.toContain(yellow);
		expect(await stored(page)).toContain(red);

		// A used file deleted while editing: kept while undo could bring it back, freed on leaving.
		const song = await idOf(page, 'music.m4a');
		await tile(page, 'music.m4a').click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		await expect(tile(page, 'music.m4a')).toHaveCount(0);
		expect(await stored(page)).toContain(song);
		await page.getByRole('link', { name: 'Projects' }).click();
		await expect(page.getByRole('heading', { name: 'Your videos' })).toBeVisible();
		await expect.poll(() => stored(page)).not.toContain(song);
		expect(await stored(page)).toContain(red);
	});
});
