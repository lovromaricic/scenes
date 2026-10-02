import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

type RGB = [number, number, number];
const near = (a: RGB, b: RGB, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

type Api = {
	media: Record<string, { id: string; name: string }>;
	project: { tracks: { id: string; name: string; kind: string }[]; scenes: { id: string }[] };
	player: { readPixel(x: number, y: number): number[]; isFrameReady(): boolean };
	addTrack(kind: 'overlay' | 'audio', index?: number, name?: string): string;
	addCardOverlay(start?: number, trackId?: string): string | null;
	addOverlayFromMedia(id: string, start?: number, trackId?: string): string | null;
	setOverlayBox(id: string, box: object): void;
	setOverlayCard(id: string, card: object): void;
	setOverlayTiming(id: string, start: number, duration: number): void;
	setOverlaySound(id: string, sound: object): void;
	setSceneVolume(id: string, v: number): void;
	setTrackFlag(id: string, flag: string, on: boolean): void;
	moveItems(ids: string[], delta: number, trackId?: string): void;
	duplicateTrack(id: string): void;
	deselect(): void;
};

async function previewPixel(page: Page, fx: number, fy: number): Promise<RGB> {
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { __scenes: Api }).__scenes.player.isFrameReady()), { timeout: 10_000 })
		.toBe(true);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	return page.evaluate(
		({ fx, fy }) => {
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const s = (window as unknown as { __scenes: Api }).__scenes;
			const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
			return [p[0], p[1], p[2]] as RGB;
		},
		{ fx, fy }
	);
}

const RED: RGB = [255, 0, 0];
const GREEN: RGB = [0, 255, 0];
const BLUE: RGB = [0, 0, 255];
const YELLOW: RGB = [255, 255, 0];

/**
 * Scenes red (0–4 s, 440 Hz) and green (4–7 s, 660 Hz). Overlay tracks, bottom to top:
 * - "Low": a blue card on the left half;
 * - "High": a yellow card in the middle, over the blue one where they meet;
 * - "Hidden" (hidden): a magenta full-frame card;
 * - "Hidden video" (hidden): the blue video (880 Hz) with its sound on.
 * Both scenes are silent except red; nothing hidden may show or sound.
 */
async function build(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
	await page.getByRole('button', { name: /^Scene 3, / }).click();
	await page.keyboard.press('Delete');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toHaveCount(0);
	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: Api }).__scenes;
		const low = s.project.tracks.find((t) => t.kind === 'overlay')!.id;
		const high = s.addTrack('overlay', 0, 'High');
		const hidden = s.addTrack('overlay', 0, 'Hidden');
		const card = (track: string, color: string, box: object) => {
			const c = s.addCardOverlay(0, track)!;
			s.setOverlayCard(c, { background: color, rect: null });
			s.setOverlayBox(c, box);
			s.setOverlayTiming(c, 0, 7);
			return c;
		};
		card(low, '#0000ff', { x: 0, y: 0, w: 0.5, h: 1 });
		card(high, '#ffff00', { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
		card(hidden, '#ff00ff', { x: 0, y: 0, w: 1, h: 1 });
		const hiddenVideo = s.addTrack('overlay', 0, 'Hidden video');
		const blue = Object.values(s.media).find((m) => m.name === 'blue.webm')!.id;
		const v = s.addOverlayFromMedia(blue, 0, hiddenVideo)!;
		s.setOverlaySound(v, { on: true, volume: 1 });
		s.setTrackFlag(hidden, 'hidden', true);
		s.setTrackFlag(hiddenVideo, 'hidden', true);
		s.deselect();
	});
}

/** [time, x, y, expected] */
const CHECKS: [number, number, number, RGB][] = [
	[1.5, 0.1, 0.5, BLUE], // the low card
	[1.5, 0.4, 0.5, YELLOW], // the high card over the low one
	[1.5, 0.6, 0.5, YELLOW], // the high card over the scene
	[1.5, 0.9, 0.5, RED], // the scene; the hidden card doesn't show
	[5.5, 0.9, 0.2, GREEN] // the second scene
];

