import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * An editable shadow on words: on/off (each style has its own), colour, opacity, blur, distance
 * and angle (dial and field), presets (Glow glows), Reset; drawn the same in the preview, Watch,
 * the home picture and the saved video.
 */

type RGB = [number, number, number];
const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

type Counts = { white: number; whiteX: number; blue: number; blueX: number; blueY: number; whiteY: number; purple: number; dark: number; glow: number };

/**
 * Classify every pixel of a canvas (the preview by default) on the red video: the white letters,
 * a blue or half-blue (purple) shadow, a dark (black) one, and a light glow; with the centres of
 * the white and blue ones.
 */
async function counts(page: Page, selector = 'canvas[data-testid="preview"]'): Promise<Counts> {
	await frames(page);
	return page.evaluate((selector) => {
		const src = document.querySelector(selector) as HTMLCanvasElement | HTMLImageElement;
		const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
		const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
		const c = new OffscreenCanvas(w, h);
		const ctx = c.getContext('2d')!;
		ctx.drawImage(src, 0, 0);
		const d = ctx.getImageData(0, 0, w, h).data;
		const out = { white: 0, whiteX: 0, whiteY: 0, blue: 0, blueX: 0, blueY: 0, purple: 0, dark: 0, glow: 0 };
		for (let i = 0; i < w * h; i++) {
			const r = d[i * 4];
			const g = d[i * 4 + 1];
			const b = d[i * 4 + 2];
			const x = (i % w) / w;
			const y = Math.floor(i / w) / h;
			if (r > 230 && g > 230 && b > 230) {
				out.white++;
				out.whiteX += x;
				out.whiteY += y;
			} else if (b > 200 && r < 60 && g < 60) {
				out.blue++;
				out.blueX += x;
				out.blueY += y;
			} else if (Math.abs(r - b) < 40 && r > 90 && r < 170 && g < 50) out.purple++;
			else if (r < 238 && g < 40 && b < 40) out.dark++; // the red darkened
			else if (r > 235 && g > 70 && g < 225 && b > 50 && b < 225) out.glow++;
		}
		out.whiteX /= Math.max(1, out.white);
		out.whiteY /= Math.max(1, out.white);
		out.blueX /= Math.max(1, out.blue);
		out.blueY /= Math.max(1, out.blue);
		return out;
	}, selector);
}

/** A Big title "HI" (200 px, in the middle, all 6 s) on the red video, selected. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	const id = await api<string>(page, `s => {
		s.addText('title');
		s.stopEditingText();
		const id = s.selectedId;
		s.setTextWords(id, 'HI');
		s.setTextAnimation(id, 'none');
		s.setTextPosition(id, 0.5, 0.5);
		s.setTextTiming(id, 0, 6);
		s.setTextSize(id, 200 / 720);
		s.seek(1);
		s.select(id);
		return id;
	}`);
	await expect(page.getByRole('switch', { name: 'Shadow' })).toBeVisible();
	return id;
}

const shadowOf = (page: Page) =>
	api<{ on: boolean; color: string; opacity: number; blur: number; distance: number; angle: number }>(
		page,
		`s => { const t = s.project.texts[0]; return JSON.parse(JSON.stringify((t.shadow ?? null) || { on: null })) }`
	);

/** A hard blue shadow, 40 px to the right: easy to find. */
async function blueShadow(page: Page) {
	const settings = page.getByRole('region', { name: 'Shadow' });
	const hex = settings.getByRole('textbox', { name: 'Shadow color: hex code' });
	await hex.fill('#0000ff');
	await hex.press('Enter');
	await settings.getByRole('slider', { name: 'Shadow color: opacity' }).fill('1');
	await settings.getByRole('slider', { name: 'Shadow blur' }).fill('0');
	await settings.getByRole('slider', { name: 'Shadow distance' }).fill('40');
	const angle = settings.getByRole('spinbutton', { name: 'Shadow angle' });
	await angle.fill('0');
	return settings;
}

