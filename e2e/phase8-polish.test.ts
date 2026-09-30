import { expect, test } from '@playwright/test';
import { fixture, importViaPicker, scenes } from './helpers';

test.describe('Phase 8: polish', () => {
	test('a first-time user can make and save a short video with only what’s on screen', async ({
		page
	}) => {
		await page.goto('/');

		// The empty project explains what to do.
		await expect(page.getByText('Start with your photos & videos')).toBeVisible();
		await expect(page.getByRole('list', { name: 'How it works' })).toContainText('Save your video');
		await expect(page.getByRole('button', { name: 'Save video' })).toBeDisabled();

		// 1. Add clips with the big button.
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: 'Choose photos & videos' }).click();
		await (
			await chooser
		).setFiles([fixture('red.mp4'), fixture('yellow.jpg'), fixture('blue.webm')]);
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		await expect(page.getByText(/Drag the cards to change the order/)).toBeVisible();

		// 2. Words: a title.
		await page.getByRole('button', { name: /^Words/ }).click();
		await page.getByRole('button', { name: /^Title/ }).click();
		await page.keyboard.type('Our trip');
		await page.keyboard.press('Enter');
		await expect(
			page.getByRole('group', { name: 'Words' }).getByRole('button', { name: /Our trip/ })
		).toBeVisible();

		// A transition and a look.
		await page.getByRole('button', { name: /Transition between scene 1 and 2/ }).click();
		await page.getByRole('radio', { name: /^Crossfade/ }).click();
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page
			.getByRole('radiogroup', { name: 'Mood' })
			.getByRole('radio', { name: 'Punchy' })
			.click();

		// Music.
		await page.getByRole('button', { name: /^Sound/ }).click();
		const musicChooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: /^Music/ }).click();
		await (await musicChooser).setFiles(fixture('music.m4a'));
		await expect(page.getByRole('button', { name: /^Music: / })).toBeVisible();

		// 3. Save.
		await page.getByRole('button', { name: 'Save video' }).click();
		await page.getByRole('radio', { name: /Small file/ }).click();
		const download = page.waitForEvent('download', { timeout: 60_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		expect((await download).suggestedFilename()).toBe('Untitled video.mp4');
		await expect(page.getByRole('dialog', { name: 'Your video is ready' })).toBeVisible();
	});

	test('? shows the keyboard shortcuts', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Start with your photos & videos')).toBeVisible();
		await page.keyboard.press('?');
		const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('Split the scene at the playhead');
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		// Also reachable with the mouse.
		await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
		await expect(dialog).toBeVisible();
	});

	test('Watch plays the whole video full screen and returns to editing', async ({ page }) => {
		await page.goto('/');
		await importViaPicker(page, ['red.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('button', { name: 'Watch' }).click();
		const watch = page.getByRole('dialog', { name: /^Watch/ });
		await expect(watch).toBeVisible();
		await expect.poll(() => scenes(page, (s) => s.playing)).toBe(true);
		await expect.poll(() => scenes(page, (s) => s.time)).toBeGreaterThan(0.5);
		// Space pauses; the editor's own shortcuts don't act underneath.
		await page.keyboard.press('Space');
		await expect.poll(() => scenes(page, (s) => s.playing)).toBe(false);
		await page.keyboard.press('s');
		await expect(page.getByRole('button', { name: /^Scene \d, / })).toHaveCount(2);
		await page.getByRole('button', { name: 'Back to editing' }).click();
		await expect(watch).toHaveCount(0);
		// The editor's preview draws again.
		await expect.poll(() => scenes(page, (s) => s.player.isFrameReady())).toBe(true);
	});

	test('the editor works on a tablet in landscape', async ({ page }) => {
		await page.setViewportSize({ width: 1024, height: 768 });
		await page.goto('/');
		await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		for (const [width, height] of [
			[1024, 768],
			[1180, 820]
		]) {
			await page.setViewportSize({ width, height });
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
			expect(overflow).toBeLessThanOrEqual(0);
			for (const name of ['Save video', 'Watch', 'Undo']) {
				await expect(page.getByRole('button', { name, exact: true })).toBeInViewport();
			}
			await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeInViewport();
			await expect(page.getByRole('group', { name: 'Sound' })).toBeInViewport();
			await expect(page.getByRole('button', { name: /^Cards/ })).toBeInViewport();
		}
	});
});
