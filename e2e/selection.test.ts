import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

const selectedId = (page: Page) =>
	scenes(page, (s) => (s as unknown as { selectedId: string | null }).selectedId);
const settingsTitle = (page: Page) =>
	page.getByRole('complementary', { name: 'Settings' }).getByRole('heading', { level: 2 });
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Text options' });
const words = (page: Page, text: string) => page.getByRole('button', { name: `Words: ${text}`, exact: true });

/** Two clips, and words at 1s; the words are selected. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'blue.webm'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await seekTo(page, 1);
	await addWords(page, 'Hello there');
	await words(page, 'Hello there').click();
	await expect(toolbar(page)).toBeVisible();
}

async function addWords(page: Page, text: string) {
	await page.getByRole('button', { name: /^Words Titles/ }).click();
	await page.getByRole('button', { name: /^Caption/ }).click();
	await page.keyboard.type(text);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape'); // close the Add panel if it's still open
}

/** Click a point of the preview, as fractions of its size. */
async function clickPreview(page: Page, fx: number, fy: number) {
	const b = (await page.getByTestId('preview').boundingBox())!;
	await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
}

async function expectDeselected(page: Page, sceneTitle = 'Scene 1') {
	await expect(toolbar(page)).toHaveCount(0);
	await expect(page.locator('.text-box.selected')).toHaveCount(0);
	expect(await selectedId(page)).toBeNull();
	// The right column shows the scene under the playhead.
	await expect(settingsTitle(page)).toHaveText(sceneTitle);
}

