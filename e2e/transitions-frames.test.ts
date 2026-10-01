import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * Every frame across every transition, checked automatically: solid red and blue scenes, so the
 * centre of each frame must be exactly the expected mix of the two (or, for "fade through black",
 * the expected darkening), never black, empty or another colour.
 *
 * Ten 2-second scenes cover every ordered pair of video (V), photo (P) and card (C):
 *   V V P P C C V C P V  →  VV VP PP PC CC CV VC CP PV
 * with colours alternating red / blue. The video scenes are trimmed (spare footage before and
 * after), sped up (2×) and slowed down (0.5×).
 */

type RGB = [number, number, number];
type Kind = 'crossfade' | 'fade-black' | 'slide' | 'zoom';
const KINDS: Kind[] = ['crossfade', 'fade-black', 'slide', 'zoom'];
/** Matches TRANSITION_SECONDS in model/composition.ts. */
const LENGTH: Record<Kind, number> = { crossfade: 0.8, 'fade-black': 1.0, slide: 0.6, zoom: 0.7 };
const SCENE = 2;
const COUNT = 10;
const RED: RGB = [255, 0, 0];
const BLUE: RGB = [0, 0, 255];
const TOL = 28;

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

const color = (i: number): RGB => (i % 2 === 0 ? RED : BLUE);
const smooth = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, k: number): RGB => [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * k) as RGB;
const scale = (a: RGB, k: number): RGB => a.map((v) => v * k) as RGB;

/** The colours the centre of the frame may have at time `t` (the same math as the shader). */
function expected(kind: Kind, t: number): RGB[] {
	const d = LENGTH[kind];
	for (let k = 1; k < COUNT; k++) {
		const cut = k * SCENE;
		if (t < cut - d / 2 || t >= cut + d / 2) continue;
		const p = (t - (cut - d / 2)) / d;
		const e = smooth(0, 1, p);
		const A = color(k - 1);
		const B = color(k);
		if (kind === 'crossfade') return [mix(A, B, e)];
		if (kind === 'zoom') return [mix(A, B, smooth(0.25, 0.75, p))];
		if (kind === 'fade-black') return [p < 0.5 ? scale(A, 1 - smooth(0, 0.5, p)) : scale(B, smooth(0.5, 1, p))];
		// Slide: the centre shows A until the edge passes the middle. Right at it, the sampled
		// patch (and the saved video's smoothing) straddles the edge: some of each.
		if (Math.abs(e - 0.5) < 0.04) return [A, B, mix(A, B, 0.25), mix(A, B, 0.5), mix(A, B, 0.75)];
		return [e < 0.5 ? A : B];
	}
	return [color(Math.min(COUNT - 1, Math.floor(t / SCENE)))];
}

const near = (a: RGB, b: RGB, tol = TOL) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** Whether `px` fits time `t` (a millisecond either side, for rounding). */
const fits = (kind: Kind, t: number, px: RGB) =>
	[t, t - 0.001, t + 0.001].some((x) => expected(kind, x).some((e) => near(px, e)));

