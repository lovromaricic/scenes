import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, scenes, seekTo } from './helpers';
import { applyGrade, MOOD_GRADES } from '../src/lib/model/moods';

type RGB = [number, number, number];

/** Pixel of the preview at a relative position, once the frames at the playhead are decoded. */
async function pixel(page: Page, fx = 0.6, fy = 0.6): Promise<RGB> {
	await expect
		.poll(() => scenes(page, (s) => s.player.isFrameReady()), { timeout: 10_000 })
		.toBe(true);
	await page.evaluate(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
	);
	return page.evaluate(
		({ fx, fy }) => {
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const s = (
				window as unknown as { __scenes: { player: { readPixel(x: number, y: number): number[] } } }
			).__scenes;
			const p = s.player.readPixel(Math.floor(c.width * fx), Math.floor(c.height * fy));
			return [p[0], p[1], p[2]] as RGB;
		},
		{ fx, fy }
	);
}

const near = (a: RGB, b: RGB, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const RED: RGB = [255, 0, 0];
const BLUE: RGB = [0, 0, 255];

async function setTransition(page: Page, name: string) {
	await page.getByRole('button', { name: /Transition between scene 1 and 2/ }).click();
	await page
		.getByRole('dialog', { name: /Transition between/ })
		.getByRole('radio', { name: new RegExp(`^${name}`) })
		.click();
	await expect(page.getByRole('dialog', { name: /Transition between/ })).toHaveCount(0);
}

test.describe('Phase 6: transitions and looks', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// Red (4s) then blue (3s): the cut is at 4s.
		await importViaPicker(page, ['red.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	});

	test('each transition looks right when scrubbing through it', async ({ page }) => {
		// Cut: straight from red to blue.
		await seekTo(page, 3.9);
		expect(near(await pixel(page), RED)).toBe(true);
		await seekTo(page, 4.05);
		expect(near(await pixel(page), BLUE)).toBe(true);

		// Crossfade: half-way through, an even blend of both.
		await setTransition(page, 'Crossfade');
		await seekTo(page, 4);
		expect(near(await pixel(page), [128, 0, 128], 35)).toBe(true);
		await seekTo(page, 3.2);
		expect(near(await pixel(page), RED)).toBe(true);
		await seekTo(page, 4.8);
		expect(near(await pixel(page), BLUE)).toBe(true);

		// Fade to black: dark in the middle.
		await setTransition(page, 'Fade to black');
		await seekTo(page, 4);
		expect(near(await pixel(page), [0, 0, 0], 20)).toBe(true);

		// Slide: half-way, the left half is still red and the right half is already blue.
		await setTransition(page, 'Slide');
		await seekTo(page, 4);
		expect(near(await pixel(page, 0.25, 0.6), RED)).toBe(true);
		expect(near(await pixel(page, 0.75, 0.6), BLUE)).toBe(true);

		// Zoom: a blend in the middle.
		await setTransition(page, 'Zoom');
		await seekTo(page, 4);
		const z = await pixel(page);
		expect(z[0]).toBeGreaterThan(60);
		expect(z[2]).toBeGreaterThan(60);

		// Undo steps back through the transitions.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+z`);
		await seekTo(page, 4);
		expect(near(await pixel(page, 0.75, 0.6), BLUE)).toBe(true);
		expect(near(await pixel(page, 0.25, 0.6), RED)).toBe(true);
	});

	test('a crossfade blends during playback', async ({ page }) => {
		await setTransition(page, 'Crossfade');
		await seekTo(page, 3.3);
		await pixel(page);
		await page.keyboard.press('Space');
		const samples: RGB[] = await page.evaluate(async () => {
			const s = (
				window as unknown as {
					__scenes: { time: number; player: { readPixel(x: number, y: number): number[] } };
				}
			).__scenes;
			const c = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
			const out: RGB[] = [];
			const t0 = performance.now();
			while (performance.now() - t0 < 1600) {
				await new Promise((r) => requestAnimationFrame(r));
				if (s.time > 3.7 && s.time < 4.3) {
					const p = s.player.readPixel(Math.floor(c.width * 0.6), Math.floor(c.height * 0.6));
					out.push([p[0], p[1], p[2]]);
				}
			}
			return out;
			type RGB = [number, number, number];
		});
		await page.keyboard.press('Space');
		const blended = samples.filter(([r, , b]) => r > 50 && b > 50);
		expect(samples.length).toBeGreaterThan(10);
		expect(blended.length).toBeGreaterThan(samples.length / 3);
	});

	test('looks colour the whole video, and a scene can have its own', async ({ page }) => {
		// A look for the whole video. The GPU result must match the grade maths exactly.
		const graded = (rgb: RGB, mood: keyof typeof MOOD_GRADES) =>
			applyGrade(rgb.map((v) => v / 255) as RGB, MOOD_GRADES[mood]).map((v) =>
				Math.round(v * 255)
			) as RGB;
		await seekTo(page, 5);
		const natural = await pixel(page);
		await page.getByRole('button', { name: /^Looks/ }).click();
		await page
			.getByRole('complementary', { name: 'Add' })
			.getByRole('radio', { name: 'Golden' })
			.click();
		const golden = await pixel(page);
		expect(near(golden, graded(natural, 'golden'), 4)).toBe(true);
		expect(near(golden, natural, 5)).toBe(false);
		await page.keyboard.press('Escape');

		// Scene 1 gets its own look: black and white turns red into grey.
		await seekTo(page, 2);
		const red = await pixel(page);
		expect(near(red, graded(RED, 'golden'), 6)).toBe(true);
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page
			.getByRole('radiogroup', { name: 'Mood' })
			.getByRole('radio', { name: 'B & W' })
			.click();
		await seekTo(page, 2);
		const [r, g, b] = await pixel(page);
		expect(Math.abs(r - g)).toBeLessThan(8);
		expect(Math.abs(g - b)).toBeLessThan(8);
		// …while scene 2 still follows the whole video (Golden).
		await seekTo(page, 5);
		expect(near(await pixel(page), golden, 6)).toBe(true);

		// Back to following the whole video.
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page.getByRole('button', { name: 'Match the whole video' }).click();
		await seekTo(page, 2);
		expect(near(await pixel(page), red, 4)).toBe(true);
	});
});
