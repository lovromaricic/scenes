import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

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

/** The preview's colour at a point (fractions of the frame), once every frame there is decoded. */
async function previewPixel(page: Page, fx: number, fy: number): Promise<RGB> {
	await expect.poll(() => scenes(page, (s) => s.player.isFrameReady()), { timeout: 10_000 }).toBe(true);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	return page.evaluate(
		({ fx, fy }) => {
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const s = (window as unknown as { __scenes: { player: { readPixel(x: number, y: number): number[] } } }).__scenes;
			const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
			return [p[0], p[1], p[2]] as RGB;
		},
		{ fx, fy }
	);
}

type Api = {
	media: Record<string, { id: string; name: string }>;
	addOverlayFromMedia(id: string, start?: number, row?: number): string;
	addCardOverlay(start?: number, row?: number): string;
	setOverlayBox(id: string, box: object): void;
	setOverlayStyle(id: string, style: object): void;
	setOverlayCard(id: string, card: object): void;
	setOverlaySound(id: string, sound: object): void;
	moveOverlayRow(id: string, d: 1 | -1): void;
	project: { overlays: { id: string; style: object; row: number }[] };
};

/** Red video (0–4 s) then the yellow photo (4–7 s), with three layers. */
async function build(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'yellow.jpg', 'blue.webm', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 4, / })).toBeVisible();
	// Keep blue and green only in "Your media".
	for (let i = 0; i < 2; i++) {
		await page.getByRole('button', { name: /^Scene 3, / }).click();
		await page.keyboard.press('Delete');
	}
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toHaveCount(0);
	return page.evaluate(() => {
		const s = (window as unknown as { __scenes: Api }).__scenes;
		const id = (name: string) => Object.values(s.media).find((m) => m.name === name)!.id;
		// A: picture-in-picture, top right, pill corners, white border, strong shadow.
		const a = s.addOverlayFromMedia(id('blue.webm'), 0.5);
		s.setOverlayBox(a, { x: 0.55, y: 0.1, w: 0.4, h: 0.4 });
		s.setOverlayStyle(a, { radius: 0.6, borderColor: '#ffffff', borderWidth: 12, shadow: 'strong', opacity: 1 });
		// B: a half-transparent navy card over the photo.
		const b = s.addCardOverlay(4.5);
		s.setOverlayBox(b, { x: 0.05, y: 0.1, w: 0.3, h: 0.3 });
		s.setOverlayCard(b, { background: '#336699', rect: null });
		s.setOverlayStyle(b, { radius: 0, borderColor: '#ffffff', borderWidth: 0, shadow: 'off', opacity: 0.5 });
		// C: a video over the photo scene, with its sound on.
		const c = s.addOverlayFromMedia(id('green.mp4'), 4.2);
		s.setOverlayBox(c, { x: 0.5, y: 0.5, w: 0.4, h: 0.4 });
		s.setOverlaySound(c, { on: true, volume: 1 });
		return { a, b, c };
	});
}

const RED: RGB = [255, 0, 0];
const BLUE: RGB = [0, 0, 255];
const GREEN: RGB = [0, 255, 0];
const YELLOW: RGB = [255, 255, 0];
const WHITE: RGB = [255, 255, 255];
/** Half navy (#336699) over yellow. */
const BLEND: RGB = [153, 179, 77];

/** Points checked in the preview and the saved video: [time, x, y, expected, tolerance]. */
const CHECKS: [number, number, number, RGB, number][] = [
	[1.5, 0.75, 0.3, BLUE, 30], // the video layer
	[1.5, 0.25, 0.6, RED, 30], // the scene around it
	[1.5, 0.553, 0.3, WHITE, 40], // its border (12 px of 1280, at the left edge)
	[5.5, 0.2, 0.25, BLEND, 25], // the half-transparent card over the photo
	[5.5, 0.7, 0.7, GREEN, 30], // a video over a photo scene
	[5.5, 0.45, 0.95, YELLOW, 30] // the photo around them
];

