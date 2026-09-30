import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, importViaPicker, scenes } from './helpers';

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
		await page.goto('/');
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
});
