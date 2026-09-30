import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

type RGB = [number, number, number];
const near = (a: RGB, b: RGB, tol = 30) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const RED: RGB = [255, 0, 0];
const GREEN: RGB = [0, 255, 0];
const BLUE: RGB = [0, 0, 255];
const YELLOW: RGB = [255, 255, 0];

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

/** Colours at the middle of each quarter of the picture: TL, TR, BL, BR. */
async function quarters(page: Page): Promise<RGB[]> {
	await expect.poll(() => scenes(page, (s) => s.player.isFrameReady()), { timeout: 10_000 }).toBe(true);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	return page.evaluate(() => {
		const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
		const s = (window as unknown as { __scenes: { player: { readPixel(x: number, y: number): number[] } } }).__scenes;
		return [
			[0.25, 0.25],
			[0.75, 0.25],
			[0.25, 0.75],
			[0.75, 0.75]
		].map(([x, y]) => s.player.readPixel(Math.floor(c.width * x), Math.floor(c.height * y)).slice(0, 3) as RGB);
	});
}

/** The test photos are red | green over blue | yellow: upright means red at the top left. */
const expectUpright = (q: RGB[], what: string) => {
	const want = [RED, GREEN, BLUE, YELLOW];
	q.forEach((c, i) => expect(near(c, want[i]), `${what}, quarter ${i}: ${c} vs ${want[i]}`).toBe(true));
};

test.describe('Photos', () => {
	test.setTimeout(120_000);

	test('photos show upright as scenes, as layers and while cropping (phone photos with EXIF too)', async ({ page }) => {
		await openNewVideo(page);
		// quads-exif6.jpg is stored sideways with an EXIF "rotate" tag, as phones do.
		await importViaPicker(page, ['quads.jpg', 'quads-large.jpg', 'quads-exif6.jpg', 'quads.png'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 4, / })).toBeVisible();
		const sizes = await page.evaluate(() =>
			Object.values((window as unknown as { __scenes: { media: Record<string, { name: string; width: number; height: number }> } }).__scenes.media).map(
				(m) => `${m.name} ${m.width}×${m.height}`
			)
		);
		expect(sizes).toContain('quads-exif6.jpg 1600×900');
		for (const [i, t] of [0.5, 3.5, 6.5, 9.5].entries()) {
			await seekTo(page, t);
			expectUpright(await quarters(page), `scene ${i + 1}`);
		}

		// As a layer filling the frame, over the first scene.
		for (const name of ['quads.jpg', 'quads-large.jpg', 'quads-exif6.jpg']) {
			await page.evaluate((name) => {
				const s = (window as unknown as {
					__scenes: {
						project: { overlays: { id: string }[] };
						media: Record<string, { id: string; name: string }>;
						deleteOverlay(id: string): void;
						addOverlayFromMedia(id: string, t: number): string;
						setOverlayBox(id: string, b: object): void;
					};
				}).__scenes;
				for (const o of [...s.project.overlays]) s.deleteOverlay(o.id);
				const id = s.addOverlayFromMedia(Object.values(s.media).find((m) => m.name === name)!.id, 0);
				s.setOverlayBox(id, { x: 0, y: 0, w: 1, h: 1 });
			}, name);
			await seekTo(page, 1);
			expectUpright(await quarters(page), `layer ${name}`);
		}

		// Crop mode shows the whole photo upright too.
		await page.getByRole('toolbar', { name: 'Layer options' }).getByRole('button', { name: 'Crop' }).click();
		await expect(page.getByRole('complementary', { name: 'Settings' }).getByRole('heading', { name: 'Crop' })).toBeVisible();
		expectUpright(await quarters(page), 'crop view');
	});

	test('the saved video has photos upright', async ({ page }, info) => {
		test.skip(!hasFfmpeg, 'needs ffmpeg to inspect the saved file');
		await openNewVideo(page);
		await importViaPicker(page, ['quads.jpg', 'quads-exif6.jpg'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.getByRole('button', { name: 'Save video' }).click();
		const download = page.waitForEvent('download', { timeout: 90_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('photos.mp4');
		await (await download).saveAs(file);
		const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
			.toString()
			.trim()
			.split(',')
			.map(Number);
		for (const t of [1, 4]) {
			const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
				maxBuffer: 64 * 1024 * 1024
			});
			const at = (fx: number, fy: number): RGB => {
				const o = (Math.floor(h * fy) * w + Math.floor(w * fx)) * 3;
				return [raw[o], raw[o + 1], raw[o + 2]];
			};
			expectUpright([at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)], `saved at ${t}s`);
		}
	});

	test('photo and video layers scale in their own shape from any handle; Shift frees it', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['long.mp4', 'quads-large.jpg'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await page.evaluate(() => {
			const s = (window as unknown as { __scenes: { media: Record<string, { id: string; name: string }>; addOverlayFromMedia(id: string, t: number): string } }).__scenes;
			s.addOverlayFromMedia(Object.values(s.media).find((m) => m.name === 'quads-large.jpg')!.id, 1);
		});
		await seekTo(page, 2);
		const size = page.getByTestId('layer-size');
		const ratio = async () => {
			const [w, h] = (await size.innerText()).split('×').map((v) => Number(v.trim()));
			return w / h;
		};
		expect(await ratio()).toBeCloseTo(4 / 3, 1);
		const drag = async (handle: string, dx: number, dy: number, shift = false) => {
			const b = (await page.locator(`[data-layer-handle="${handle}"]`).boundingBox())!;
			if (shift) await page.keyboard.down('Shift');
			await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
			await page.mouse.down();
			await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 8 });
			await page.mouse.up();
			if (shift) await page.keyboard.up('Shift');
		};
		const before = await size.innerText();
		// A side handle scales the whole picture (no cropping, no stretching).
		await drag('e', 90, 0);
		await expect(size).not.toHaveText(before);
		expect(await ratio()).toBeCloseTo(4 / 3, 1);
		await drag('n', 0, 40);
		expect(await ratio()).toBeCloseTo(4 / 3, 1);
		await drag('sw', -60, 10);
		expect(await ratio()).toBeCloseTo(4 / 3, 1);
		// Shift frees the shape.
		await drag('e', 120, 0, true);
		expect(await ratio()).toBeGreaterThan(1.6);
		// And the next plain drag brings it back to the photo's own shape.
		await drag('se', 20, 20);
		expect(await ratio()).toBeCloseTo(4 / 3, 1);
	});
});