test.describe('Text shadow', () => {
	test.setTimeout(180_000);

	test('turn a Big title’s shadow off and on; colour, opacity, blur, distance and angle update the preview live', async ({ page }, info) => {
		await setup(page);
		const settings = page.getByRole('region', { name: 'Shadow' });
		const sw = settings.getByRole('switch', { name: 'Shadow' });
		// Big title starts with its soft shadow: dark under the letters.
		await expect(sw).toHaveAttribute('aria-checked', 'true');
		await expect.poll(async () => (await counts(page)).dark).toBeGreaterThan(200);

		// Off: no shadow at all. On again: back.
		await sw.click();
		await expect(sw).toHaveAttribute('aria-checked', 'false');
		await expect(settings.getByRole('slider', { name: 'Shadow blur' })).toHaveCount(0);
		await expect.poll(async () => (await counts(page)).dark).toBeLessThan(20);
		expect((await shadowOf(page)).on).toBe(false);
		await sw.click();
		await expect.poll(async () => (await counts(page)).dark).toBeGreaterThan(200);

		// Blue, solid, sharp, 40 px to the right (angle 0).
		await blueShadow(page);
		const s = await shadowOf(page);
		expect(s).toMatchObject({ on: true, color: '#0000ff', opacity: 1, blur: 0, angle: 0 });
		expect(s.distance * 200).toBeCloseTo(40, 5); // shown and kept in pixels at the words' size
		await expect(settings.getByRole('slider', { name: 'Shadow distance' })).toHaveAttribute('aria-valuetext', '40 px');
		const c = await counts(page);
		expect(c.blue).toBeGreaterThan(200);
		expect(c.blueX).toBeGreaterThan(c.whiteX); // to the right of the letters
		await page.screenshot({ path: info.outputPath('blue-right.png') });

		// The angle field: 180° puts it on the left.
		await settings.getByRole('spinbutton', { name: 'Shadow angle' }).fill('180');
		await expect.poll(async () => {
			const k = await counts(page);
			return k.blueX < k.whiteX;
		}).toBe(true);
		// The dial: clicking below its centre points it down (90°).
		const dial = settings.getByRole('slider', { name: 'Shadow angle dial' });
		const db = (await dial.boundingBox())!;
		await page.mouse.click(db.x + db.width / 2, db.y + db.height - 2);
		await expect(settings.getByRole('spinbutton', { name: 'Shadow angle' })).toHaveValue('90');
		await expect.poll(async () => {
			const k = await counts(page);
			return k.blueY > k.whiteY + 0.01;
		}).toBe(true);
		// Arrow keys on the dial: 1° (Shift 15°).
		await dial.press('ArrowRight');
		await dial.press('Shift+ArrowRight');
		expect((await shadowOf(page)).angle).toBe(106);

		// Opacity: half-transparent blue over red is purple.
		await settings.getByRole('slider', { name: 'Shadow color: opacity' }).fill('0.5');
		await expect.poll(async () => (await counts(page)).purple).toBeGreaterThan(200);
		expect((await counts(page)).blue).toBeLessThan(20);
		await settings.getByRole('slider', { name: 'Shadow color: opacity' }).fill('1');
		const sharp = await counts(page);

		// Blur: softer edges, so less solid blue.
		await settings.getByRole('slider', { name: 'Shadow blur' }).fill('30');
		await expect.poll(async () => (await counts(page)).blue).toBeLessThan(sharp.blue * 0.7);
		// Distance 0 hides a sharp shadow behind the letters.
		await settings.getByRole('slider', { name: 'Shadow blur' }).fill('0');
		await settings.getByRole('slider', { name: 'Shadow distance' }).fill('0');
		await expect.poll(async () => (await counts(page)).blue).toBeLessThan(20);

		// Undo: turning it off is one step back.
		await settings.getByRole('switch', { name: 'Shadow' }).click();
		expect((await shadowOf(page)).on).toBe(false);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
		expect((await shadowOf(page)).on).toBe(true);
	});

	test('presets fill in the values; Glow glows around the letters; Reset shadow goes back to the style’s', async ({ page }) => {
		await setup(page);
		const settings = page.getByRole('region', { name: 'Shadow' });
		const presets = settings.getByRole('radiogroup', { name: 'Shadow preset' });
		// The Big title's own shadow is the Soft preset.
		await expect(presets.getByRole('radio', { name: 'Soft' })).toHaveAttribute('aria-checked', 'true');
		await settings.getByRole('switch', { name: 'Shadow' }).click();
		await expect.poll(async () => (await counts(page)).glow).toBeGreaterThanOrEqual(0);
		const none = await counts(page);
		await settings.getByRole('switch', { name: 'Shadow' }).click();

		await presets.getByRole('radio', { name: 'Hard' }).click();
		expect(await shadowOf(page)).toMatchObject({ on: true, blur: 0, angle: 45 });
		await presets.getByRole('radio', { name: 'Long' }).click();
		const long = await shadowOf(page);
		expect(long.distance).toBeGreaterThan(0.2);
		await presets.getByRole('radio', { name: 'Glow' }).click();
		const glow = await shadowOf(page);
		expect(glow.distance).toBe(0);
		expect(glow.blur).toBeGreaterThan(0.4);
		// A light glow all around the letters (above as well as below), not a shadow on one side.
		await expect.poll(async () => (await counts(page)).glow).toBeGreaterThan(none.glow * 2 + 300);
		const ring = await page.evaluate(() => {
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const box = document.querySelector('.text-box')!.getBoundingClientRect();
			const r = c.getBoundingClientRect();
			const k = c.width / r.width;
			const o = new OffscreenCanvas(c.width, c.height);
			const ctx = o.getContext('2d')!;
			ctx.drawImage(c, 0, 0);
			const at = (x: number, y: number) => Array.from(ctx.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data);
			const cx = box.left + box.width / 2;
			// Just outside the words' box: above, below, left and right.
			return [at(cx, box.top - 4), at(cx, box.bottom + 4), at(box.left - 4, box.top + box.height / 2), at(box.right + 4, box.top + box.height / 2)];
		});
		for (const [r, g] of ring) {
			expect(r).toBeGreaterThan(235);
			expect(g).toBeGreaterThan(27); // lighter than the plain red (22)
		}

		// Reset shadow: the style's own again.
		await settings.getByRole('button', { name: 'Reset shadow' }).click();
		expect((await shadowOf(page)).on).toBeNull();
		await expect(presets.getByRole('radio', { name: 'Soft' })).toHaveAttribute('aria-checked', 'true');
		await expect(settings.getByRole('button', { name: 'Reset shadow' })).toHaveCount(0);

		// Picking another style brings its own (Clean white: none).
		await presets.getByRole('radio', { name: 'Glow' }).click();
		await page.getByRole('radio', { name: 'Clean white' }).first().click();
		await expect(settings.getByRole('switch', { name: 'Shadow' })).toHaveAttribute('aria-checked', 'false');
	});

	test('the same shadow in Watch, on the home picture and in the saved video', async ({ page }, info) => {
		await setup(page);
		await blueShadow(page);
		await page.getByRole('region', { name: 'Shadow' }).getByRole('spinbutton', { name: 'Shadow angle' }).fill('45');
		await api(page, `s => { s.deselect(); s.seek(1); }`);
		const preview = await counts(page);
		expect(preview.blue).toBeGreaterThan(200);

		// Points on the preview that are shadow, letters and plain red (fractions of the frame).
		const points = await page.evaluate(() => {
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const o = new OffscreenCanvas(c.width, c.height);
			const ctx = o.getContext('2d')!;
			ctx.drawImage(c, 0, 0);
			const d = ctx.getImageData(0, 0, c.width, c.height).data;
			const pick = (test: (r: number, g: number, b: number) => boolean) => {
				const found: [number, number][] = [];
				// Well inside a region: the pixel and its neighbours 3 px away agree.
				for (let y = 4; y < c.height - 4 && found.length < 12; y += 5)
					for (let x = 4; x < c.width - 4 && found.length < 12; x += 3) {
						const ok = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dy]) => {
							const i = ((y + dy) * c.width + x + dx) * 4;
							return test(d[i], d[i + 1], d[i + 2]);
						});
						if (ok) found.push([x / c.width, y / c.height]);
					}
				return found;
			};
			return {
				blue: pick((r, g, b) => b > 200 && r < 60 && g < 60),
				white: pick((r, g, b) => r > 230 && g > 230 && b > 230)
			};
		});
		expect(points.blue.length).toBeGreaterThanOrEqual(4);
		expect(points.white.length).toBeGreaterThanOrEqual(4);

		// Watch: the same picture, shadow included.
		await page.getByRole('button', { name: 'Watch' }).click();
		const watch = page.getByRole('dialog').locator('canvas');
		await expect(watch).toBeVisible();
		await api(page, `s => { if (s.playing) s.togglePlay(); s.seek(1); }`);
		await expect.poll(async () => (await counts(page, '[role="dialog"] canvas')).blue).toBeGreaterThan(200);
		await page.keyboard.press('Escape');

		// The saved MP4.
		if (hasFfmpeg) {
			await page.getByRole('button', { name: 'Save video' }).click();
			const download = page.waitForEvent('download', { timeout: 120_000 });
			await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
			const file = info.outputPath('shadow.mp4');
			await (await download).saveAs(file);
			await page.keyboard.press('Escape');
			const [W, H] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
				.toString()
				.trim()
				.split(',')
				.map(Number);
			const frame = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
				maxBuffer: 64 * 1024 * 1024
			});
			const at = (fx: number, fy: number): RGB => {
				const i = (Math.floor(H * fy) * W + Math.floor(W * fx)) * 3;
				return [frame[i], frame[i + 1], frame[i + 2]];
			};
			for (const [x, y] of points.blue) {
				const [r, g, b] = at(x, y);
				expect(b).toBeGreaterThan(180);
				expect(r).toBeLessThan(90);
				expect(g).toBeLessThan(90);
			}
			for (const [x, y] of points.white) expect(at(x, y).every((v) => v > 200)).toBe(true);
		}

		// The home picture (made from the words at 0 s) shows the blue shadow too.
		await api(page, 's => s.flushSave()');
		await page.getByRole('link', { name: 'Projects' }).click();
		const img = page.getByRole('article').first().locator('img');
		await expect(img).toBeVisible();
		await expect.poll(async () => (await counts(page, '[role="article"] img, article img')).blue, { timeout: 15_000 }).toBeGreaterThan(20);
	});

	test('a very large glowing title stays smooth while it plays (drawn once, not every frame)', async ({ page }) => {
		const id = await setup(page);
		await page.getByRole('region', { name: 'Shadow' }).getByRole('radiogroup', { name: 'Shadow preset' }).getByRole('radio', { name: 'Glow' }).click();
		// 900 px, turning and growing, partly outside the frame.
		await api(page, `s => {
			s.setTextSize('${id}', 900 / 720);
			s.setTextPosition('${id}', 0.2, 0.5);
			const base = { ...s.itemValues('${id}', 0) };
			const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
			s.edit('k', (p) => ({ ...p, texts: p.texts.map((x) => ({ ...x, keyframes: [
				{ id: 'a', time: 0, values: base, easing: lin },
				{ id: 'b', time: 3, values: { ...base, scaleX: 1.5, scaleY: 1.5, rotation: 20 }, easing: lin }
			] })) }));
			s.seek(0);
		}`);
		await expect.poll(async () => (await counts(page)).glow).toBeGreaterThan(1000);
		await api(page, 's => s.flushSave()');
		const made: string[] = [];
		await page.exposeFunction('__made', (a: string) => made.push(a));
		await page.evaluate(() => {
			const Real = OffscreenCanvas;
			(window as unknown as { OffscreenCanvas: typeof OffscreenCanvas }).OffscreenCanvas = class extends Real {
				constructor(w: number, h: number) {
					super(w, h);
					if (w * h > 200_000) (window as unknown as { __made(a: string): void }).__made(`${w}x${h} ${new Error().stack}`);
				}
			};
		});
		const fps = await page.evaluate(async () => {
			const s = (window as unknown as { __scenes: { togglePlay(): void } }).__scenes;
			s.togglePlay();
			let n = 0;
			const start = performance.now();
			await new Promise<void>((done) => {
				const tick = () => {
					n++;
					if (performance.now() - start < 1500) requestAnimationFrame(tick);
					else done();
				};
				requestAnimationFrame(tick);
			});
			s.togglePlay();
			return (n * 1000) / (performance.now() - start);
		});
		expect(fps).toBeGreaterThan(20);
		// (The home picture is made again after the change is saved; that's not playback.)
		expect(made.filter((m) => !m.includes('Thumbnail'))).toHaveLength(0);
	});
});
