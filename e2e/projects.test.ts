import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, importViaPicker, openNewVideo, scenes } from './helpers';

/** Read a whole object store from the app's database. */
function readStore(page: Page, store: string) {
	return page.evaluate(
		(store) =>
			new Promise<unknown[]>((resolve, reject) => {
				const r = indexedDB.open('scenes');
				r.onsuccess = () => {
					const req = r.result.transaction(store).objectStore(store).getAll();
					req.onsuccess = () => {
						r.result.close();
						resolve(req.result);
					};
					req.onerror = () => reject(req.error);
				};
			}),
		store
	);
}

/**
 * The database as the previous version of Scenes left it (version 3, one project, media stored
 * without fingerprints).
 */
async function seedVersion3(page: Page) {
	await page.goto('/robots.txt');
	const video = readFileSync(fixture('red.mp4')).toString('base64');
	await page.evaluate(async (video) => {
		const bytes = Uint8Array.from(atob(video), (c) => c.charCodeAt(0));
		const blob = new Blob([bytes], { type: 'video/mp4' });
		await new Promise<void>((resolve, reject) => {
			const r = indexedDB.open('scenes', 3);
			r.onupgradeneeded = () => {
				const d = r.result;
				d.createObjectStore('media', { keyPath: 'id' });
				d.createObjectStore('thumbnails', { keyPath: 'id' });
				d.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
				d.createObjectStore('waveforms', { keyPath: 'id' });
				d.createObjectStore('fonts', { keyPath: 'id' });
			};
			r.onerror = () => reject(r.error);
			r.onsuccess = () => {
				const d = r.result;
				const tx = d.transaction(['media', 'projects'], 'readwrite');
				tx.objectStore('media').put({
					id: 'old-media',
					name: 'red.mp4',
					kind: 'video',
					mime: 'video/mp4',
					size: blob.size,
					duration: 4,
					startTime: 0,
					width: 640,
					height: 360,
					hasAudio: true,
					fps: 30,
					createdAt: 1,
					blob
				});
				tx.objectStore('projects').put({
					id: 'old-project',
					title: 'My video',
					format: { width: 1280, height: 720, fps: 30 },
					formatSet: true,
					mood: 'natural',
					scenes: [
						{
							id: 'old-scene',
							mediaId: 'old-media',
							kind: 'video',
							name: 'red',
							sourceStart: 0,
							sourceEnd: 4,
							speed: 1,
							volume: 1,
							mood: 'golden',
							transition: { kind: 'cut', duration: 0 },
							frame: { mode: 'fill', bars: 'black', zoom: 1, x: 0, y: 0 }
						}
					],
					texts: [
						{
							id: 'old-text',
							text: 'Still here',
							start: 0,
							duration: 3,
							x: 0.5,
							y: 0.85,
							style: 'boxed',
							animation: 'fade'
						}
					],
					sounds: [],
					library: ['old-media'],
					createdAt: 1_700_000_000_000,
					updatedAt: 1_700_000_000_000,
					savedAt: 1_700_000_000_000
				});
				tx.oncomplete = () => {
					d.close();
					resolve();
				};
			};
		});
	}, video);
}

