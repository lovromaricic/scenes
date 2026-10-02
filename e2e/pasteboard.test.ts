import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * Objects can sit outside the frame. The stage around the preview is a pasteboard showing them
 * faded (so they can be found, selected and dragged), it pans and zooms, and the saved video
 * shows only what's inside the frame.
 */

type RGB = [number, number, number];
const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** The frame (preview) and the stage (viewport) on screen, and the zoom button's label. */
async function stage(page: Page) {
	return page.evaluate(() => {
		const rect = (sel: string) => {
			const r = document.querySelector(sel)!.getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		};
		return {
			frame: rect('.preview'),
			stage: rect('.viewport'),
			zoom: document.querySelector('[data-testid="zoom"]')?.textContent?.trim() ?? ''
		};
	});
}

/** RGBA on the pasteboard canvas at a point on screen (after it's drawn). */
async function pasteboardAt(page: Page, x: number, y: number): Promise<number[]> {
	await frames(page);
	return page.evaluate(
		({ x, y }) => {
			const c = document.querySelector('canvas.pasteboard') as HTMLCanvasElement;
			const r = c.getBoundingClientRect();
			const k = c.width / r.width;
			const s = (window as unknown as { __scenes: { player: { readPasteboardPixel(x: number, y: number): number[] } } }).__scenes;
			return s.player.readPasteboardPixel(Math.floor((x - r.left) * k), Math.floor((y - r.top) * k));
		},
		{ x, y }
	);
}

/** The most opaque pasteboard pixel over a box on screen (a grid of samples). */
async function pasteboardMaxAlpha(page: Page, b: { x: number; y: number; width: number; height: number }) {
	let max = 0;
	for (let i = 1; i < 8; i++)
		for (let j = 1; j < 4; j++) max = Math.max(max, (await pasteboardAt(page, b.x + (b.width * i) / 8, b.y + (b.height * j) / 4))[3]);
	return max;
}