test.describe('Layers in the picture', () => {
	test.setTimeout(180_000);

	test('layers draw over scenes with corners, border, shadow and opacity; higher rows on top', async ({ page }) => {
		await build(page);
		for (const [t, x, y, want, tol] of CHECKS) {
			await seekTo(page, t);
			const got = await previewPixel(page, x, y);
			expect(near(got, want, tol), `at ${t}s (${x}, ${y}): ${got} vs ${want}`).toBe(true);
		}
		// The rounded corner: just inside the box's top-left corner is the scene (darkened by the
		// shadow), not the layer.
		await seekTo(page, 1.5);
		const corner = await previewPixel(page, 0.555, 0.105);
		expect(corner[2]).toBeLessThan(80);
		expect(corner[0]).toBeGreaterThan(60);
		// The strong shadow darkens the scene just below the box.
		const shadow = await previewPixel(page, 0.75, 0.515);
		expect(shadow[0]).toBeLessThan(215);
		expect(shadow[0]).toBeGreaterThan(40);

		// Two layers in the same place: the higher row is drawn on top.
		const ids = await page.evaluate(() => {
			const s = (window as unknown as { __scenes: Api }).__scenes;
			const photo = Object.values(s.media).find((m) => m.name === 'yellow.jpg')!.id;
			const low = s.addOverlayFromMedia(photo, 0, 0);
			s.setOverlayBox(low, { x: 0.05, y: 0.55, w: 0.3, h: 0.35 });
			const card = s.addCardOverlay(0, 5);
			s.setOverlayBox(card, { x: 0.1, y: 0.6, w: 0.2, h: 0.25 });
			s.setOverlayCard(card, { background: '#00ff00', rect: null });
			return { low, card };
		});
		await seekTo(page, 2);
		expect(near(await previewPixel(page, 0.2, 0.72), GREEN, 20)).toBe(true);
		const rows = await page.evaluate(({ low, card }) => {
			const s = (window as unknown as { __scenes: Api }).__scenes;
			const row = (id: string) => s.project.overlays.find((o) => o.id === id)!.row;
			return [row(low), row(card)];
		}, ids);
		expect(rows[1]).toBeGreaterThan(rows[0]);
		// Send the card back (a row at a time) until it's under the photo: now the photo is on top.
		await page.evaluate(({ low, card }) => {
			const s = (window as unknown as { __scenes: Api }).__scenes;
			const row = (id: string) => s.project.overlays.find((o) => o.id === id)!.row;
			for (let i = 0; i < 8 && row(card) > row(low); i++) s.moveOverlayRow(card, -1);
		}, ids);
		expect(near(await previewPixel(page, 0.2, 0.72), YELLOW, 25)).toBe(true);
	});

	test('the saved MP4 matches the preview, with the layer’s sound mixed in', async ({ page }, info) => {
		test.skip(!hasFfmpeg, 'needs ffmpeg to inspect the saved file');
		await build(page);
		const preview: RGB[] = [];
		for (const [t, x, y] of CHECKS) {
			await seekTo(page, t);
			preview.push(await previewPixel(page, x, y));
		}
		await page.getByRole('button', { name: 'Save video' }).click();
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('layers.mp4');
		await (await download).saveAs(file);

		const [width, height] = execFileSync('ffprobe', [
			'-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file
		])
			.toString()
			.trim()
			.split(',')
			.map(Number);
		const size = { width, height };
		for (const [i, [t, x, y, want, tol]] of CHECKS.entries()) {
			// A 4 × 4 patch (even, so chroma subsampling doesn't shrink it), averaged.
			const px = Math.floor(size.width * x) - 2;
			const py = Math.floor(size.height * y) - 2;
			const raw = execFileSync('ffmpeg', [
				'-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1',
				'-vf', `crop=4:4:${px}:${py}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
			]);
			const got = [0, 1, 2].map((c) => {
				let sum = 0;
				for (let k = 0; k < 16; k++) sum += raw[k * 3 + c];
				return Math.round(sum / 16);
			}) as RGB;
			expect(near(got, want, tol + 10), `saved at ${t}s (${x}, ${y}): ${got} vs ${want}`).toBe(true);
			expect(near(got, preview[i], 24), `saved ${got} vs preview ${preview[i]} at ${t}s`).toBe(true);
		}

		// Sound: at 5–6 s the green layer's 660 Hz tone is there (its sound is on); at 1–2 s the
		// blue layer's 880 Hz isn't (off by default), while the red scene's own 440 Hz is.
		const tone = (from: number, hz: number) => {
			const pcm = execFileSync('ffmpeg', [
				'-v', 'error', '-ss', String(from), '-t', '1', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'
			]);
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
		expect(tone(5, 660)).toBeGreaterThan(0.05);
		expect(tone(1, 440)).toBeGreaterThan(0.05);
		expect(tone(1, 880)).toBeLessThan(0.01);
	});

	test('up to four videos play on top at once, smoothly; a fifth gets a friendly message', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['long.mp4', 'red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 4, / })).toBeVisible();
		for (let i = 0; i < 3; i++) {
			await page.getByRole('button', { name: /^Scene 2, / }).click();
			await page.keyboard.press('Delete');
		}
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toHaveCount(0);
		const added = await page.evaluate(() => {
			const s = (window as unknown as { __scenes: Api }).__scenes;
			const id = (name: string) => Object.values(s.media).find((m) => m.name === name)!.id;
			const boxes = [
				{ x: 0.02, y: 0.02, w: 0.3, h: 0.3 },
				{ x: 0.68, y: 0.02, w: 0.3, h: 0.3 },
				{ x: 0.02, y: 0.68, w: 0.3, h: 0.3 },
				{ x: 0.68, y: 0.68, w: 0.3, h: 0.3 }
			];
			const names = ['red.mp4', 'green.mp4', 'blue.webm', 'red.mp4'];
			const ids = names.map((n, i) => {
				const o = s.addOverlayFromMedia(id(n), 1);
				if (o) s.setOverlayBox(o, boxes[i]);
				return o;
			});
			// A fifth video at the same moment isn't added.
			const fifth = s.addOverlayFromMedia(id('green.mp4'), 1.5);
			return { ids, fifth };
		});
		expect(added.ids.every(Boolean)).toBe(true);
		expect(added.fifth).toBeNull();
		await expect(page.getByText('Up to 4 videos can play on top of the scenes at the same moment')).toBeVisible();

		// All four show (their colours in the corners), and the scene in the middle.
		await seekTo(page, 2);
		expect(near(await previewPixel(page, 0.17, 0.17), RED, 30)).toBe(true);
		expect(near(await previewPixel(page, 0.83, 0.17), GREEN, 30)).toBe(true);
		expect(near(await previewPixel(page, 0.17, 0.83), BLUE, 30)).toBe(true);
		expect(near(await previewPixel(page, 0.83, 0.83), RED, 30)).toBe(true);
		expect(near(await previewPixel(page, 0.5, 0.5), [255, 0, 255], 30)).toBe(true);

		// Playing with all four decoding alongside the scene: time keeps pace with the clock.
		await seekTo(page, 1);
		const started = await page.evaluate(() => performance.now());
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		await page.waitForTimeout(2500);
		const [time, elapsed] = await page.evaluate(
			(started) => [(window as unknown as { __scenes: { time: number } }).__scenes.time, (performance.now() - started) / 1000],
			started
		);
		await page.getByRole('button', { name: 'Pause', exact: true }).click();
		// Allow the short warm-up before sound starts.
		expect(time - 1).toBeGreaterThan(elapsed - 0.8);
		expect(await scenes(page, (s) => s.player.isFrameReady())).toBe(true);
	});

	test('Watch mode shows the layers too', async ({ page }) => {
		await build(page);
		await page.getByRole('button', { name: 'Watch' }).click();
		const watch = page.getByRole('dialog', { name: /^Watch/ });
		await expect(watch).toBeVisible();
		await expect.poll(() => scenes(page, (s) => s.playing)).toBe(true);
		await page.keyboard.press('Space');
		await expect.poll(() => scenes(page, (s) => s.playing)).toBe(false);
		await page.evaluate(() => (window as unknown as { __scenes: { seek(t: number): void } }).__scenes.seek(1.5));
		await expect.poll(() => scenes(page, (s) => s.player.isFrameReady())).toBe(true);
		// The player now draws into Watch's own (bigger) canvas: read the layer and the scene there.
		const pixel = (fx: number, fy: number) =>
			page.evaluate(
				({ fx, fy }) => {
					const c = document.querySelector('[role="dialog"] canvas') as HTMLCanvasElement;
					const s = (window as unknown as { __scenes: { player: { readPixel(x: number, y: number): number[] } } }).__scenes;
					const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
					return [p[0], p[1], p[2]] as RGB;
				},
				{ fx, fy }
			);
		await expect.poll(async () => near(await pixel(0.75, 0.3), BLUE, 30)).toBe(true);
		expect(near(await pixel(0.25, 0.6), RED, 30)).toBe(true);
	});
});