async function setup(page: Page, kind: Kind) {
	await openNewVideo(page);
	await importViaPicker(
		page,
		['solid-red.mp4', 'solid-blue.mp4', 'solid-red.png', 'solid-blue.png'],
		'Choose photos & videos'
	);
	await expect(page.getByRole('button', { name: /^Scene 4, / })).toBeVisible();
	await page.evaluate((kind) => {
		type Scene = Record<string, unknown> & { id: string; mediaId: string; kind: string };
		const s = (window as unknown as {
			__scenes: {
				project: { scenes: Scene[] };
				media: Record<string, { id: string; name: string }>;
				addCard(): void;
				edit(label: string, change: (p: { scenes: Scene[] }) => { scenes: Scene[] }): void;
				deselect(): void;
			};
		}).__scenes;
		s.addCard();
		const byName = (n: string) => {
			const m = Object.values(s.media).find((x) => x.name === n)!;
			return JSON.parse(JSON.stringify(s.project.scenes.find((x) => x.mediaId === m.id)!)) as Scene;
		};
		const cardTemplate = JSON.parse(JSON.stringify(s.project.scenes.find((x) => x.kind === 'card')!)) as Scene;
		const video = (name: string, from: number, to: number, speed: number) => ({
			...byName(name),
			sourceStart: from,
			sourceEnd: to,
			speed
		});
		const photo = (name: string) => ({ ...byName(name), sourceStart: 0, sourceEnd: 2 });
		const card = (background: string) => ({ ...cardTemplate, sourceStart: 0, sourceEnd: 2, card: { background, rect: null } });
		const list: Scene[] = [
			video('solid-red.mp4', 1.5, 3.5, 1), // trimmed: footage before and after
			video('solid-blue.mp4', 0, 4, 2), // 2×, starts at the file's start
			photo('solid-red.png'),
			photo('solid-blue.png'),
			card('#ff0000'),
			card('#0000ff'),
			video('solid-red.mp4', 0.5, 1.5, 0.5), // 0.5×
			card('#0000ff'),
			photo('solid-red.png'),
			video('solid-blue.mp4', 4, 6, 1) // ends at the file's end
		].map((sc, i, all) => ({
			...sc,
			id: crypto.randomUUID(),
			name: `T${i}`,
			mood: null,
			transition: i < all.length - 1 ? { kind, duration: 0 } : { kind: 'cut', duration: 0 }
		}));
		s.edit('Test scenes', (p) => ({ ...p, scenes: list }));
		s.deselect();
	}, kind);
	await expect(page.getByRole('button', { name: /^Scene 10, / })).toBeVisible();
	expect(await page.evaluate(() => (window as unknown as { __scenes: { duration: number } }).__scenes.duration)).toBeCloseTo(
		COUNT * SCENE,
		3
	);
}

/** Record every frame the preview draws while playing the whole video. */
function recordPlayback(page: Page) {
	return page.evaluate(async () => {
		type P = { drawnTime: number | null; readPixel(x: number, y: number): number[] | null };
		const s = (window as unknown as {
			__scenes: { player: P; playing: boolean; seek(t: number): void; togglePlay(): void; duration: number };
		}).__scenes;
		const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
		const frame = () => new Promise((r) => requestAnimationFrame(r));
		const out: { t: number; px: number[] }[] = [];
		s.togglePlay();
		let last: number | null = null;
		const started = performance.now();
		while (performance.now() - started < 60_000) {
			await frame();
			const t = s.player.drawnTime;
			if (t !== null && t !== last) {
				last = t;
				out.push({ t, px: s.player.readPixel(c.width >> 1, c.height >> 1)!.slice(0, 3) });
			}
			if (!s.playing && out.length > 10) break;
		}
		return out;
	});
}

/** Seek to every frame in turn (not waiting for exact frames) and record what's drawn. */
function recordScrub(page: Page, times: number[]) {
	return page.evaluate(async (times) => {
		type P = { drawnTime: number | null; readPixel(x: number, y: number): number[] | null };
		const s = (window as unknown as { __scenes: { player: P; seek(t: number): void } }).__scenes;
		const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
		const frame = () => new Promise((r) => requestAnimationFrame(r));
		const out: { t: number; px: number[] }[] = [];
		for (const t of times) {
			s.seek(t);
			await frame();
			await frame();
			const d = s.player.drawnTime;
			if (d !== null) out.push({ t: d, px: s.player.readPixel(c.width >> 1, c.height >> 1)!.slice(0, 3) });
		}
		return out;
	}, times);
}

function check(kind: Kind, frames: { t: number; px: number[] }[], where: string) {
	const bad = frames.filter((f) => !fits(kind, f.t, f.px as RGB));
	expect(
		bad.slice(0, 8).map((f) => `${where} ${f.t.toFixed(3)}s: got ${f.px.join(',')}, want ${expected(kind, f.t).map((e) => e.map(Math.round).join(',')).join(' or ')}`),
		`${bad.length} of ${frames.length} frames are wrong`
	).toEqual([]);
}