/** Save the video (MP4) and read pixels at [time, x, y] (fractions of the frame), 4 × 4 averaged. */
async function savedPixels(page: Page, file: string, points: [number, number, number][]): Promise<RGB[]> {
	await page.getByRole('button', { name: 'Save video' }).click();
	const download = page.waitForEvent('download', { timeout: 120_000 });
	await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
	await (await download).saveAs(file);
	await page.keyboard.press('Escape');
	const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
		.toString()
		.trim()
		.split(',')
		.map(Number);
	return points.map(([t, x, y]) => {
		const px = Math.min(w - 4, Math.max(0, Math.floor(w * x) - 2));
		const py = Math.min(h - 4, Math.max(0, Math.floor(h * y) - 2));
		const raw = execFileSync('ffmpeg', [
			'-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1',
			'-vf', `crop=4:4:${px}:${py}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
		]);
		const sum = [0, 0, 0];
		for (let i = 0; i < 16; i++) for (let c = 0; c < 3; c++) sum[c] += raw[i * 3 + c];
		return sum.map((v) => Math.round(v / 16)) as RGB;
	});
}

const red = ([r, g, b]: RGB) => r > 180 && g < 70 && b < 70;
const dark = ([r, g, b]: RGB) => r < 90 && g < 60 && b < 60;
const blue = ([r, g, b]: RGB) => b > 170 && r < 90 && g < 90;
const yellow = ([r, g, b]: RGB) => r > 180 && g > 170 && b < 110;
const green = ([r, g, b]: RGB) => g > 140 && r < 100 && b < 100;

async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await api(page, `s => { s.defaultEasing = 'linear'; }`);
}

/** Zoom out with Ctrl + scroll over the middle of the stage, so there's room around the frame. */
async function zoomOut(page: Page, ticks = 3) {
	const s = await stage(page);
	await page.mouse.move(s.stage.x + s.stage.w / 2, s.stage.y + s.stage.h / 2);
	await page.keyboard.down('Control');
	for (let i = 0; i < ticks; i++) await page.mouse.wheel(0, 120);
	await page.keyboard.up('Control');
	await expect.poll(async () => (await stage(page)).zoom).toMatch(/^\d+%$/);
}

test.describe('Objects outside the frame', () => {
	test.setTimeout(180_000);

	test('words dragged off the left edge show faded, slide in with keyframes, and the saved video clips them', async ({ page }, info) => {
		await setup(page);
		const id = await api<string>(page, `s => {
			s.addText('caption');
			s.stopEditingText();
			const id = s.selectedId;
			s.setTextWords(id, 'HELLO THERE');
			s.setTextAnimation(id, 'none');
			s.setTextPosition(id, 0.5, 0.5);
			s.seek(0);
			return id;
		}`);
		await zoomOut(page);
		const before = await stage(page);
		const hit = page.locator('.text-box .hit').first();
		const b = (await page.locator('.text-box').first().boundingBox())!;

		// Drag it all the way off the left edge: its right edge past the frame's left edge.
		const dx = before.frame.x - (b.x + b.width) - 30;
		await hit.hover();
		await page.mouse.down();
		for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width / 2 + (dx * i) / 12, b.y + b.height / 2);
		await page.mouse.up();
		const v = await api<{ x: number }>(page, `s => s.itemValues('${id}')`);
		expect(v.x).toBeLessThan(0); // nothing keeps it inside any more
		const off = (await page.locator('.text-box').first().boundingBox())!;
		expect(off.x + off.width).toBeLessThan(before.frame.x);

		// Faded on the pasteboard: about 30% of the box's (88%) opacity.
		const alpha = await pasteboardMaxAlpha(page, off);
		expect(alpha).toBeGreaterThan(40);
		expect(alpha).toBeLessThan(110);
		await page.screenshot({ path: info.outputPath('words-off-left.png') });
		// And still selectable there: click away, then on it.
		await page.mouse.click(before.stage.x + 6, before.stage.y + 6);
		await expect(page.locator('.text-box.selected')).toHaveCount(0);
		await page.mouse.click(off.x + off.width / 2, off.y + off.height / 2);
		await expect(page.locator('.text-box.selected')).toHaveCount(1);

		// Keyframe it: off-screen at 0 s, centred at 2 s.
		await page.getByRole('group', { name: 'Keyframes' }).first().getByRole('button', { name: 'Add keyframe at the playhead' }).click();
		// When its centre is on the frame's left edge (linear easing).
		const edgeT = (2 * -v.x) / (0.5 - v.x);
		await api(page, `s => { s.seek(2); s.setTextPosition('${id}', 0.5, 0.5); s.seek(${edgeT}); }`);
		const kfs = await api<number>(page, `s => s.project.texts.find((t) => t.id === '${id}').keyframes.length`);
		expect(kfs).toBe(2);
		// On its way in, it crosses the frame's left edge: partly faded outside, partly inside.
		await frames(page);
		const mid = (await page.locator('.text-box').first().boundingBox())!;
		const s1 = await stage(page);
		expect(mid.x).toBeLessThan(s1.frame.x);
		expect(mid.x + mid.width).toBeGreaterThan(s1.frame.x);
		await page.screenshot({ path: info.outputPath('words-half-way.png') });

		if (!hasFfmpeg) return;
		const across = (t: number, cx: number) =>
			[-0.04, -0.02, 0, 0.02, 0.04].map((d) => [t, cx + d, 0.5] as [number, number, number]);
		const file = info.outputPath('slide-in.mp4');
		const px = await savedPixels(page, file, [
			// At the start: only red, right up to the left edge (nothing faded, nothing peeking in).
			[0.02, 0.01, 0.5],
			[0.02, 0.05, 0.5],
			[0.02, 0.5, 0.5],
			// At 2 s and after: the box is in the middle.
			...across(2.2, 0.5),
			// On its way: over the left edge, not yet in the middle.
			[edgeT, 0.01, 0.5],
			[edgeT, 0.5, 0.5]
		]);
		expect(px.slice(0, 3).every(red)).toBe(true);
		expect(px.slice(3, 8).some(dark)).toBe(true);
		expect(red(px[8])).toBe(false); // the words' box or letters
		expect(red(px[9])).toBe(true);
	});

	test('layers move off-screen from the right, top and bottom, slide in, and the saved video clips them', async ({ page }, info) => {
		await openNewVideo(page);
		await importViaPicker(page, ['solid-red.mp4', 'yellow.jpg', 'green.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		const ids = await api<{ card: string; photo: string; video: string }>(page, `s => {
			s.defaultEasing = 'linear';
			// Just the red scene; the photo and the video become layers.
			for (const sc of s.project.scenes.slice(1)) s.deleteScene(sc.id);
			const media = (name) => Object.values(s.media).find((m) => m.name === name).id;
			const card = s.addCardOverlay(0);
			s.setOverlayCard(card, { background: '#0000ff', rect: null });
			s.setOverlayBox(card, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
			s.setOverlayTiming(card, 0, 6);
			const photo = s.addOverlayFromMedia(media('yellow.jpg'), 0);
			s.setOverlayBox(photo, { x: 0.15, y: 0.2, w: 0.2, h: 0.2 });
			s.setOverlayTiming(photo, 0, 6);
			const video = s.addOverlayFromMedia(media('green.mp4'), 0);
			s.setOverlayBox(video, { x: 0.65, y: 0.6, w: 0.2, h: 0.2 });
			s.setOverlayTiming(video, 0, 4);
			for (const id of [card, photo, video]) {
				const o = s.project.overlays.find((x) => x.id === id);
				s.setOverlayStyle(id, { ...o.style, shadow: 'off' });
			}
			s.seek(0);
			return { card, photo, video };
		}`);
		await zoomOut(page, 4);
		const ends = { card: [0.5, 0.5], photo: [0.25, 0.3], video: [0.75, 0.7] } as const;
		const sides = { card: 'Right', photo: 'Top', video: 'Bottom' } as const;
		for (const key of ['card', 'photo', 'video'] as const) {
			const id = ids[key];
			await api(page, `s => { s.seek(0); s.select('${id}'); }`);
			const inspector = page.locator('.inspector');
			await inspector.getByRole('group', { name: 'Keyframes' }).getByRole('button', { name: 'Add keyframe at the playhead' }).click();
			await inspector.getByRole('group', { name: 'Move off-screen' }).getByRole('button', { name: sides[key] }).click();
			const v = await api<{ x: number; y: number }>(page, `s => s.itemValues('${id}')`);
			const e = await api<{ hw: number; hh: number }>(page, `s => s.itemExtent('${id}')`);
			const { width: W, height: H } = await api<{ width: number; height: number }>(page, 's => s.project.format');
			// Just outside that edge (with the keyframe at the playhead updated, not a new one).
			if (key === 'card') expect(v.x * W - e.hw).toBeCloseTo(W, 3);
			if (key === 'photo') expect(v.y * H + e.hh).toBeCloseTo(0, 3);
			if (key === 'video') expect(v.y * H - e.hh).toBeCloseTo(H, 3);
			expect(await api<number>(page, `s => s.project.overlays.find((o) => o.id === '${id}').keyframes.length`)).toBe(1);
			// It's on the pasteboard, faded, and its box is there to grab.
			const box = (await page.locator(`[data-layer-box="${id}"]`).boundingBox())!;
			const f = (await stage(page)).frame;
			const outside = box.x >= f.x + f.w - 1 || box.y + box.height <= f.y + 1 || box.y >= f.y + f.h - 1;
			expect(outside).toBe(true);
			const a = (await pasteboardAt(page, box.x + box.width / 2, box.y + box.height / 2))[3];
			expect(a).toBeGreaterThan(50);
			expect(a).toBeLessThan(100);
			// Slide in by 2 s.
			await api(page, `s => { s.seek(2); s.setItemValues('${id}', { x: ${ends[key][0]}, y: ${ends[key][1]} }); }`);
		}
		await api(page, `s => { s.deselect(); s.seek(0); }`);
		await page.screenshot({ path: info.outputPath('layers-off-screen.png') });

		if (!hasFfmpeg) return;
		const px = await savedPixels(page, info.outputPath('layers.mp4'), [
			// At the start, nothing in the frame, right up to the edges.
			[0.02, 0.98, 0.5],
			[0.02, 0.25, 0.02],
			[0.02, 0.75, 0.98],
			[0.02, 0.5, 0.5],
			// At 2 s each is in place.
			[2.2, 0.5, 0.5],
			[2.2, 0.25, 0.3],
			[2.2, 0.75, 0.7],
			// Half-way the card is coming in from the right (centre 0.8, from 1.1 to 0.5).
			[1.0, 0.8, 0.5],
			[1.0, 0.6, 0.5]
		]);
		expect(px.slice(0, 4).every(red)).toBe(true);
		expect(blue(px[4])).toBe(true);
		expect(yellow(px[5])).toBe(true);
		expect(green(px[6])).toBe(true);
		expect(blue(px[7])).toBe(true);
		expect(red(px[8])).toBe(true);
	});

	test('snapping just outside the frame’s edges, for layers and words', async ({ page }) => {
		await setup(page);
		const card = await api<string>(page, `s => {
			const c = s.addCardOverlay(0);
			s.setOverlayBox(c, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
			s.setOverlayTiming(c, 0, 6);
			s.select(c);
			return c;
		}`);
		await zoomOut(page);
		const f = (await stage(page)).frame;
		const b = (await page.locator(`[data-layer-box="${card}"]`).boundingBox())!;
		// Drag so its right edge ends 4 px right of the frame's left edge: it snaps onto it.
		const dx = f.x + 4 - (b.x + b.width);
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width / 2 + (dx * i) / 10, b.y + b.height / 2 + 30);
		await page.mouse.up();
		const v = await api<{ x: number }>(page, `s => s.itemValues('${card}')`);
		expect(v.x + 0.1).toBeCloseTo(0, 6);
		// Below the frame: its top edge onto the frame's bottom edge.
		const b2 = (await page.locator(`[data-layer-box="${card}"]`).boundingBox())!;
		const dy = f.y + f.h - 5 - b2.y;
		await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
		await page.mouse.down();
		for (let i = 1; i <= 10; i++) await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2 + (dy * i) / 10);
		await page.mouse.up();
		const v2 = await api<{ y: number }>(page, `s => s.itemValues('${card}')`);
		expect(v2.y - 0.1).toBeCloseTo(1, 6);

		// Words: their left edge onto the frame's right edge.
		const id = await api<string>(page, `s => {
			s.addText('caption');
			s.stopEditingText();
			const id = s.selectedId;
			s.setTextAnimation(id, 'none');
			s.setTextPosition(id, 0.5, 0.5);
			s.seek(1);
			return id;
		}`);
		const t = (await page.locator('.text-box').first().boundingBox())!;
		const tx = f.x + f.w + 5 - t.x;
		await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
		await page.mouse.down();
		for (let i = 1; i <= 10; i++) await page.mouse.move(t.x + t.width / 2 + (tx * i) / 10, t.y + t.height / 2);
		await page.mouse.up();
		const w = await api<{ x: number }>(page, `s => s.itemValues('${id}')`);
		const after = (await page.locator('.text-box').first().boundingBox())!;
		expect(w.x).toBeGreaterThan(1);
		expect(Math.abs(after.x - (f.x + f.w))).toBeLessThan(1);
	});

	// Zooming and panning the stage: see stage-zoom.test.ts.

	test('boxes outside the stage are cut off: they never catch clicks on the panels around it', async ({ page }) => {
		await setup(page);
		const card = await api<string>(page, `s => {
			const c = s.addCardOverlay(0);
			s.setOverlayBox(c, { x: 1.3, y: 0.4, w: 0.2, h: 0.2 });
			s.setOverlayTiming(c, 0, 6);
			s.select(c);
			return c;
		}`);
		const st = await stage(page);
		const box = (await page.locator(`[data-layer-box="${card}"]`).boundingBox())!;
		// Its box reaches past the stage's right edge (at Fit, it's well outside the frame).
		expect(box.x + box.width).toBeGreaterThan(st.stage.x + st.stage.w);
		const x = Math.min(box.x + box.width - 2, st.stage.x + st.stage.w + 10);
		const hitsBox = await page.evaluate(
			({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-layer-box]'),
			{ x, y: box.y + box.height / 2 }
		);
		expect(hitsBox).toBe(false);
	});
});