test.describe('Selecting and deselecting on the video', () => {
	test('empty preview space, the stage around it and Esc deselect words', async ({ page }) => {
		await setup(page);
		await expect(settingsTitle(page)).not.toHaveText('Scene 1');

		// Empty space on the picture.
		await clickPreview(page, 0.1, 0.15);
		await expectDeselected(page);
		// Clicking the words selects them again.
		await words(page, 'Hello there').click();
		await expect(toolbar(page)).toBeVisible();

		// The empty stage around the preview (beside the play controls).
		const stage = (await page.getByRole('region', { name: 'Preview' }).boundingBox())!;
		const play = (await page.getByRole('button', { name: 'Play', exact: true }).boundingBox())!;
		await page.mouse.click(stage.x + 12, play.y + play.height / 2);
		await expectDeselected(page);

		// Esc: while typing, the first Esc stops typing and the second deselects.
		await words(page, 'Hello there').click();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('textbox', { name: 'Type the words on the video' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('textbox', { name: 'Type the words on the video' })).toHaveCount(0);
		await expect(toolbar(page)).toBeVisible();
		expect(await selectedId(page)).not.toBeNull();
		await page.keyboard.press('Escape');
		await expectDeselected(page);
	});

	test('editing in the settings, the toolbar and pickers keeps the words selected', async ({ page }) => {
		await setup(page);
		const id = await selectedId(page);

		// Colours in the right column.
		const hex = page.getByRole('textbox', { name: 'Text color: hex code' });
		await hex.fill('#00ff00');
		await hex.press('Enter');
		await page.getByRole('slider', { name: 'Text color: opacity' }).fill('0.5');
		expect(await selectedId(page)).toBe(id);
		await expect(toolbar(page)).toBeVisible();

		// The font picker (a dialog over the page).
		await page.getByRole('button', { name: /^Font:/ }).click();
		const fonts = page.getByRole('dialog', { name: 'Choose a font' });
		await fonts.getByRole('button', { name: /^Anton/ }).click();
		await expect(page.getByRole('button', { name: /^Font: Anton/ })).toBeVisible();
		// Esc closes an open picker, not the selection.
		await page.getByRole('button', { name: /^Font:/ }).click();
		await expect(fonts).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(fonts).toHaveCount(0);
		expect(await selectedId(page)).toBe(id);

		// The floating toolbar's Style popover, even where it sits over the picture.
		await toolbar(page).getByRole('button', { name: 'Style' }).click();
		await page.getByRole('dialog', { name: 'Text style' }).getByRole('radio', { name: 'Outlined' }).click();
		expect(await selectedId(page)).toBe(id);
		await expect(toolbar(page)).toBeVisible();
	});

	test('dragging words and releasing outside them (or outside the preview) keeps them selected', async ({
		page
	}) => {
		await setup(page);
		const id = await selectedId(page);
		const box = (await words(page, 'Hello there').boundingBox())!;
		const preview = (await page.getByTestId('preview').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, preview.y + preview.height * 0.3, { steps: 6 });
		// Release far away: over the storyboard.
		await page.mouse.move(box.x + box.width / 2, preview.y + preview.height + 200, { steps: 6 });
		await page.mouse.up();
		expect(await selectedId(page)).toBe(id);
		await expect(toolbar(page)).toBeVisible();
	});

	test('other words, scene cards and empty storyboard space', async ({ page }) => {
		await setup(page);
		const first = await selectedId(page);
		await addWords(page, 'Second words');
		await expect(words(page, 'Second words')).toBeVisible();
		// Higher up, so the two don't overlap on the picture.
		await page.evaluate(() => {
			const s = (window as unknown as {
				__scenes: { project: { texts: { id: string }[] }; setTextPosition(id: string, x: number, y: number): void };
			}).__scenes;
			s.setTextPosition(s.project.texts[1].id, 0.5, 0.3);
		});

		// Clicking the other words selects those instead.
		await words(page, 'Hello there').click();
		expect(await selectedId(page)).toBe(first);
		const second = await scenes(page, (s) =>
			(s as unknown as { project: { texts: { id: string; text: string }[] } }).project.texts.find(
				(t) => t.text === 'Second words'
			)!.id
		);
		await words(page, 'Second words').click();
		expect(await selectedId(page)).toBe(second);
		await expect(page.locator('.text-box.selected')).toHaveCount(1);

		// A scene card selects the scene (and not the words).
		await page.getByRole('button', { name: /^Scene 2, / }).click();
		await expect(toolbar(page)).toHaveCount(0);
		await expect(settingsTitle(page)).toHaveText('Scene 2');
		const scene2 = await selectedId(page);
		expect(scene2).not.toBe(second);

		// Empty space after the scenes deselects; the settings follow the playhead (now in scene 2).
		const row = (await page.getByRole('group', { name: 'Scenes' }).boundingBox())!;
		await page.mouse.click(row.x + row.width - 20, row.y + row.height / 2);
		expect(await selectedId(page)).toBeNull();
		await expect(settingsTitle(page)).toHaveText('Scene 2');

		// Empty space on the Text track too.
		await seekTo(page, 1);
		await words(page, 'Hello there').click();
		await expect(toolbar(page)).toBeVisible();
		const lane = (await page.getByRole('group', { name: 'Text' }).boundingBox())!;
		await page.mouse.click(lane.x + lane.width - 20, lane.y + lane.height / 2);
		await expectDeselected(page);
	});

	test('card rectangles: click to select, click elsewhere or Esc to deselect', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await page.getByRole('button', { name: /^Cards/ }).click();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('button', { name: 'Add rectangle' }).click();
		const handle = page.locator('[data-rect-handle="se"]');
		await expect(handle).toBeVisible();
		const card = await selectedId(page);

		// Resizing and releasing outside the preview keeps it selected.
		const h = (await handle.boundingBox())!;
		await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
		await page.mouse.down();
		await page.mouse.move(h.x + 40, h.y + 600, { steps: 8 });
		await page.mouse.up();
		expect(await selectedId(page)).toBe(card);
		await expect(handle).toBeVisible();

		// Empty picture: handles go, but the right column still shows the card (it's at the playhead).
		await clickPreview(page, 0.04, 0.06);
		await expect(handle).toHaveCount(0);
		await expect(page.getByTestId('rect-size')).toHaveCount(0);
		expect(await selectedId(page)).toBeNull();
		await expect(settingsTitle(page)).toHaveText('Scene 2');
		await expect(page.getByRole('button', { name: 'Remove rectangle' })).toBeVisible();

		// Clicking the rectangle selects it again.
		await page.getByRole('button', { name: /^Rectangle, / }).click();
		await expect(handle).toBeVisible();
		expect(await selectedId(page)).toBe(card);
		await page.keyboard.press('Escape');
		await expect(handle).toHaveCount(0);

		// Changing the card's settings while nothing is selected selects it.
		await page
			.getByRole('radiogroup', { name: 'Background' })
			.getByRole('radio', { name: 'Sand' })
			.click();
		expect(await selectedId(page)).toBe(card);
		await expect(handle).toBeVisible();
	});
});
