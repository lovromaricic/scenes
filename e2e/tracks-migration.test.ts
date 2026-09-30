import { expect, test, type Page } from '@playwright/test';
import { fixture, importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

type RGB = [number, number, number];

type Api = {
	media: Record<string, { id: string; name: string }>;
	placed: { scene: { id: string }; start: number; end: number }[];
	project: {
		id: string;
		tracks: { id: string; kind: string; name: string }[];
		overlays: { id: string; trackId: string; start: number }[];
		texts: { id: string; trackId: string; start: number; text: string }[];
		sounds: { id: string; trackId: string; start: number }[];
	};
	player: { readPixel(x: number, y: number): number[]; isFrameReady(): boolean; audioClips(): object[] };
	addOverlayFromMedia(id: string, start?: number, trackId?: string): string;
	addCardOverlay(start?: number, trackId?: string): string;
	setOverlayBox(id: string, box: object): void;
	addTrack(kind: 'overlay' | 'audio', index?: number): string;
	addText(kind: 'title' | 'caption'): void;
	freeze(): void;
	flushSave(): Promise<void>;
};

/** The preview's colours at a few points, once every frame is decoded. */
async function pixels(page: Page): Promise<RGB[]> {
	await expect.poll(() => scenes(page, (s) => s.player.isFrameReady()), { timeout: 10_000 }).toBe(true);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	return page.evaluate(() => {
		const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
		const s = (window as unknown as { __scenes: Api }).__scenes;
		const points = [
			[0.1, 0.1],
			[0.75, 0.25],
			[0.5, 0.5],
			[0.25, 0.75],
			[0.9, 0.9]
		];
		return points.map(([fx, fy]) => {
			const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
			return [p[0], p[1], p[2]] as RGB;
		});
	});
}

const TIMES = [0.5, 1.5, 4.5, 6.2];

async function snapshot(page: Page) {
	const shots: RGB[][] = [];
	for (const t of TIMES) {
		await seekTo(page, t);
		shots.push(await pixels(page));
	}
	const audio = await scenes(page, (s) => (s as unknown as Api).player.audioClips());
	return { shots, audio };
}

test('a project from before tracks opens looking and sounding exactly as before', async ({ page }) => {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'yellow.jpg', 'blue.webm', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 4, / })).toBeVisible();
	for (let i = 0; i < 2; i++) {
		await page.getByRole('button', { name: /^Scene 3, / }).click();
		await page.keyboard.press('Delete');
	}
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toHaveCount(0);

	// Two overlay tracks (a picture-in-picture video below, a card above), a title, two songs.
	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: Api }).__scenes;
		const id = (name: string) => Object.values(s.media).find((m) => m.name === name)!.id;
		const lower = s.project.tracks.find((t) => t.kind === 'overlay')!.id;
		const a = s.addOverlayFromMedia(id('blue.webm'), 1, lower);
		s.setOverlayBox(a, { x: 0.55, y: 0.1, w: 0.4, h: 0.4 });
		const upper = s.addTrack('overlay', 0);
		const b = s.addCardOverlay(4.2, upper);
		s.setOverlayBox(b, { x: 0.05, y: 0.55, w: 0.4, h: 0.4 });
	});
	await seekTo(page, 1);
	await page.getByRole('button', { name: /^Words/ }).click();
	await page.getByRole('button', { name: /^Title/ }).click();
	await page.keyboard.type('Old times');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	for (const t of [0, 2]) {
		await seekTo(page, t);
		await page.getByRole('button', { name: /^Sound Music/ }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: /^Music Add a song/ }).click();
		await (await chooser).setFiles(fixture('music.m4a'));
		await expect(page.locator('.item-slot.sound')).toHaveCount(t ? 2 : 1);
		await page.keyboard.press('Escape');
	}
	await expect.poll(() => scenes(page, (s) => (s as unknown as Api).project.sounds.length)).toBe(2);
	await expect(page.getByRole('group', { name: 'Audio 2', exact: true })).toBeVisible();

	const before = await snapshot(page);
	const shape = await scenes(page, (s) => {
		const p = (s as unknown as Api).project;
		return {
			overlays: p.overlays.map((o) => o.start),
			texts: p.texts.map((t) => t.start),
			sounds: p.sounds.map((o) => o.start)
		};
	});

	// Rewrite the stored project the way it was saved before tracks: Layers rows, overlays linked
	// to a scene with an offset, text without a track, sound rows.
	await page.evaluate(async () => {
		const s = (window as unknown as { __scenes: Api }).__scenes;
		await s.flushSave();
		s.freeze();
		const id = s.project.id;
		for (const key of Object.keys(localStorage)) if (key.includes(id)) localStorage.removeItem(key);
		const db: IDBDatabase = await new Promise((resolve, reject) => {
			const r = indexedDB.open('scenes');
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		const store = () => db.transaction('projects', 'readwrite').objectStore('projects');
		const record = await new Promise<Record<string, unknown> & Api['project']>((resolve) => {
			const r = store().get(id);
			r.onsuccess = () => resolve(r.result);
		});
		const overlayTracks = record.tracks.filter((t) => t.kind === 'overlay').reverse(); // bottom-up
		const audioTracks = record.tracks.filter((t) => t.kind === 'audio');
		const legacy = {
			...record,
			savedAt: Date.now() + 60_000,
			overlays: record.overlays.map((o) => {
				const { trackId, start, ...rest } = o;
				const link = s.placed.find((p) => start >= p.start && start < p.end) ?? s.placed[0];
				return {
					...rest,
					sceneId: link.scene.id,
					offset: start - link.start,
					row: overlayTracks.findIndex((t) => t.id === trackId)
				};
			}),
			texts: record.texts.map(({ trackId: _, ...rest }) => rest),
			sounds: record.sounds.map(({ trackId, ...rest }) => ({
				...rest,
				row: audioTracks.findIndex((t) => t.id === trackId)
			}))
		} as Record<string, unknown>;
		delete legacy.tracks;
		await new Promise((resolve) => (store().put(legacy).onsuccess = resolve));
	});
	await page.reload();
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();

	// Tracks: Text on top, the Layers rows in the same stacking, Scenes, then the Sound rows.
	await expect
		.poll(() => scenes(page, (s) => (s as unknown as Api).project.tracks.map((t) => t.name)))
		.toEqual(['Text', 'Overlay 2', 'Overlay 1', 'Scenes', 'Audio 1', 'Audio 2']);
	const after = await scenes(page, (s) => {
		const p = (s as unknown as Api).project;
		return {
			overlays: p.overlays.map((o) => o.start),
			texts: p.texts.map((t) => t.start),
			sounds: p.sounds.map((o) => o.start)
		};
	});
	for (const key of ['overlays', 'texts', 'sounds'] as const) {
		after[key].forEach((v, i) => expect(v).toBeCloseTo(shape[key][i], 6));
	}
	const again = await snapshot(page);
	expect(again.audio).toEqual(before.audio);
	again.shots.forEach((shot, i) =>
		shot.forEach((px, j) => px.forEach((v, k) => expect(Math.abs(v - before.shots[i][j][k])).toBeLessThanOrEqual(6)))
	);
});
