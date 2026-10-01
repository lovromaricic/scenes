import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

/**
 * Words up to 2000 px: typed (and kept within 12–2000), with the arrow keys, or on the curved
 * slider; drawn sharply (within the GPU's texture limit) in the preview and saved files, and not
 * redrawn while they play.
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

/** The words' size in project pixels (stored as a fraction of the 720 px short side). */
const sizePx = (page: Page) => api<number>(page, 's => Math.round(s.project.texts[0].size * 720)');

async function setup(page: Page, words: string, style: string) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	const id = await api<string>(page, `s => {
		s.addText('caption');
		s.stopEditingText();
		const id = s.selectedId;
		s.setTextWords(id, ${JSON.stringify(words)});
		s.setTextStyle(id, ${JSON.stringify(style)});
		s.setTextAnimation(id, 'none');
		s.setTextPosition(id, 0.5, 0.5);
		s.setTextTiming(id, 0, 6);
		s.seek(0.5);
		return id;
	}`);
	return id;
}

/** Preview pixel at a fraction of the frame. */
async function previewAt(page: Page, fx: number, fy: number): Promise<RGB> {
	await expect.poll(() => api<boolean>(page, 's => s.player.isFrameReady()'), { timeout: 10_000 }).toBe(true);
	await frames(page);
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

const red = ([r, g, b]: RGB) => r > 180 && g < 70 && b < 70;
const white = ([r, g, b]: RGB) => r > 220 && g > 220 && b > 220;

test.describe('Very large words (up to 2000 px)', () => {
	test.setTimeout(180_000);

	test('2000 px by typing or with the slider; typed values kept in range; arrows step 1 (Shift 10)', async ({ page }) => {
		await setup(page, 'Big', 'clean');
		const field = page.getByRole('spinbutton', { name: 'Text size in pixels' });
		const slider = page.getByRole('slider', { name: 'Text size' });

		await field.fill('2000');
		await field.press('Enter');
		expect(await sizePx(page)).toBe(2000);
		// Outside 12–2000: brought into range, and shown that way.
		await field.fill('5000');
		await field.press('Enter');
		expect(await sizePx(page)).toBe(2000);
		await expect(field).toHaveValue('2000');
		await field.fill('3');
		await field.press('Tab');
		expect(await sizePx(page)).toBe(12);
		await expect(field).toHaveValue('12');

		// Arrow keys: 1 px, Shift for 10, never past the ends.
		await field.focus();
		await field.press('ArrowUp');
		expect(await sizePx(page)).toBe(13);
		await field.press('Shift+ArrowUp');
		expect(await sizePx(page)).toBe(23);
		await field.press('ArrowDown');
		expect(await sizePx(page)).toBe(22);
		await field.press('Shift+ArrowDown');
		await field.press('Shift+ArrowDown');
		expect(await sizePx(page)).toBe(12);
		await field.fill('1995');
		await field.press('Enter');
		await field.press('Shift+ArrowUp');
		expect(await sizePx(page)).toBe(2000);
		await expect(field).toHaveValue('2000');

		// The slider's far end is 2000 px, and it's curved: everyday sizes take most of it.
		await slider.fill('0');
		expect(await sizePx(page)).toBe(12);
		await slider.fill('1');
		expect(await sizePx(page)).toBe(2000);
		await expect(field).toHaveValue('2000');
		await expect(slider).toHaveAttribute('aria-valuetext', '2000 px');
		await field.fill('200');
		await field.press('Enter');
		expect(Number(await slider.inputValue())).toBeGreaterThan(0.6);
		// Half-way along is still a modest size, and small steps there are a pixel or two.
		await slider.fill('0.5');
		const half = await sizePx(page);
		expect(half).toBeGreaterThan(30);
		expect(half).toBeLessThan(80);
		await slider.fill('0.501'); // one step
		expect((await sizePx(page)) - half).toBeLessThanOrEqual(1);
	});

	test('2000 px words with a box and growing 4× stay sharp in the preview and the saved frame, and play without redrawing', async ({
		page
	}, info) => {
		const id = await setup(page, 'HELLO', 'boxed');
		const field = page.getByRole('spinbutton', { name: 'Text size in pixels' });
		await field.fill('2000');
		await field.press('Enter');
		// Growing from 1× at 0 s to 4× at 2 s.
		await api(page, `s => {
			const t = s.project.texts.find((x) => x.id === '${id}');
			const base = { ...s.itemValues('${id}', 0) };
			const lin = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
			s.edit('k', (p) => ({ ...p, texts: p.texts.map((x) => x.id === t.id ? { ...x, keyframes: [
				{ id: 'a', time: 0, values: base, easing: lin },
				{ id: 'b', time: 2, values: { ...base, scaleX: 4, scaleY: 4 }, easing: lin }
			] } : x) }));
			s.seek(0);
		}`);

		// The sprite fits the GPU's texture limit (and the memory budget), at least at frame
		// resolution, so it's sharp at 1×.
		const sprite = await page.evaluate(() => {
			const gl = document.createElement('canvas').getContext('webgl2')!;
			return { max: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number };
		});
		const canvases: { w: number; h: number; stack: string }[] = [];
		await page.exposeFunction('__canvasMade', (w: number, h: number, stack: string) => canvases.push({ w, h, stack }));
		await page.evaluate(() => {
			const Real = OffscreenCanvas;
			(window as unknown as { OffscreenCanvas: typeof OffscreenCanvas }).OffscreenCanvas = class extends Real {
				constructor(w: number, h: number) {
					super(w, h);
					if (w * h > 1_000_000)
						(window as unknown as { __canvasMade(w: number, h: number, stack: string): void }).__canvasMade(w, h, new Error().stack ?? '');
				}
			};
		});
		// A redraw at a new size (the frame was drawn before this was being watched).
		await seekTo(page, 0.1);
		await page.setViewportSize({ width: 1300, height: 880 });
		await frames(page);
		await expect.poll(() => canvases.length).toBeGreaterThan(0);
		for (const c of canvases) {
			expect(c.w).toBeLessThanOrEqual(sprite.max);
			expect(c.h).toBeLessThanOrEqual(sprite.max);
			expect(c.w * c.h).toBeLessThanOrEqual(32_000_000);
		}

		// Preview: the frame is covered by the box (the words are far larger than it), letters
		// in white.
		await seekTo(page, 0);
		const corner = await previewAt(page, 0.02, 0.02);
		expect(red(corner)).toBe(false);

		// Playing (growing all the while): smooth, and the words aren't drawn again. (Saved first:
		// the home picture, which shows the words too, is made again after a change.)
		await api(page, 's => s.flushSave()');
		canvases.length = 0;
		const fps = await page.evaluate(async () => {
			const s = (window as unknown as { __scenes: { togglePlay(): void; playing: boolean } }).__scenes;
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
		expect(canvases.filter((c) => !c.stack.includes('Thumbnail'))).toHaveLength(0);

		if (!hasFfmpeg) return;
		// The saved frame at 0 s (the same renderer as every export): sharp letter edges. Pixels
		// partway between the letters' white and the box are only the thin edges of the letters.
		await seekTo(page, 0);
		const download = page.waitForEvent('download');
		await api(page, `s => s.downloadFrame('png')`);
		const file = info.outputPath('frame.png');
		await (await download).saveAs(file);
		const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
			maxBuffer: 64 * 1024 * 1024
		});
		let whites = 0;
		let between = 0;
		const n = raw.length / 3;
		for (let i = 0; i < n; i++) {
			const r = raw[i * 3];
			if (r > 235) whites++;
			else if (r > 60 && r < 200) between++;
		}
		expect(whites / n).toBeGreaterThan(0.05); // there are letters in view
		expect(between / n).toBeLessThan(0.02); // and their edges are crisp
		await page.screenshot({ path: info.outputPath('2000px.png') });

		// The saved MP4: the box and letters at the start, and grown later (no errors on the way).
		await page.getByRole('button', { name: 'Save video' }).click();
		const video = page.waitForEvent('download', { timeout: 120_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		const mp4 = info.outputPath('big.mp4');
		await (await video).saveAs(mp4);
		const pixel = (t: number, x: number, y: number): RGB => {
			const out = execFileSync('ffmpeg', [
				'-v', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1',
				'-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
			]);
			return [out[0], out[1], out[2]];
		};
		expect(red(pixel(0.2, 20, 20))).toBe(false);
		expect(red(pixel(1.5, 20, 20))).toBe(false);
		expect(white(pixel(4.5, 640, 360)) || !red(pixel(4.5, 640, 360))).toBe(true);
	});
});
