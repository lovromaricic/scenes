import { expect, test, type Page } from '@playwright/test';
import { BlobReader, TextWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fixture, importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

type Store = { project: Record<string, unknown> & { id: string; title: string; scenes: { id: string }[] } };
const project = (page: Page) =>
	scenes(page, (s) => JSON.parse(JSON.stringify((s as unknown as Store).project))) as Promise<
		Store['project']
	>;

function readStore(page: Page, store: string) {
	return page.evaluate(
		(store) =>
			new Promise<unknown[]>((resolve) => {
				const r = indexedDB.open('scenes');
				r.onsuccess = () => {
					const req = r.result.transaction(store).objectStore(store).getAll();
					req.onsuccess = () => {
						r.result.close();
						resolve(req.result);
					};
				};
			}),
		store
	);
}

/**
 * Chrome's file pickers open native dialogs, which tests can't click. Stand-ins return files in
 * the page's private storage (OPFS) instead, which behave like real file handles.
 */
async function stubFilePickers(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as Record<string, unknown>;
		const calls = { save: 0, open: 0 };
		w.__pickerCalls = calls;
		w.showSaveFilePicker = async (options: { suggestedName: string }) => {
			calls.save++;
			const root = await navigator.storage.getDirectory();
			return root.getFileHandle((w.__saveAs as string) ?? options.suggestedName, { create: true });
		};
		w.showOpenFilePicker = async () => {
			calls.open++;
			const root = await navigator.storage.getDirectory();
			return [await root.getFileHandle(w.__openName as string)];
		};
	});
}

const pickerCalls = (page: Page) =>
	page.evaluate(() => (window as unknown as { __pickerCalls: { save: number; open: number } }).__pickerCalls);

/** A file from the page's private storage, as bytes. */
async function opfsFile(page: Page, name: string): Promise<Buffer> {
	const base64 = await page.evaluate(async (name) => {
		const root = await navigator.storage.getDirectory();
		const file = await (await root.getFileHandle(name)).getFile();
		const bytes = new Uint8Array(await file.arrayBuffer());
		let s = '';
		for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		return btoa(s);
	}, name);
	return Buffer.from(base64, 'base64');
}

/** Drop a file (made of these bytes) onto the page. */
async function dropFile(page: Page, name: string, bytes: Buffer) {
	await page.evaluate(
		({ name, data }) => {
			const dt = new DataTransfer();
			dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name));
			for (const type of ['dragenter', 'dragover', 'drop']) {
				document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
			}
		},
		{ name, data: bytes.toString('base64') }
	);
}

/** A project with a bit of everything: clips, a crop, a card, styled words in an uploaded font, music. */
async function buildProject(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'yellow.jpg'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.getByRole('button', { name: 'Untitled video, rename' }).click();
	await page.getByRole('textbox', { name: 'Video title' }).fill('Summer trip');
	await page.keyboard.press('Enter');

	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: Record<string, (...a: unknown[]) => void> & { project: { scenes: { id: string }[] } } }).__scenes;
		s.enterCrop(s.project.scenes[0].id);
		s.setCropDraft({ x: 0, y: 0, w: 320, h: 180 });
		s.applyCrop();
		s.addCard(2);
		const card = s.project.scenes[2];
		s.setCard(card.id, { background: '#336699', rect: { x: 0.2, y: 0.3, w: 0.6, h: 0.4, color: '#ffe14d', radius: 0.2 } });
	});
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();

	// Words in an uploaded font, with custom colours.
	await seekTo(page, 1);
	await page.getByRole('button', { name: /^Words/ }).click();
	await page.getByRole('button', { name: /^Caption/ }).click();
	await page.keyboard.type('Best day');
	await page.keyboard.press('Enter');
	await page.getByRole('button', { name: 'Words: Best day' }).first().click();
	await page.getByRole('button', { name: /^Font:/ }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('dialog', { name: 'Choose a font' }).getByRole('button', { name: 'Upload font file' }).click();
	await (await chooser).setFiles(fixture('Pacifico-Regular.ttf'));
	await expect(page.getByRole('button', { name: /^Font: Pacifico/ })).toBeVisible();
	const textHex = page.getByRole('textbox', { name: 'Text color: hex code' });
	await textHex.fill('#00ff00');
	await textHex.press('Enter');

	// A layer: the red clip as picture-in-picture over the photo, styled, with its sound on.
	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: Record<string, (...a: unknown[]) => string> & { media: Record<string, { id: string; name: string }> } }).__scenes;
		const red = Object.values(s.media).find((m) => m.name === 'red.mp4')!.id;
		const layer = s.addOverlayFromMedia(red, 4.5);
		s.setOverlayStyle(layer, { radius: 0.5, borderColor: '#ffffff', borderWidth: 8, shadow: 'soft', opacity: 0.9 });
		s.setOverlaySound(layer, { on: true, volume: 0.7 });
	});
	await expect(page.locator('.item-slot.overlay')).toHaveCount(1);

	// Music.
	await page.getByRole('button', { name: /^Sound/ }).click();
	const music = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: /^Music/ }).click();
	await (await music).setFiles(fixture('music.m4a'));
	await expect(page.getByRole('button', { name: /^Music: / })).toBeVisible();
	await page.keyboard.press('Escape');
}

