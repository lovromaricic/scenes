import { expect, test, type Page } from '@playwright/test';
import { fixture, importViaPicker, openNewVideo } from './helpers';

/**
 * Items keep the length they're given (nothing follows the video's end by itself); "Extend to end
 * of video" (right-click) stretches an item once to the end, as far as its clip allows. Undoable.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const endOf = (page: Page, id: string) =>
	api<number>(page, `s => { const i = [...s.project.overlays, ...s.project.texts, ...s.project.sounds].find((x) => x.id === '${id}'); return Math.round((i.start + i.duration) * 100) / 100; }`);

async function extend(page: Page, id: string) {
	await page.locator(`[data-item-id="${id}"] .item`).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Extend to end of video' }).click();
}

test('Extend to end of video: words to the end, a video layer and a song as far as their clips go; one undo step each', async ({ page }) => {
	test.setTimeout(120_000);
	await openNewVideo(page);
	// Two 12 s scenes (24 s), and a 3 s green clip that becomes a layer.
	await importViaPicker(page, ['long.mp4', 'long.mp4', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
	await page.keyboard.press('Escape');
	const ids = await api<{ words: string; layer: string }>(page, `s => {
		const green = s.project.scenes[2];
		s.deleteScene(green.id);
		const layer = s.addOverlayFromMedia(green.mediaId, 1, s.project.tracks.find((t) => t.name === 'Overlay 1').id);
		s.setOverlayTiming(layer, 1, 1);
		s.seek(2);
		s.addText('caption');
		s.stopEditingText();
		const words = s.selectedId;
		s.setTextTiming(words, 2, 3);
		s.deselect();
		return { words, layer };
	}`);
	expect(await api<number>(page, 's => s.duration')).toBe(24);
	// A 12 s song from the start.
	await page.getByRole('button', { name: /^Sound Music/ }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: /^Music Add a song/ }).click();
	await (await chooser).setFiles(fixture('music.m4a'));
	await expect(page.locator('.item-slot.sound')).toHaveCount(1);
	await page.keyboard.press('Escape');
	const song = await api<string>(page, `s => { const x = s.project.sounds[0]; s.setSoundTiming(x.id, { start: 0, sourceStart: 0, duration: 2 }); return x.id; }`);

	await extend(page, ids.words);
	expect(await endOf(page, ids.words)).toBe(24);
	await extend(page, ids.layer);
	expect(await endOf(page, ids.layer)).toBe(4); // its clip is 3 s long
	await extend(page, song);
	expect(await endOf(page, song)).toBe(12); // the whole song, no further

	// Undo: one step each.
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
	expect(await endOf(page, song)).toBe(2);
	expect(await endOf(page, ids.layer)).toBe(4);

	// It was once: the video getting shorter or longer doesn't move it.
	await api(page, 's => s.duplicateScene(s.project.scenes[0].id)');
	expect(await endOf(page, ids.words)).toBe(24);
});