/** The frames one second either side of every transition, at 30 fps. */
function transitionFrames(kind: Kind): number[] {
	const d = LENGTH[kind];
	const times: number[] = [];
	for (let k = 1; k < COUNT; k++) {
		const from = k * SCENE - d / 2 - 1;
		const to = k * SCENE + d / 2 + 1;
		for (let t = Math.max(0, from); t < Math.min(COUNT * SCENE, to); t += 1 / 30) times.push(Math.round(t * 1000) / 1000);
	}
	return [...new Set(times)].sort((a, b) => a - b);
}

test.describe('Transitions are smooth, frame by frame', () => {
	test.setTimeout(240_000);

	for (const kind of KINDS) {
		test(`${kind}: preview playback, scrubbing, seeking into it, and the saved MP4`, async ({ page }, info) => {
			await setup(page, kind);

			// Playback from the start: every frame drawn.
			await page.evaluate(() => (window as unknown as { __scenes: { seek(t: number): void } }).__scenes.seek(0));
			await expect.poll(() => page.evaluate(() => (window as unknown as { __scenes: { player: { isFrameReady(): boolean } } }).__scenes.player.isFrameReady())).toBe(true);
			const played = await recordPlayback(page);
			expect(played.length).toBeGreaterThan(COUNT * SCENE * 20);
			check(kind, played, 'playing');

			// Scrubbing through every frame around each transition.
			const scrubTimes = transitionFrames(kind);
			const scrubbed = await recordScrub(page, scrubTimes);
			expect(scrubbed.length).toBe(scrubTimes.length);
			check(kind, scrubbed, 'scrubbing');

			// Seeking straight into the middle of each transition from far away.
			const middles: number[] = [];
			for (let k = 1; k < COUNT; k++) middles.push((COUNT - k) * SCENE + 0.9 - SCENE, k * SCENE + 0.05);
			const jumped = await recordScrub(page, middles);
			expect(jumped.length).toBe(middles.length);
			check(kind, jumped, 'seeking');
			// Once decoded, the middle of each transition is exactly the expected mix.
			for (let k = 1; k < COUNT; k++) {
				const mid = k * SCENE + 0.05;
				await page.evaluate((t) => (window as unknown as { __scenes: { seek(t: number): void } }).__scenes.seek(t), mid);
				await expect.poll(() => page.evaluate(() => (window as unknown as { __scenes: { player: { isFrameReady(): boolean } } }).__scenes.player.isFrameReady())).toBe(true);
				check(kind, await recordScrub(page, [mid]), 'settled');
			}

			// The saved video: every frame.
			if (!hasFfmpeg) return;
			await page.getByRole('button', { name: 'Save video' }).click();
			await page.getByRole('radio', { name: /Small file/ }).click();
			const download = page.waitForEvent('download', { timeout: 120_000 });
			await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
			const file = info.outputPath(`${kind}.mp4`);
			await (await download).saveAs(file);
			const probe = execFileSync('ffprobe', [
				'-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', file
			])
				.toString()
				.trim()
				.split(',');
			const [w, h] = [Number(probe[0]), Number(probe[1])];
			const [num, den] = probe[2].split('/').map(Number);
			const fps = num / den;
			const x = Math.floor(w / 2) - 2;
			const y = Math.floor(h / 2) - 2;
			const raw = execFileSync(
				'ffmpeg',
				['-v', 'error', '-i', file, '-vf', `crop=4:4:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
				{ maxBuffer: 64 * 1024 * 1024 }
			);
			const frames: { t: number; px: number[] }[] = [];
			for (let i = 0; i * 48 < raw.length; i++) {
				const px = [0, 1, 2].map((c) => {
					let sum = 0;
					for (let k = 0; k < 16; k++) sum += raw[i * 48 + k * 3 + c];
					return Math.round(sum / 16);
				});
				frames.push({ t: i / fps, px });
			}
			expect(frames.length).toBeGreaterThanOrEqual(Math.floor(COUNT * SCENE * fps) - 1);
			check(kind, frames, 'saved');
		});
	}
});
