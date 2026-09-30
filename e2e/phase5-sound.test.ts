import { expect, test, type Page } from '@playwright/test';
import { fixture, importViaPicker, scenes, seekTo, openNewVideo } from './helpers';

/**
 * Renders the mix for [from, to) with the app's own offline mixer and measures how loud each
 * test tone is (Goertzel filter), so we can check volumes, fades and timing precisely.
 */
async function tones(page: Page, from: number, to: number, freqs = [220, 440, 660]) {
	return page.evaluate(
		async ({ from, to, freqs }) => {
			const s = (
				window as unknown as { __scenes: { mixdown(a: number, b: number): Promise<AudioBuffer> } }
			).__scenes;
			const buffer = await s.mixdown(from, to);
			const data = buffer.getChannelData(0);
			const rate = buffer.sampleRate;
			const out: Record<number, number> = {};
			for (const f of freqs) {
				const k = 2 * Math.cos((2 * Math.PI * f) / rate);
				let s0 = 0,
					s1 = 0,
					s2 = 0;
				for (let i = 0; i < data.length; i++) {
					s0 = data[i] + k * s1 - s2;
					s2 = s1;
					s1 = s0;
				}
				out[f] = Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / data.length;
			}
			let sum = 0;
			for (const v of data) sum += v * v;
			out[0] = Math.sqrt(sum / data.length);
			return out;
		},
		{ from, to, freqs }
	);
}

type Sound = {
	id: string;
	kind: string;
	start: number;
	duration: number;
	volume: number;
	fade: boolean;
};
const sounds = (page: Page) =>
	scenes(page, (s) =>
		(s as unknown as { project: { sounds: Sound[] } }).project.sounds.map((x) => ({ ...x }))
	);

test.describe('Phase 5: sound', () => {
	test('music mixes with clip sound at the chosen volumes and fades at the ends', async ({
		page
	}) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();

		// Add music from the Sound panel.
		await page.getByRole('button', { name: /^Sound/ }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: /^Music/ }).click();
		await (await chooser).setFiles(fixture('music.m4a'));
		const pill = page.getByRole('button', { name: /^Music: music, 10s/ });
		await expect(pill).toBeVisible();
		// It stops at the end of the 10s video even though the song is 12s, and has a waveform.
		await expect(pill.locator('canvas')).toBeVisible();

		// Music at 30%, the first scene's own sound at 50%.
		await pill.click();
		const musicVolume = page.getByRole('slider', { name: 'Music volume' });
		await musicVolume.fill('0.3');
		await page.getByRole('button', { name: /^Scene 1, Red/ }).click();
		await page.getByRole('slider', { name: 'Clip sound volume' }).fill('0.5');
		await expect.poll(async () => (await sounds(page))[0].volume).toBeCloseTo(0.3);

		// In the middle of scene 1, both tones are there at the chosen balance (same source level).
		const mid = await tones(page, 2, 3);
		expect(mid[220] / mid[440]).toBeGreaterThan(0.6 * 0.8);
		expect(mid[220] / mid[440]).toBeLessThan(0.6 * 1.25);
		// In scene 2 the clip tone changes to 660 Hz; the music carries on.
		const scene2 = await tones(page, 5, 6);
		expect(scene2[660]).toBeGreaterThan(scene2[440] * 10);
		expect(scene2[220]).toBeGreaterThan(mid[220] * 0.9);

		// Fades: very quiet in the first and last moments, full in the middle.
		const start = await tones(page, 0, 0.15);
		const end = await tones(page, 9.85, 10);
		expect(start[220]).toBeLessThan(mid[220] * 0.15);
		expect(end[220]).toBeLessThan(mid[220] * 0.15);

		// Turning the fade off makes the music start at full volume.
		await pill.click();
		await page.getByRole('switch', { name: /Fade in and out/ }).click();
		const noFade = await tones(page, 0.05, 0.2);
		expect(noFade[220]).toBeGreaterThan(mid[220] * 0.8);

		// It also plays live, mixed with the clips.
		await seekTo(page, 1);
		await page.keyboard.press('Space');
		await expect
			.poll(() => scenes(page, (s) => s.player.audioStats().scheduled))
			.toBeGreaterThan(0);
		await page.keyboard.press('Space');
	});

	test('a recorded voiceover plays back where it was recorded', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		// Mute the clips so only the voice is left in the mix.
		for (const n of [1, 2, 3]) {
			await page.getByRole('button', { name: new RegExp(`^Scene ${n}, `) }).click();
			await page.getByRole('slider', { name: 'Clip sound volume' }).fill('0');
		}

		await seekTo(page, 4);
		await page.getByRole('button', { name: /^Sound/ }).click();
		await page.getByRole('button', { name: /^Voiceover/ }).click();
		await expect(page.getByText('Get ready to speak…')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 5000 });
		await page.waitForTimeout(2000);
		await page.getByRole('button', { name: 'Stop' }).click();

		const voice = page.getByRole('button', { name: /^Voiceover: Voiceover 1/ });
		await expect(voice).toBeVisible();
		const [recorded] = await sounds(page);
		expect(recorded.kind).toBe('voice');
		expect(recorded.start).toBeCloseTo(4, 1);
		expect(recorded.duration).toBeGreaterThan(1.5);
		expect(recorded.duration).toBeLessThan(3);

		// The fake microphone's sound is in the mix only where the voiceover sits.
		const before = await tones(page, 1, 3.9);
		const during = await tones(page, 4.1, 4 + recorded.duration - 0.1);
		expect(before[0]).toBeLessThan(0.001);
		expect(during[0]).toBeGreaterThan(0.005);

		// Drag the voiceover 2 seconds later.
		const pps = await page.evaluate(() => {
			const card = document.querySelector('.card-slot') as HTMLElement;
			return card.getBoundingClientRect().width / 4;
		});
		const box = (await voice.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + pps * 2, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		expect((await sounds(page))[0].start).toBeCloseTo(6, 0);
	});
});