const status = (page: Page) => page.getByRole('banner').getByRole('status');

test.describe('Project files', () => {
	test.setTimeout(120_000);

	test('save to a file, delete from the app, open it again: the same project', async ({ page }, info) => {
		await stubFilePickers(page);
		await buildProject(page);

		// Save to file (first time: asks where).
		await page.evaluate(() => ((window as unknown as { __saveAs: string }).__saveAs = 'summer-trip.scenes'));
		await page.getByRole('button', { name: 'Video menu' }).click();
		await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
			/^\s*New video\s*$/,
			/Open project file… (⌘|Ctrl\+)O/,
			/Save to file (⌘|Ctrl\+)S/,
			/Save as… (⇧⌘|Ctrl\+Shift\+)S/,
			/Back to projects/
		]);
		await page.getByRole('menuitem', { name: 'Save to file' }).click();
		await expect(status(page)).toHaveText('Saved to summer-trip.scenes');
		expect((await pickerCalls(page)).save).toBe(1);

		// A change: the file is now behind. Ctrl/Cmd+S saves to the same file without asking.
		await page.getByRole('button', { name: /^Scene 2, / }).click();
		await page.getByRole('group', { name: 'Length' }).getByRole('button', { name: 'Longer' }).click();
		await expect(status(page)).toHaveText('Unsaved changes in file');
		await page.keyboard.press(`${mod}+s`);
		await expect(status(page)).toHaveText('Saved to summer-trip.scenes');
		expect((await pickerCalls(page)).save).toBe(1);
		// Undoing back past the save makes it differ again.
		await page.keyboard.press(`${mod}+z`);
		await expect(status(page)).toHaveText('Unsaved changes in file');
		await page.keyboard.press(`${mod}+Shift+z`);
		await expect(status(page)).toHaveText('Saved to summer-trip.scenes');

		const before = await project(page);
		const mediaBefore = await readStore(page, 'media');

		// What's in the file.
		const bytes = await opfsFile(page, 'summer-trip.scenes');
		writeFileSync(info.outputPath('summer-trip.scenes'), bytes);
		const entries = await new ZipReader(new BlobReader(new Blob([bytes]))).getEntries();
		const names = entries.map((e) => e.filename);
		expect(names.slice(0, 3)).toEqual(['manifest.json', 'project.json', 'thumbnail.jpg']);
		expect(names.filter((n) => n.startsWith('media/'))).toHaveLength(3); // red, yellow, music
		expect(names.filter((n) => n.startsWith('fonts/'))).toHaveLength(1);
		for (const e of entries.filter((e) => e.filename.startsWith('media/'))) {
			expect(e.compressionMethod).toBe(0);
		}
		const manifest = JSON.parse(await (entries[0] as FileEntry).getData(new TextWriter()));
		expect(manifest).toMatchObject({ app: 'Scenes', formatVersion: 2, name: 'Summer trip' });

		// Delete it from the app: its media and fonts go too.
		await page.getByRole('link', { name: 'Projects' }).click();
		await page.getByRole('button', { name: 'More for Summer trip' }).click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		await expect(page.getByRole('article')).toHaveCount(0);
		await expect.poll(async () => (await readStore(page, 'media')).length).toBe(0);
		expect(await readStore(page, 'fonts')).toHaveLength(0);

		// Open it again from the home screen.
		await page.evaluate(() => ((window as unknown as { __openName: string }).__openName = 'summer-trip.scenes'));
		await page.getByRole('button', { name: 'Open project file' }).click();
		await expect(page).toHaveURL(new RegExp(`/edit/${before.id}\\?opened=`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Summer trip');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		expect(await project(page)).toEqual(before);
		const mediaAfter = (await readStore(page, 'media')) as { id: string; size: number }[];
		expect(mediaAfter.map((m) => [m.id, m.size]).sort()).toEqual(
			(mediaBefore as { id: string; size: number }[]).map((m) => [m.id, m.size]).sort()
		);
		expect(await readStore(page, 'fonts')).toHaveLength(1);
		// It still knows its file.
		await expect(status(page)).toHaveText('Saved to summer-trip.scenes');
		// Words render in Pacifico, music is there, the card and crop too.
		await expect(page.getByRole('button', { name: 'Font missing' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Music: / })).toBeVisible();
		const card = (before.scenes as { card?: unknown }[])[2].card;
		expect(card).toMatchObject({ background: '#336699' });
		expect((before.scenes as { crop?: unknown }[])[0].crop).toEqual({ x: 0, y: 0, w: 320, h: 180 });
		// And it plays: the card's colour shows at its time.
		await seekTo(page, 9);
		await expect
			.poll(() =>
				scenes(page, (s) => {
					const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
					return s.player.readPixel(Math.floor(c.width * 0.05), Math.floor(c.height * 0.05));
				})
			)
			.toEqual([51, 102, 153, 255]);

		// Opening it again while it's in the app: keep both…
		await page.keyboard.press(`${mod}+o`);
		const conflict = page.getByRole('dialog', { name: '“Summer trip” is already here' });
		await expect(conflict).toBeVisible();
		await conflict.getByRole('button', { name: 'Keep both' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Summer trip (copy)');
		const copy = await project(page);
		expect(copy.id).not.toBe(before.id);
		expect(copy.scenes).toEqual(before.scenes);
		// …or replace the one in the app (after changing it).
		await page.getByRole('link', { name: 'Projects' }).click();
		await expect(page.getByRole('article')).toHaveCount(2);
		await page.getByRole('article', { name: 'Summer trip', exact: true }).getByRole('link').click();
		await page.getByRole('button', { name: 'Summer trip, rename' }).click();
		await page.getByRole('textbox', { name: 'Video title' }).fill('Changed');
		await page.keyboard.press('Enter');
		await page.keyboard.press(`${mod}+o`);
		await conflict.getByRole('button', { name: 'Replace the one in the app' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Summer trip');
		await page.getByRole('link', { name: 'Projects' }).click();
		await expect(page.getByRole('article')).toHaveCount(2);
		await expect(page.getByRole('article', { name: 'Changed' })).toHaveCount(0);
	});

	test('a damaged file or one that isn’t a project shows a clear message', async ({ page }) => {
		await page.goto('/');
		await dropFile(page, 'notes.scenes', readFileSync(fixture('notes.txt')));
		const alert = page.getByRole('dialog', { name: 'Couldn’t open “notes.scenes”' });
		await expect(alert).toContainText('This file isn’t a Scenes project');
		await alert.getByRole('button', { name: 'OK' }).click();
		await expect(alert).toHaveCount(0);

		// A real project file, cut short (like an interrupted copy).
		await stubFilePickers(page);
		await buildSmallProject(page);
		await page.evaluate(() => ((window as unknown as { __saveAs: string }).__saveAs = 'trip.scenes'));
		await page.keyboard.press(`${mod}+s`);
		await expect(status(page)).toHaveText('Saved to trip.scenes');
		const bytes = await opfsFile(page, 'trip.scenes');
		await dropFile(page, 'trip.scenes', bytes.subarray(0, bytes.length - 2000));
		const damaged = page.getByRole('dialog', { name: 'Couldn’t open “trip.scenes”' });
		await expect(damaged).toContainText('This project file is damaged');
		await damaged.getByRole('button', { name: 'OK' }).click();
		// The project in the editor is untouched.
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	});

	test('without file pickers (other browsers) the file downloads and opens from the file chooser', async ({
		page
	}, info) => {
		await page.addInitScript(() => {
			const w = window as unknown as Record<string, unknown>;
			w.showSaveFilePicker = undefined;
			w.showOpenFilePicker = undefined;
		});
		await buildSmallProject(page);
		const before = await project(page);
		await page.getByRole('link', { name: 'Projects' }).click();

		// Save to file from the home screen's card menu.
		const download = page.waitForEvent('download');
		await page.getByRole('button', { name: 'More for Trip' }).click();
		await page.getByRole('menuitem', { name: 'Save to file' }).click();
		const file = info.outputPath('Trip.scenes');
		const saved = await download;
		expect(saved.suggestedFilename()).toBe('Trip.scenes');
		await saved.saveAs(file);

		await page.getByRole('button', { name: 'More for Trip' }).click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		await expect(page.getByRole('article')).toHaveCount(0);

		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: 'Open project file' }).click();
		await (await chooser).setFiles(file);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trip');
		expect(await project(page)).toEqual(before);
		await expect(status(page)).toHaveText('Saved to Trip.scenes');
	});
});

async function buildSmallProject(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await page.getByRole('button', { name: 'Untitled video, rename' }).click();
	await page.getByRole('textbox', { name: 'Video title' }).fill('Trip');
	await page.keyboard.press('Enter');
}