test.describe('Rendering tracks', () => {
	test.setTimeout(180_000);

	test('preview, Watch, the home picture and the saved MP4 draw tracks in order and skip hidden ones', async ({ page }, info) => {
		await build(page);
		const preview: RGB[] = [];
		for (const [t, x, y, want] of CHECKS) {
			await seekTo(page, t);
			const got = await previewPixel(page, x, y);
			expect(near(got, want, 30), `preview at ${t}s (${x}, ${y}): ${got}`).toBe(true);
			preview.push(got);
		}

		// Watch shows the same.
		await seekTo(page, 1.5);
		await page.getByRole('button', { name: 'Watch' }).click();
		await expect(page.getByRole('dialog', { name: /^Watch/ })).toBeVisible();
		await page.keyboard.press('Space');
		await page.evaluate(() => (window as unknown as { __scenes: { seek(t: number): void } }).__scenes.seek(1.5));
		const watchPixel = (fx: number, fy: number) =>
			page.evaluate(
				({ fx, fy }) => {
					const c = document.querySelector('[role="dialog"] canvas') as HTMLCanvasElement;
					const s = (window as unknown as { __scenes: Api }).__scenes;
					const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
					return [p[0], p[1], p[2]] as RGB;
				},
				{ fx, fy }
			);
		for (const [t, x, y, want] of CHECKS.filter((c) => c[0] === 1.5)) {
			await expect.poll(async () => near(await watchPixel(x, y), want, 30), `Watch at ${t}s (${x}, ${y})`).toBe(true);
		}
		await page.getByRole('button', { name: 'Back to editing' }).click();

		// Saved MP4: the same pixels, and the hidden video's sound isn't in it.
		if (hasFfmpeg) {
			await page.getByRole('button', { name: 'Save video' }).click();
			const download = page.waitForEvent('download', { timeout: 120_000 });
			await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
			const file = info.outputPath('tracks.mp4');
			await (await download).saveAs(file);
			const [width, height] = execFileSync('ffprobe', [
				'-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file
			])
				.toString()
				.trim()
				.split(',')
				.map(Number);
			for (const [i, [t, x, y, want]] of CHECKS.entries()) {
				const px = Math.floor(width * x) - 2;
				const py = Math.floor(height * y) - 2;
				const raw = execFileSync('ffmpeg', [
					'-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1',
					'-vf', `crop=4:4:${px}:${py}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
				]);
				const got = [0, 1, 2].map((c) => {
					let sum = 0;
					for (let k = 0; k < 16; k++) sum += raw[k * 3 + c];
					return Math.round(sum / 16);
				}) as RGB;
				expect(near(got, want, 40), `saved at ${t}s (${x}, ${y}): ${got}`).toBe(true);
				expect(near(got, preview[i], 30), `saved ${got} vs preview ${preview[i]}`).toBe(true);
			}
			const tone = (from: number, hz: number) => {
				const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', '1', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
				const n = pcm.length / 2;
				let re = 0;
				let im = 0;
				for (let k = 0; k < n; k++) {
					const v = pcm.readInt16LE(k * 2) / 32768;
					re += v * Math.cos((2 * Math.PI * hz * k) / 8000);
					im += v * Math.sin((2 * Math.PI * hz * k) / 8000);
				}
				return (2 * Math.hypot(re, im)) / n;
			};
			expect(tone(1, 440)).toBeGreaterThan(0.05); // the red scene's own sound
			expect(tone(1, 880)).toBeLessThan(0.01); // the hidden video's sound isn't there
			await page.keyboard.press('Escape');
		}

		// The home picture (the start of the video) shows the tracks in order too.
		await page.getByRole('link', { name: 'Projects' }).click();
		const img = page.locator('img[src]').first();
		await expect(img).toBeVisible();
		const thumb = (fx: number, fy: number) =>
			img.evaluate(
				(el: HTMLImageElement, { fx, fy }) => {
					const c = document.createElement('canvas');
					c.width = el.naturalWidth;
					c.height = el.naturalHeight;
					const ctx = c.getContext('2d')!;
					ctx.drawImage(el, 0, 0);
					const d = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
					return [d[0], d[1], d[2]] as RGB;
				},
				{ fx, fy }
			);
		await expect.poll(async () => near(await thumb(0.1, 0.5), BLUE, 40)).toBe(true);
		expect(near(await thumb(0.4, 0.5), YELLOW, 40)).toBe(true);
		expect(near(await thumb(0.9, 0.5), RED, 40)).toBe(true);
	});

	test('at most four videos play on top at once, however they get there', async ({ page }) => {
		await build(page);
		const green = await page.evaluate(() => Object.values((window as unknown as { __scenes: Api }).__scenes.media).find((m) => m.name === 'green.mp4')!.id);
		// Three more videos at 0 s (the hidden one counts too, so showing it again can't go over).
		const ids = await page.evaluate((green) => {
			const s = (window as unknown as { __scenes: Api }).__scenes;
			return [s.addOverlayFromMedia(green, 0), s.addOverlayFromMedia(green, 0), s.addOverlayFromMedia(green, 0)];
		}, green);
		expect(ids.every(Boolean)).toBe(true);
		const count = () =>
			page.evaluate(() => (window as unknown as { __scenes: { project: { overlays: { kind: string }[] } } }).__scenes.project.overlays.filter((o) => o.kind === 'video').length);
		expect(await count()).toBe(4);
		// A fifth isn't added…
		expect(await page.evaluate((green) => (window as unknown as { __scenes: Api }).__scenes.addOverlayFromMedia(green, 0), green)).toBeNull();
		await expect(page.getByText(/Only 4 videos can play over the scenes at once/)).toBeVisible();
		// …nor made by duplicating a track with a video on it.
		await page.evaluate(() => {
			const s = (window as unknown as { __scenes: Api; }).__scenes;
			const hidden = s.project.tracks.find((t) => t.name === 'Hidden video')!.id;
			s.duplicateTrack(hidden);
		});
		expect(await count()).toBe(4);
		expect(await page.evaluate(() => (window as unknown as { __scenes: Api }).__scenes.project.tracks.some((t) => t.name === 'Hidden video copy'))).toBe(false);
	});
});
