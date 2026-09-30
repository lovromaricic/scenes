import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

const tracks = (page: Page) => page.locator('.storyboard .tracks');
const scroll = (page: Page) =>
	tracks(page).evaluate((el) => ({ left: el.scrollLeft, width: el.scrollWidth, client: el.clientWidth }));
const cardBox = async (page: Page, n: number) =>
	(await page.getByRole('button', { name: new RegExp(`^Scene ${n}, `) }).boundingBox())!;

/** A long clip, a very short photo, and another clip: 12 s + 0.5 s + 4 s. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['long.mp4', 'yellow.jpg', 'red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
	await page.evaluate(() => {
		const s = (window as unknown as {
			__scenes: { project: { scenes: { id: string }[] }; setSceneLength(id: string, l: number): void };
		}).__scenes;
		s.setSceneLength(s.project.scenes[1].id, 0.5);
	});
	await expect(page.getByRole('button', { name: /^Scene 2, .*0\.5s/ })).toBeVisible();
}

test.describe('Storyboard zoom', () => {
	test('short scenes stay clickable, with their name in a tooltip, and stay lined up with the ruler', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1024, height: 768 });
		await setup(page);
		const short = await cardBox(page, 2);
		expect(short.width).toBeGreaterThanOrEqual(36);
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toHaveAttribute('title', /yellow/i);
		await page.getByRole('button', { name: /^Scene 2, / }).click();
		await expect(page.getByRole('complementary', { name: 'Settings' }).getByRole('heading', { level: 2 })).toHaveText(
			'Scene 2'
		);
		// The playhead sits at the start of scene 3 when the time is scene 3's start.
		await seekTo(page, 12.5);
		const playhead = (await page.locator('.storyboard .playhead').boundingBox())!;
		const third = await cardBox(page, 3);
		expect(Math.abs(playhead.x + playhead.width / 2 - third.x)).toBeLessThan(8);
		// Fit shows the whole video, without scrolling.
		const s = await scroll(page);
		expect(s.width).toBeLessThanOrEqual(s.client + 1);
	});

	test('the slider and Ctrl/Cmd + scroll zoom; Fit shows the whole video again', async ({ page }) => {
		await setup(page);
		const slot = () => page.locator('.card-slot').first().boundingBox().then((b) => b!);
		const before = await cardBox(page, 1);
		/** The slot once its width animation has finished. */
		const settledSlot = async () => {
			let last = -1;
			await expect
				.poll(async () => {
					const w = (await slot()).width;
					const same = Math.abs(w - last) < 0.01;
					last = w;
					return same;
				}, { intervals: [60] })
				.toBe(true);
			return slot();
		};
		const slider = page.getByRole('slider', { name: 'Storyboard zoom' });
		await slider.fill('0.6');
		await expect.poll(async () => (await cardBox(page, 1)).width).toBeGreaterThan(before.width * 2);
		const zoomed = await scroll(page);
		expect(zoomed.width).toBeGreaterThan(zoomed.client);

		// Fit.
		await page.getByRole('button', { name: 'Fit' }).click();
		await expect.poll(async () => (await cardBox(page, 1)).width).toBeCloseTo(before.width, 0);
		expect((await scroll(page)).left).toBe(0);

		// Ctrl/Cmd + scroll zooms around the mouse: the time under it stays put.
		// The first scene's slot (its card plus the gap after it) spans exactly its time. Its width
		// animates, so wait until it's settled.
		const first = await settledSlot();
		const mouseX = first.x + first.width * 0.75; // 9 s into the long clip
		await page.mouse.move(mouseX, first.y + first.height / 2);
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.down(mod);
		for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
		await page.keyboard.up(mod);
		await expect.poll(async () => (await slot()).width).toBeGreaterThan(first.width * 1.5);
		// 75% through the first scene is still under the mouse (once the last wheel step settles).
		await expect
			.poll(async () => {
				const after = await slot();
				return Math.abs(after.x + after.width * 0.75 - mouseX);
			})
			.toBeLessThan(6);
		expect(Number(await slider.inputValue())).toBeGreaterThan(0);
		// The page itself didn't zoom.
		expect(await page.evaluate(() => visualViewport?.scale ?? 1)).toBe(1);
		expect(await scenes(page, (s) => s.duration)).toBeCloseTo(16.5, 1);
	});
});
