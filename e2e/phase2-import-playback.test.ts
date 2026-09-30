import { expect, test } from '@playwright/test';
import { centerColor, dominant, importViaDrop, importViaPicker, scenes, seekTo, openNewVideo } from './helpers';

test.describe('Phase 2: import, preview and playback', () => {
	test('three clips become scene cards, play in order with sound, and scrub', async ({ page }) => {
		await openNewVideo(page);
		await expect(page.getByText('Start with your photos & videos')).toBeVisible();

		await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');

		// Three cards with the right names and lengths, in order.
		const cards = page.getByRole('button', { name: /^Scene \d, / });
		await expect(cards).toHaveCount(3);
		await expect(cards.nth(0)).toHaveAccessibleName(/Scene 1, Red, 4s/);
		await expect(cards.nth(1)).toHaveAccessibleName(/Scene 2, Green, 3s/);
		await expect(cards.nth(2)).toHaveAccessibleName(/Scene 3, Blue, 3s/);
		await expect(page.getByText('3 scenes · 10 sec')).toBeVisible();
		await expect(page.getByTestId('clock')).toHaveText(/0:00\s*of\s*0:10/);

		// Each card has a generated thumbnail.
		const thumbs = page.locator('.card .thumb');
		await expect(thumbs.nth(0)).toHaveAttribute('style', /url\("blob:/);

		// The preview shows the right scene at each time.
		expect(dominant(await centerColor(page))).toBe('red');
		await seekTo(page, 5);
		expect(dominant(await centerColor(page))).toBe('green');
		await seekTo(page, 8.5);
		expect(dominant(await centerColor(page))).toBe('blue');

		// Scrub by dragging the playhead handle back to the first scene.
		const handle = page.getByRole('button', { name: /^Playhead/ });
		const box = (await handle.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		const ruler = (await page.locator('.ruler').boundingBox())!;
		for (let i = 0; i <= 10; i++) {
			await page.mouse.move(box.x - ((box.x - ruler.x - 20) * i) / 10, box.y + 4);
		}
		await page.mouse.up();
		const t = await scenes(page, (s) => s.time);
		expect(t).toBeLessThan(4);
		expect(dominant(await centerColor(page))).toBe('red');

		// Play with Space: time moves, and sound is scheduled.
		await seekTo(page, 3);
		await page.keyboard.press('Space');
		await expect.poll(() => scenes(page, (s) => s.playing)).toBe(true);
		await expect
			.poll(() => scenes(page, (s) => s.player.audioStats().scheduled), { timeout: 5000 })
			.toBeGreaterThan(0);
		expect(await scenes(page, (s) => s.player.audioStats().state)).toBe('running');
		await expect.poll(() => scenes(page, (s) => s.time), { timeout: 5000 }).toBeGreaterThan(4.3);
		// Crossed into scene 2 during playback.
		const color = dominant(
			await page.evaluate(() => {
				const s = (
					window as unknown as {
						__scenes: { player: { readPixel(x: number, y: number): number[] } };
					}
				).__scenes;
				const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
				const p = s.player.readPixel(Math.floor(c.width * 0.6), Math.floor(c.height * 0.6));
				return [p[0], p[1], p[2]] as [number, number, number];
			})
		);
		expect(color).toBe('green');
		await page.keyboard.press('Space');
		await expect.poll(() => scenes(page, (s) => s.playing)).toBe(false);
	});

	test('playback runs to the end and stops', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['green.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => scenes(page, (s) => s.playing), { timeout: 6000 }).toBe(false);
		expect(await scenes(page, (s) => s.time)).toBeCloseTo(3, 1);
		await expect(page.getByTestId('clock')).toHaveText(/0:03\s*of\s*0:03/);
	});

	test('drag and drop adds photos as 3-second scenes, and rejects other files kindly', async ({
		page
	}) => {
		await openNewVideo(page);
		await importViaDrop(page, ['yellow.jpg', 'notes.txt']);
		await expect(page.getByRole('button', { name: /^Scene 1, Yellow, 3s/ })).toBeVisible();
		await expect(
			page.getByText('“notes.txt” isn’t a photo or video Scenes can use.')
		).toBeVisible();
		expect(dominant(await centerColor(page))).toBe('yellow');
	});

	test('scrubbing lands on the exact frame in a clip with sparse keyframes', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['steps.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		const expected = ['red', 'green', 'blue', 'white', 'black', 'yellow'];
		for (const second of [4, 1, 5, 2, 0, 3]) {
			await seekTo(page, second + 0.5);
			expect(dominant(await centerColor(page)), `at ${second + 0.5}s`).toBe(expected[second]);
		}
	});
});
