import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

const settings = (page: Page) => page.getByRole('complementary', { name: 'Settings' });

async function chooseFit(page: Page) {
	await settings(page).getByRole('radiogroup', { name: 'Frame' }).getByRole('radio', { name: 'Fit' }).click();
}

test.describe('Labels match the media', () => {
	test('a video scene says "Video" and "Around the video"; a photo scene "Picture" and "Around the picture"', async ({
		page
	}) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'yellow.jpg'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();

		// The video scene.
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await expect(settings(page).getByText('Video', { exact: true })).toBeVisible();
		await expect(settings(page).getByText('Picture', { exact: true })).toHaveCount(0);
		await chooseFit(page);
		await expect(settings(page).getByText('Around the video', { exact: true })).toBeVisible();
		await expect(settings(page).getByText('Around the picture')).toHaveCount(0);
		await expect(settings(page).getByRole('radio', { name: 'Fit' })).toHaveAccessibleDescription(/whole video/);
		await expect(settings(page).getByRole('slider', { name: 'Video sound volume' })).toBeVisible();
		// Custom: the tip and the reframe handle on the preview.
		await settings(page).getByRole('radio', { name: 'Custom' }).click();
		await expect(settings(page).getByText('Drag the video to move it. Scroll over it to zoom.')).toBeVisible();
		await expect(page.getByRole('button', { name: /^Reframe: drag to move the video/ })).toBeAttached();
		// Crop mode.
		await page.keyboard.press('c');
		await expect(page.getByText('Drag the box on the video,')).toBeVisible();
		await page.keyboard.press('Escape');
		// Wording about the whole video's frame stays as it is.
		await settings(page).getByRole('radio', { name: 'Fill' }).click();
		await expect(settings(page).getByText('Same shape as the video')).toBeVisible();

		// The photo scene.
		await page.getByRole('button', { name: /^Scene 2, / }).click();
		await expect(settings(page).getByRole('heading', { name: 'Scene 2' })).toBeVisible();
		await expect(settings(page).getByText('Picture', { exact: true })).toBeVisible();
		await expect(settings(page).getByText('Video', { exact: true })).toHaveCount(0);
		await chooseFit(page);
		await expect(settings(page).getByText('Around the picture', { exact: true })).toBeVisible();
		await expect(settings(page).getByText('Around the video')).toHaveCount(0);
		await expect(settings(page).getByRole('radio', { name: 'Fit' })).toHaveAccessibleDescription(/whole picture/);
		await expect(settings(page).getByRole('slider', { name: 'Video sound volume' })).toHaveCount(0);
		await settings(page).getByRole('radio', { name: 'Custom' }).click();
		await expect(settings(page).getByText('Drag the picture to move it. Scroll over it to zoom.')).toBeVisible();
		await expect(page.getByRole('button', { name: /^Reframe: drag to move the picture/ })).toBeAttached();
		await page.keyboard.press('c');
		await expect(page.getByText('Drag the box on the picture,')).toBeVisible();
		await page.keyboard.press('Escape');
	});

	test('layers: a video layer offers its video’s sound and crops "the video"; a photo layer "the picture"', async ({
		page
	}) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'green.mp4', 'yellow.jpg'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		const [video, photo] = await page.evaluate(() => {
			const s = (window as unknown as {
				__scenes: { media: Record<string, { id: string; name: string }>; addOverlayFromMedia(id: string, start: number): string };
			}).__scenes;
			const id = (n: string) => Object.values(s.media).find((m) => m.name === n)!.id;
			return [s.addOverlayFromMedia(id('green.mp4'), 0), s.addOverlayFromMedia(id('yellow.jpg'), 0)];
		});
		await page.locator(`[data-item-id="${video}"] .item`).click();
		await expect(settings(page).getByRole('switch', { name: /Play the video’s sound/ })).toBeVisible();
		await settings(page).getByRole('button', { name: 'Crop', exact: true }).click();
		await expect(page.getByText('Drag the box on the video,')).toBeVisible();
		await page.keyboard.press('Escape');

		await page.locator(`[data-item-id="${photo}"] .item`).click();
		await expect(settings(page).getByRole('switch', { name: /sound/ })).toHaveCount(0);
		await settings(page).getByRole('button', { name: 'Crop', exact: true }).click();
		await expect(page.getByText('Drag the box on the picture,')).toBeVisible();
		await page.keyboard.press('Escape');
	});
});