test.describe('Projects', () => {
	test('the project from before is kept, unchanged, as "My video"', async ({ page }) => {
		await seedVersion3(page);
		await page.goto('/');
		// It's the one project on the home screen, and opens as it was.
		const card = page.getByRole('article', { name: 'My video' });
		await expect(card).toContainText('0:04 · 1280 × 720');
		await expect(card).toContainText('Edited 14 Nov 2023');
		await card.getByRole('link', { name: 'My video' }).click();
		await expect(page).toHaveURL(/\/edit\/old-project$/);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('My video');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Words: Still here' }).first()).toBeVisible();
		const project = await scenes(page, (s) =>
			JSON.parse(JSON.stringify((s as unknown as { project: object }).project))
		);
		expect(project).toMatchObject({
			id: 'old-project',
			title: 'My video',
			scenes: [{ id: 'old-scene', mediaId: 'old-media', mood: 'golden' }],
			library: ['old-media']
		});
		// The old file gets its fingerprint in the background, so importing it again reuses it.
		await expect
			.poll(async () => ((await readStore(page, 'media')) as { hash?: string }[])[0]?.hash)
			.toMatch(/^[0-9a-f]{64}$/);
		await page.getByRole('button', { name: /^Clips/ }).click();
		await importViaPicker(page, ['red.mp4'], 'Choose files');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		expect(await readStore(page, 'media')).toHaveLength(1);
		// Storage persistence was asked for once, and the answer recorded.
		const settings = (await readStore(page, 'settings')) as { key: string }[];
		expect(settings.map((s) => s.key).sort()).toEqual(['persistAsked', 'persisted']);
	});

	test('the same file imported twice is stored once', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'yellow.jpg'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('button', { name: /^Clips/ }).click();
		await importViaPicker(page, ['red.mp4'], 'Choose files');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		const project = await scenes(page, (s) =>
			JSON.parse(JSON.stringify((s as unknown as { project: object }).project))
		) as { scenes: { mediaId: string }[]; library: string[] };
		expect(project.scenes[2].mediaId).toBe(project.scenes[0].mediaId);
		expect(project.library).toHaveLength(2);
		expect(await readStore(page, 'media')).toHaveLength(2);
	});

	test('first launch shows an empty home; New video opens an empty editor', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Your videos' })).toBeVisible();
		await expect(page.getByText('Your videos will appear here.')).toBeVisible();
		await expect(page.getByRole('article')).toHaveCount(0);
		await expect(page.getByRole('region', { name: 'Storage' })).toContainText(
			/Your videos use .* on this device/
		);
		await page.getByRole('button', { name: /^New video/ }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Untitled video');
		await expect(page.getByText('Start with your photos & videos')).toBeVisible();
		// Leaving without adding anything doesn't keep an empty project.
		await page.getByRole('link', { name: 'Projects' }).click();
		await expect(page.getByText('Your videos will appear here.')).toBeVisible();
		await expect(page.getByRole('article')).toHaveCount(0);
	});

	test('create, switch, rename, duplicate and delete projects', async ({ page }) => {
		// Two projects: a red one and a yellow photo one.
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await page.getByRole('button', { name: 'Untitled video, rename' }).click();
		await page.getByRole('textbox', { name: 'Video title' }).fill('Red day');
		await page.keyboard.press('Enter');
		const redUrl = page.url().replace('?new=1', '');
		await page.getByRole('link', { name: 'Projects' }).click();

		await page.getByRole('button', { name: /^New video/ }).click();
		await importViaPicker(page, ['yellow.jpg', 'green.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('link', { name: 'Projects' }).click();

		// Newest first, each with its picture, length, format and when it was edited.
		const cards = page.getByRole('article');
		await expect(cards).toHaveCount(2);
		await expect(cards.nth(0)).toHaveAccessibleName('Untitled video');
		await expect(cards.nth(1)).toHaveAccessibleName('Red day');
		await expect(cards.nth(0)).toContainText('0:06 · 960 × 720');
		await expect(cards.nth(1)).toContainText('0:04 · 1280 × 720');
		await expect(cards.nth(1)).toContainText('Edited just now');
		await expect(cards.nth(0).locator('img')).toHaveCount(1);
		await expect(cards.nth(1).locator('img')).toHaveCount(1);
		// The thumbnail shows the first scene: yellow for the photo project.
		const src = await cards.nth(0).locator('img').getAttribute('src');
		const pixel = await page.evaluate(async (src) => {
			const bitmap = await createImageBitmap(await (await fetch(src!)).blob());
			const c = new OffscreenCanvas(bitmap.width, bitmap.height);
			const ctx = c.getContext('2d')!;
			ctx.drawImage(bitmap, 0, 0);
			return Array.from(ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data);
		}, src);
		expect(pixel[0]).toBeGreaterThan(200);
		expect(pixel[1]).toBeGreaterThan(180);
		expect(pixel[2]).toBeLessThan(90);

		// Switch: open Red day from its menu; it's as it was.
		await cards.nth(1).getByRole('button', { name: 'More for Red day' }).click();
		await page.getByRole('menuitem', { name: 'Open' }).click();
		await expect(page).toHaveURL(redUrl);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Red day');
		await expect(page.getByText('1 scene · 4 sec')).toBeVisible();
		await page.getByRole('link', { name: 'Projects' }).click();

		// Rename from the menu.
		await page.getByRole('button', { name: 'More for Untitled video' }).click();
		await page.getByRole('menuitem', { name: 'Rename' }).click();
		await page.getByRole('textbox', { name: 'Video name' }).fill('Picnic');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('article', { name: 'Picnic' })).toBeVisible();

		// Duplicate: a copy with the same scenes, listed first.
		await page.getByRole('button', { name: 'More for Picnic' }).click();
		await page.getByRole('menuitem', { name: 'Duplicate' }).click();
		await expect(cards).toHaveCount(3);
		await expect(cards.nth(0)).toHaveAccessibleName('Picnic (copy)');
		await expect(cards.nth(0)).toContainText('0:06 · 960 × 720');
		await cards.nth(0).getByRole('link', { name: 'Picnic (copy)' }).click();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('link', { name: 'Projects' }).click();

		// Delete asks first; Cancel keeps it.
		await page.getByRole('button', { name: 'More for Picnic', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		const confirm = page.getByRole('dialog', { name: 'Delete “Picnic”?' });
		await expect(confirm).toBeVisible();
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect(cards).toHaveCount(3);
		await page.getByRole('button', { name: 'More for Picnic', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await confirm.getByRole('button', { name: 'Delete' }).click();
		await expect(cards).toHaveCount(2);
		await expect(page.getByRole('article', { name: 'Picnic', exact: true })).toHaveCount(0);
		// The copy still has its clips (they're shared, so they weren't deleted with the original).
		expect(await readStore(page, 'media')).toHaveLength(3);
		await page.getByRole('article', { name: 'Picnic (copy)' }).getByRole('link').click();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('link', { name: 'Projects' }).click();

		// Deleting the last user of a file deletes the file too.
		await page.getByRole('button', { name: 'More for Picnic (copy)' }).click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		await expect(cards).toHaveCount(1);
		await expect.poll(async () => (await readStore(page, 'media')).length).toBe(1);
	});

	test('in the editor: rename by clicking the title; the video menu starts a new one or goes back', async ({
		page
	}) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await expect(page).toHaveTitle('Untitled video · Scenes');
		await page.getByRole('button', { name: 'Untitled video, rename' }).click();
		await page.getByRole('textbox', { name: 'Video title' }).fill('Summer trip');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Summer trip');
		await expect(page).toHaveTitle('Summer trip · Scenes');

		// The menu opens from the keyboard too, and Esc closes it back to its button.
		const menuButton = page.getByRole('button', { name: 'Video menu' });
		await menuButton.focus();
		await page.keyboard.press('Enter');
		const menu = page.getByRole('menu', { name: 'Video' });
		await expect(menu.getByRole('menuitem')).toHaveText(['New video', 'Back to projects']);
		await expect(menu.getByRole('menuitem', { name: 'New video' })).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByRole('menuitem', { name: 'Back to projects' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(menuButton).toBeFocused();
		// Space in the menu didn't start playback.
		expect(await scenes(page, (s) => s.playing)).toBe(false);

		// New video: an empty editor; the trip is kept.
		await menuButton.click();
		await page.getByRole('menuitem', { name: 'New video' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Untitled video');
		await expect(page.getByText('Start with your photos & videos')).toBeVisible();

		// Back to projects: only the trip (the new one is still empty, so it isn't kept).
		await page.getByRole('button', { name: 'Video menu' }).click();
		await page.getByRole('menuitem', { name: 'Back to projects' }).click();
		await expect(page.getByRole('heading', { name: 'Your videos' })).toBeVisible();
		await expect(page.getByRole('article')).toHaveCount(1);
		await expect(page.getByRole('article')).toHaveAccessibleName('Summer trip');
	});
});
