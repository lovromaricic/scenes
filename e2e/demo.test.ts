import { expect, test, type Page } from '@playwright/test';
import { scenes } from './helpers';

/**
 * The demo that ships with the app ("Casa Rossa", a 23-second ad with a voiceover, made by scripts/build-demo.ts):
 * a card on the home screen that always opens a new, editable copy.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;

type RGB = [number, number, number];
async function pixel(page: Page, x: number, y: number): Promise<RGB> {
	await expect.poll(() => scenes(page, (s) => s.player.isFrameReady()), { timeout: 20_000 }).toBe(true);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	return page.evaluate(
		({ x, y }) => {
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const s = (window as unknown as { __scenes: { player: { readPixel(x: number, y: number): number[] } } }).__scenes;
			const p = s.player.readPixel(Math.floor((c.width * x) / 1920), Math.floor((c.height * y) / 1080));
			return [p[0], p[1], p[2]] as RGB;
		},
		{ x, y }
	);
}

async function openDemo(page: Page) {
	await page.goto('/');
	const card = page.getByRole('button', { name: /^Demo: Casa Rossa/ });
	await card.click();
	await expect(page).toHaveURL(/\/edit\/[^/?]+$/);
	await expect(page.getByRole('button', { name: /^Scene 6, / })).toBeVisible({ timeout: 60_000 });
	return page.url().split('/edit/')[1];
}

test.describe('The demo', () => {
	test.setTimeout(180_000);

	test('the home screen shows it; opening it makes an editable copy with everything in it', async ({ page }) => {
		await page.goto('/');
		const card = page.getByRole('button', { name: /^Demo: Casa Rossa/ });
		await expect(card).toContainText('Casa Rossa · 23 sec ad');
		await expect(card).toContainText('Demo');
		// Its picture loads.
		await expect.poll(() => card.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
		await page.screenshot({ path: test.info().outputPath('home.png') });

		await openDemo(page);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Casa Rossa ad');
		const summary = await api<{
			duration: number;
			format: object;
			scenes: string[];
			overlays: number;
			texts: number;
			sounds: { kind: string; start: number }[];
			tracks: string[];
			transitions: string[];
		}>(
			page,
			`s => ({
				duration: s.duration,
				format: s.project.format,
				scenes: s.project.scenes.map((x) => x.kind),
				overlays: s.project.overlays.length,
				texts: s.project.texts.length,
				sounds: s.project.sounds.map((x) => ({ kind: x.kind, start: x.start })),
				tracks: s.project.tracks.map((t) => t.name),
				transitions: s.project.scenes.map((x) => x.transition.kind)
			})`
		);
		expect(summary.duration).toBeCloseTo(23, 3);
		expect(summary.format).toEqual({ preset: 'landscape', width: 1920, height: 1080, fps: 24 });
		expect(summary.scenes).toEqual(['card', 'video', 'video', 'card', 'video', 'photo']);
		expect(summary.transitions).toEqual(['slide', 'crossfade', 'cut', 'zoom', 'crossfade', 'cut']);
		expect(summary.overlays).toBe(8);
		expect(summary.texts).toBe(17);
		// The music, and the voiceover's six lines where they're said.
		expect(summary.sounds).toEqual([
			{ kind: 'music', start: 0 },
			...[0.2, 3.9, 9, 13.5, 16.9, 19.85].map((start) => ({ kind: 'voice', start }))
		]);
		expect(summary.tracks).toContain('Headlines');
		expect(summary.tracks).toContain('Shade');
		expect(summary.tracks).not.toContain('Picture-in-picture');
		expect(summary.tracks.slice(-2)).toEqual(['Voiceover', 'Music']);

		// It plays: the tomatoes at 15 s, red in the middle of the big one, and the card's ink
		// (not a black square) in its transparent corner.
		await api(page, 's => s.seek(15)');
		const tomato = await pixel(page, 760, 560);
		expect(tomato[0]).toBeGreaterThan(150);
		expect(tomato[1]).toBeLessThan(110);
		const corner = await pixel(page, 530, 790);
		expect(corner.every((c) => c < 60)).toBe(true);
		expect(corner[0] + corner[1] + corner[2]).toBeGreaterThan(30);
		await page.screenshot({ path: test.info().outputPath('demo-15.png') });

		// It's the user's own: editable and saved.
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await api(page, `s => s.rename(s.project.scenes[0].id, 'My opening')`);
		await expect(page.getByRole('button', { name: /^Scene 1, My opening/ })).toBeVisible();
		await expect(page.getByText('Saved on this device')).toBeVisible({ timeout: 15_000 });
	});

	test('every time it opens, it is a new copy: the demo itself never changes', async ({ page }) => {
		const first = await openDemo(page);
		await api(page, `s => s.rename(s.project.scenes[0].id, 'Changed')`);
		await expect(page.getByText('Saved on this device')).toBeVisible({ timeout: 15_000 });

		const second = await openDemo(page);
		expect(second).not.toBe(first);
		// The new copy is as the demo was.
		await expect(page.getByRole('button', { name: /^Scene 1, Fresh, simple, Italian/ })).toBeVisible();

		// Both are in the user's videos, with the demo's picture.
		await page.goto('/');
		await expect(page.getByRole('article', { name: 'Casa Rossa ad' })).toHaveCount(2);
		await expect(page.getByRole('button', { name: /^Demo: Casa Rossa/ })).toBeVisible();
	});

	test('it plays through in the editor in real time, without stalls, and stops at 23 s', async ({ page }) => {
		await openDemo(page);
		await api(page, 's => s.seek(0)');
		await expect.poll(() => scenes(page, (s) => s.player.isFrameReady()), { timeout: 20_000 }).toBe(true);
		// Watch the playhead on every frame while it plays.
		const run = await page.evaluate(
			() =>
				new Promise<{ wall: number; end: number; longestStall: number; frames: number }>((done) => {
					const s = (window as unknown as { __scenes: { time: number; playing: boolean; togglePlay(): void } }).__scenes;
					const t0 = performance.now();
					let last = { at: t0, time: 0 };
					let longestStall = 0;
					let frames = 0;
					s.togglePlay();
					const tick = () => {
						const now = performance.now();
						frames++;
						if (s.time !== last.time) {
							// Only stalls after the start count (audio may take a moment to begin).
							if (s.time > 0.3) longestStall = Math.max(longestStall, now - last.at);
							last = { at: now, time: s.time };
						}
						if (!s.playing && now - t0 > 500) done({ wall: (now - t0) / 1000, end: s.time, longestStall, frames });
						else requestAnimationFrame(tick);
					};
					requestAnimationFrame(tick);
				})
		);
		expect(run.end).toBeGreaterThan(22.9);
		// Real time (a little slack for starting up).
		expect(run.wall).toBeGreaterThan(22.5);
		expect(run.wall).toBeLessThan(25);
		// The picture never froze for long.
		expect(run.longestStall).toBeLessThan(250);
		test.info().annotations.push({ type: 'playback', description: JSON.stringify(run) });
	});
});
