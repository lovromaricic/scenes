import { expect, test, type Page } from '@playwright/test';
import { fixture, importViaPicker, openNewVideo } from './helpers';

/**
 * Right-click anything on the storyboard: the same menu everywhere (only what applies), Delete
 * last, in red, with its shortcut. Several selected items are deleted together; the last scene
 * and items on locked tracks can't be (Delete is disabled, with why). Undo brings it all back.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const menu = (page: Page) => page.getByRole('menu');
const entries = (page: Page) => menu(page).getByRole('menuitem').evaluateAll((els) => els.map((e) => e.querySelector('.text')!.textContent!.trim()));
const counts = (page: Page) =>
	api<{ scenes: number; overlays: number; texts: number; sounds: number }>(
		page,
		's => ({ scenes: s.project.scenes.length, overlays: s.project.overlays.length, texts: s.project.texts.length, sounds: s.project.sounds.length })'
	);

/** Red (4 s) and green (3 s) scenes, a card (0–2 s), words (2–4 s) and a song. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /^Sound Music/ }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: /^Music Add a song/ }).click();
	await (await chooser).setFiles(fixture('music.m4a'));
	await expect(page.locator('.item-slot.sound')).toHaveCount(1);
	return api<{ card: string; words: string; song: string; overlay1: string }>(page, `s => {
		const card = s.addCardOverlay(0);
		s.setOverlayTiming(card, 0, 2);
		s.seek(2);
		s.addText('caption');
		s.stopEditingText();
		const words = s.selectedId;
		s.setTextWords(words, 'Hello');
		s.setTextTiming(words, 2, 2);
		s.deselect();
		return { card, words, song: s.project.sounds[0].id, overlay1: s.project.overlays[0].trackId };
	}`);
}

const item = (page: Page, id: string) => page.locator(`[data-item-id="${id}"] .item`);

test.describe('Right-click menu', () => {
	test.setTimeout(120_000);

	test('the same options everywhere, only what applies, Delete last in red with its shortcut; at the mouse, inside the window; Esc and clicking elsewhere close it', async ({ page }) => {
		const ids = await setup(page);

		// A scene: no copy or cut (scenes aren't copied that way), no "Extend to end".
		await page.getByRole('button', { name: /^Scene 2, / }).click({ button: 'right' });
		expect(await entries(page)).toEqual(['Rename', 'Duplicate', 'Split here', 'Delete']);
		await page.keyboard.press('Escape');
		await expect(menu(page)).toHaveCount(0);

		// A layer: everything that applies to it.
		await item(page, ids.card).click({ button: 'right' });
		expect(await entries(page)).toEqual(['Rename', 'Copy', 'Cut', 'Duplicate', 'Split here', 'Extend to end of video', 'Delete']);
		const del = menu(page).getByRole('menuitem', { name: /Delete/ });
		await expect(del.locator('kbd')).toHaveText(process.platform === 'darwin' ? '⌫' : 'Delete');
		await expect(menu(page).getByRole('menuitem', { name: /Copy/ }).locator('kbd')).toHaveText(process.platform === 'darwin' ? '⌘C' : 'Ctrl+C');
		const red = await del.evaluate((el) => {
			const probe = document.createElement('span');
			probe.style.color = 'var(--color-danger)';
			document.body.append(probe);
			const want = getComputedStyle(probe).color;
			probe.remove();
			return [getComputedStyle(el).color, want];
		});
		expect(red[0]).toBe(red[1]);
		// A divider just above Delete.
		expect(await del.evaluate((el) => el.previousElementSibling?.getAttribute('role'))).toBe('separator');
		await page.screenshot({ path: test.info().outputPath('layer-menu.png') });
		// Copy: Paste shows up after.
		await menu(page).getByRole('menuitem', { name: /Copy/ }).click();
		await expect(menu(page)).toHaveCount(0);
		await item(page, ids.words).click({ button: 'right' });
		expect(await entries(page)).toEqual(['Rename', 'Copy', 'Cut', 'Paste', 'Duplicate', 'Split here', 'Extend to end of video', 'Delete']);
		// Clicking elsewhere closes it.
		await page.locator('.topbar').click({ position: { x: 600, y: 30 } });
		await expect(menu(page)).toHaveCount(0);

		// At the mouse, and inside the window even near its bottom-right corner.
		const song = (await item(page, ids.song).boundingBox())!;
		const view = page.viewportSize()!;
		// Near the window's right edge (the song goes on past it), clear of its trim handle.
		const at = { x: Math.min(song.x + song.width - 20, view.width - 12), y: song.y + song.height / 2 };
		await page.mouse.click(at.x, at.y, { button: 'right' });
		// Once it has slid into place.
		await menu(page).evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished)));
		const box = (await menu(page).boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(view.width);
		expect(box.y + box.height).toBeLessThanOrEqual(view.height);
		// A corner of it is at the pointer (flipped up and/or left when there's no room).
		const nearX = Math.min(Math.abs(box.x - at.x), Math.abs(box.x + box.width - at.x));
		const nearY = Math.min(Math.abs(box.y - at.y), Math.abs(box.y + box.height - at.y));
		expect(nearX).toBeLessThan(2);
		expect(nearY).toBeLessThan(2);
		await page.screenshot({ path: test.info().outputPath('song-menu.png') });
		// Choosing an option closes it.
		await menu(page).getByRole('menuitem', { name: 'Extend to end of video' }).click();
		await expect(menu(page)).toHaveCount(0);
	});

	test('Delete from the menu, for every kind: a scene closes its gap, items leave theirs; one undo each', async ({ page }) => {
		const ids = await setup(page);
		const before = await counts(page);

		// A scene: the green one moves up to 0 s.
		await page.getByRole('button', { name: /^Scene 1, / }).click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: /Delete/ }).click();
		await expect.poll(() => counts(page)).toMatchObject({ scenes: 1 });
		await expect(page.getByRole('button', { name: /^Scene 1, Green/ })).toBeVisible();

		// The layer, the words and the song: each gone, the others where they were.
		for (const [id, key] of [[ids.card, 'overlays'], [ids.words, 'texts'], [ids.song, 'sounds']] as const) {
			await item(page, id).click({ button: 'right' });
			await menu(page).getByRole('menuitem', { name: /Delete/ }).click();
			await expect.poll(async () => (await counts(page))[key]).toBe(0);
			await expect(page.locator(`[data-item-id="${id}"]`)).toHaveCount(0);
		}
		// Items left a gap: the words didn't move when the card went.
		// Undo, one step each: everything back.
		for (let i = 0; i < 4; i++) await page.keyboard.press(`${mod}+z`);
		expect(await counts(page)).toEqual(before);
		expect(await api(page, `s => { const w = s.project.texts[0]; return [w.start, w.duration]; }`)).toEqual([2, 2]);
		await expect(page.getByRole('button', { name: /^Scene 1, Red/ })).toBeVisible();
	});

	test('several selected items: "Delete 3 items", together, one undo', async ({ page }) => {
		const ids = await setup(page);
		await api(page, `s => s.selectItems(['${ids.card}', '${ids.words}', '${ids.song}'])`);
		await item(page, ids.words).click({ button: 'right' });
		// Only what applies to several: no Rename, Split here or Extend.
		expect(await entries(page)).toEqual(['Copy', 'Cut', 'Duplicate 3 items', 'Delete 3 items']);
		await menu(page).getByRole('menuitem', { name: 'Delete 3 items' }).click();
		await expect.poll(() => counts(page)).toEqual({ scenes: 2, overlays: 0, texts: 0, sounds: 0 });
		await page.keyboard.press(`${mod}+z`);
		expect(await counts(page)).toEqual({ scenes: 2, overlays: 1, texts: 1, sounds: 1 });

		// Right-clicking one that isn't selected: just that one.
		await api(page, `s => s.selectItems(['${ids.card}', '${ids.words}'])`);
		await item(page, ids.song).click({ button: 'right' });
		expect((await entries(page)).at(-1)).toBe('Delete');
		expect(await api(page, 's => s.selectedIds')).toEqual([ids.song]);
	});

	test('the last scene and items on locked tracks: Delete disabled, with why', async ({ page }) => {
		const ids = await setup(page);
		await api(page, 's => s.deleteScene(s.project.scenes[1].id)');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toHaveCount(0);

		await page.getByRole('button', { name: /^Scene 1, / }).click({ button: 'right' });
		const del = menu(page).getByRole('menuitem', { name: /Delete/ });
		await expect(del).toBeDisabled();
		await expect(del).toContainText('Your video needs at least one scene.');
		await page.screenshot({ path: test.info().outputPath('last-scene.png') });
		await page.keyboard.press('Escape');
		// The Delete key keeps it too, and says why.
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page.keyboard.press('Delete');
		await expect(page.getByTestId('item-bubble')).toContainText('Your video needs at least one scene.');
		expect((await counts(page)).scenes).toBe(1);

		// A locked track: Delete only, disabled, with why.
		await api(page, `s => s.setTrackFlag('${ids.overlay1}', 'locked', true)`);
		// (Its button says it's disabled, so the click is forced.)
		await item(page, ids.card).click({ button: 'right', force: true });
		expect(await entries(page)).toEqual(['Delete']);
		await expect(menu(page).getByRole('menuitem', { name: /Delete/ })).toBeDisabled();
		await expect(menu(page)).toContainText('This track is locked.');
		await page.screenshot({ path: test.info().outputPath('locked.png') });
		await page.keyboard.press('Escape');
		expect((await counts(page)).overlays).toBe(1);
	});

	test('Duplicate puts a copy right after; Split here splits where right-clicked; each one undo', async ({ page }) => {
		const ids = await setup(page);
		await item(page, ids.card).click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Duplicate' }).click();
		expect(await api(page, 's => s.project.overlays.map((o) => [o.start, o.duration])')).toEqual([[0, 2], [2, 2]]);
		await page.keyboard.press(`${mod}+z`);
		expect((await counts(page)).overlays).toBe(1);

		// Right-click a quarter of the way into the card (0.5 s): split there.
		const box = (await item(page, ids.card).boundingBox())!;
		await page.mouse.click(box.x + box.width / 4, box.y + box.height / 2, { button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Split here' }).click();
		const parts = await api<number[][]>(page, 's => s.project.overlays.map((o) => [o.start, o.duration]).sort((a, b) => a[0] - b[0])');
		expect(parts).toHaveLength(2);
		expect(parts[0][0]).toBe(0);
		expect(parts[0][1]).toBeCloseTo(0.5, 1);
		expect(parts[1][0] + parts[1][1]).toBeCloseTo(2, 3);
		await page.keyboard.press(`${mod}+z`);
		expect((await counts(page)).overlays).toBe(1);

		// A scene: Duplicate adds it after itself.
		await page.getByRole('button', { name: /^Scene 1, / }).click({ button: 'right' });
		await menu(page).getByRole('menuitem', { name: 'Duplicate' }).click();
		await expect(page.getByRole('button', { name: /^Scene 2, Red/ })).toBeVisible();
	});
});
