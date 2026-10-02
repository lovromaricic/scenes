import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { fixture, importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

/**
 * The video's length is the latest end of anything on the Scenes track or an overlay track
 * (layers and words), so a card that goes on after the last scene is part of the video: over the
 * background (black) there. Sound doesn't make it longer: a song past the end is dimmed there in
 * the storyboard and fades out at the end.
 */

type RGB = [number, number, number];
const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const length = (page: Page) => api<number>(page, 's => Math.round(s.duration * 100) / 100');

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

async function pixel(page: Page, fx: number, fy: number): Promise<RGB> {
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
const isBlue = ([r, g, b]: RGB) => b > 180 && r < 80 && g < 80;
const isBlack = ([r, g, b]: RGB) => r < 30 && g < 30 && b < 30;
const isGreen = ([r, g, b]: RGB) => g > 150 && r < 80 && b < 80;

/** A 3 s green scene, and a blue card in the middle of the frame from 1 s to 5 s. */
async function setup(page: Page): Promise<string> {
	await openNewVideo(page);
	await importViaPicker(page, ['green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await page.keyboard.press('Escape');
	return api<string>(page, `s => {
		const c = s.addCardOverlay(1);
		s.setOverlayCard(c, { background: '#0000ff', rect: null });
		s.setOverlayBox(c, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
		s.setOverlayTiming(c, 1, 4);
		s.deselect();
		return c;
	}`);
}

/** Pixels per second on the storyboard, from the 3 s scene's card. */
async function pps(page: Page): Promise<number> {
	const card = (await page.locator('.card-slot').first().boundingBox())!;
	return card.width / 3;
}

test.describe('The video’s length', () => {
	test.setTimeout(180_000);

	test('a card after the last scene makes the video longer: time, range, storyboard and preview (over black)', async ({ page }) => {
		const card = await setup(page);
		expect(await length(page)).toBe(5);
		// The time display and the range: 0–5 s.
		const total = await api<string>(page, 's => s.formatTime(5)');
		await expect(page.locator('.total')).toHaveText(total);
		expect(await api(page, 's => s.range')).toEqual({ start: 0, end: 5 });
		const p = await pps(page);
		const range = (await page.getByTestId('range').boundingBox())!;
		expect(range.width).toBeCloseTo(5 * p, -1);

		// Past the last scene: an empty striped region up to 5 s; "+ Scene" right after the scene.
		const scene = (await page.locator('.card-slot').first().boundingBox())!;
		const tail = (await page.getByTestId('scenes-tail').boundingBox())!;
		expect(tail.x).toBeCloseTo(scene.x + scene.width, 0);
		expect(tail.width).toBeCloseTo(2 * p, -1);
		const add = (await page.getByRole('button', { name: 'Scene', exact: true }).boundingBox())!;
		expect(add.x).toBeCloseTo(scene.x + scene.width, 0);
		await page.screenshot({ path: test.info().outputPath('storyboard-tail.png') });

		// The preview: the scene under the card until 3 s, black around it after.
		await seekTo(page, 2);
		expect(isBlue(await pixel(page, 0.5, 0.5))).toBe(true);
		expect(isGreen(await pixel(page, 0.15, 0.5))).toBe(true);
		await seekTo(page, 4);
		expect(isBlue(await pixel(page, 0.5, 0.5))).toBe(true);
		expect(isBlack(await pixel(page, 0.15, 0.5))).toBe(true);
		await page.screenshot({ path: test.info().outputPath('card-over-black.png') });

		// It plays to 5 s (not 3 s) and stops there.
		await seekTo(page, 2.5);
		await api(page, 's => s.togglePlay()');
		await expect.poll(() => api<boolean>(page, 's => s.playing'), { timeout: 10_000 }).toBe(false);
		expect(await api<number>(page, 's => s.time')).toBeGreaterThan(4.9);

		// Watch mode: the same length.
		await page.getByRole('button', { name: 'Watch' }).click();
		await expect(page.getByRole('slider', { name: 'Position' })).toHaveAttribute('aria-valuemax', '5');
		await page.keyboard.press('Escape');

		// Shorter card, shorter video (never shorter than the scenes).
		await api(page, `s => s.setOverlayTiming('${card}', 1, 1)`);
		expect(await length(page)).toBe(3);
		await expect(page.getByTestId('scenes-tail')).toHaveCount(0);
	});

	test('moving or trimming the card changes the length live, while dragging', async ({ page }) => {
		const card = await setup(page);
		await api(page, `s => s.select('${card}')`);
		const p = await pps(page);
		const item = page.locator(`[data-item-id="${card}"]`);

		// Trim its end 1 s later: 6 s while dragging, and after.
		const end = (await item.locator('[data-trim="end"]').boundingBox())!;
		await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
		await page.mouse.down();
		await page.mouse.move(end.x + end.width / 2 + p * 0.5, end.y + end.height / 2, { steps: 4 });
		await page.mouse.move(end.x + end.width / 2 + p, end.y + end.height / 2, { steps: 4 });
		await expect.poll(() => length(page)).toBeCloseTo(6, 1);
		const tail = (await page.getByTestId('scenes-tail').boundingBox())!;
		expect(tail.width).toBeCloseTo(3 * p, -1);
		await page.mouse.up();
		expect(await length(page)).toBeCloseTo(6, 1);

		// Move it 1 s earlier: 5 s while dragging, and after.
		const box = (await item.locator('.item').boundingBox())!;
		const y = box.y + box.height / 2;
		await page.mouse.move(box.x + 30, y);
		await page.mouse.down();
		await page.mouse.move(box.x + 30 - p * 0.5, y, { steps: 4 });
		await page.mouse.move(box.x + 30 - p, y, { steps: 4 });
		await expect.poll(() => length(page)).toBeCloseTo(5, 1);
		await page.mouse.up();
		expect(await length(page)).toBeCloseTo(5, 1);
	});

	test('a song longer than the video doesn’t make it longer: dimmed past the end, and fades out there', async ({ page }) => {
		await setup(page);
		await page.getByRole('button', { name: /^Sound Music/ }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: /^Music Add a song/ }).click();
		await (await chooser).setFiles(fixture('music.m4a'));
		await expect(page.locator('.item-slot.sound')).toHaveCount(1);
		await page.keyboard.press('Escape');
		// The song is longer than 5 s; the video stays 5 s.
		expect(await api<number>(page, 's => s.project.sounds[0].duration')).toBeGreaterThan(5);
		expect(await length(page)).toBe(5);
		// Drawn whole, with the part past 5 s dimmed.
		const song = page.locator('.item-slot.sound');
		await song.scrollIntoViewIfNeeded();
		const past = (await song.getByTestId('past-end').boundingBox())!;
		const scene = (await page.locator('.card-slot').first().boundingBox())!;
		const p = await pps(page);
		expect(past.x).toBeCloseTo(scene.x + 5 * p, -1);
		await page.screenshot({ path: test.info().outputPath('song-past-end.png') });
	});

	test('saving: the file is 5 s, with the card over black after the scene, and the song fading out at the end', async ({ page }, info) => {
		test.skip(!hasFfmpeg, 'needs ffmpeg');
		await setup(page);
		await page.getByRole('button', { name: /^Sound Music/ }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: /^Music Add a song/ }).click();
		await (await chooser).setFiles(fixture('music.m4a'));
		await expect(page.locator('.item-slot.sound')).toHaveCount(1);
		await page.keyboard.press('Escape');
		await api(page, 's => { const x = s.project.sounds[0]; s.setSoundFades(x.id, 0, 0); s.setSoundVolume(x.id, 1); }');

		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		await expect(dialog.getByTestId('export-summary')).toContainText('· 5 sec ·');
		await dialog.getByRole('radio', { name: /Small file/ }).click();
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await dialog.getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('length.mp4');
		await (await download).saveAs(file);
		const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
		expect(seconds).toBeGreaterThan(4.9);
		expect(seconds).toBeLessThan(5.2);
		const at = (t: number, fx: number, fy: number): RGB => {
			const x = Math.floor(fx * 16);
			const y = Math.floor(fy * 9);
			const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=16:9,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
			return [raw[0], raw[1], raw[2]];
		};
		expect(isGreen(at(2, 0.15, 0.5))).toBe(true);
		expect(isBlue(at(4, 0.5, 0.5))).toBe(true);
		expect(isBlack(at(4, 0.15, 0.5))).toBe(true);
		// The song: loud a second before the end, much quieter in the last moment (faded out).
		const mean = (from: number, dur: number) => {
			const out = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(from), '-t', String(dur), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
			const m = /mean_volume: (-?[\d.]+) dB/.exec(out.stderr);
			return m ? Number(m[1]) : -Infinity;
		};
		const before = mean(3.8, 0.4);
		const last = mean(4.92, 0.07);
		expect(before).toBeGreaterThan(-40);
		expect(last).toBeLessThan(before - 6);
	});
});
