import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * The clock shows hundredths (or seconds and frames, on click, remembered on this device) with
 * steady digits; the loop button repeats the whole video, or the range, seamlessly in picture
 * and sound; Ctrl/Cmd+L; remembered per project; Watch loops too.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const clockText = async (page: Page) => (await page.getByTestId('clock').textContent())!.replace(/\s+/g, ' ').trim();

async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
}

type Sample = { t: number; drawn: number | null; playing: boolean; scheduled: number; at: number };

/** Play and record, every animation frame for `ms`: the time, the picture's time, the sound. */
async function record(page: Page, ms: number): Promise<Sample[]> {
	return page.evaluate(async (ms) => {
		const s = (window as unknown as {
			__scenes: {
				time: number;
				playing: boolean;
				player: { drawnTime: number | null; audioStats(): { scheduled: number } };
			};
		}).__scenes;
		const out: Sample[] = [];
		const start = performance.now();
		await new Promise<void>((done) => {
			const tick = () => {
				out.push({ t: s.time, drawn: s.player.drawnTime, playing: s.playing, scheduled: s.player.audioStats().scheduled, at: performance.now() });
				if (performance.now() - start < ms) requestAnimationFrame(tick);
				else done();
			};
			requestAnimationFrame(tick);
		});
		return out;
	}, ms);
}

/** Where the time jumped back (wraps), and the biggest step forward between frames otherwise. */
function analyse(samples: Sample[]) {
	const wraps: number[] = [];
	let biggestStep = 0;
	for (let i = 1; i < samples.length; i++) {
		const d = samples[i].t - samples[i - 1].t;
		if (d < -0.05) wraps.push(i);
		else biggestStep = Math.max(biggestStep, d);
	}
	return { wraps, biggestStep };
}

test.describe('Playback: the clock and looping', () => {
	test.setTimeout(120_000);

	test('the clock: hundredths, frames on click (remembered), steady while playing; timeline labels follow', async ({ page }) => {
		await setup(page);
		expect(await clockText(page)).toBe('0:00.00 of 0:04.00');
		await api(page, 's => s.seek(2.45)');
		await expect.poll(() => clockText(page)).toBe('0:02.45 of 0:04.00');

		// Click: seconds and frames at 30 fps (2.45 s is frame 73: 2 s and 13 frames).
		await page.getByTestId('clock').click();
		await expect.poll(() => clockText(page)).toBe('0:02:13 of 0:04:00');
		// Remembered on this device.
		await page.reload();
		await expect(page.getByTestId('clock')).toBeVisible();
		await api(page, 's => s.seek(1)');
		await expect.poll(() => clockText(page)).toBe('0:01:00 of 0:04:00');

		// While playing: every frame shows a well-formed time, and the clock never changes width.
		await page.getByTestId('clock').click(); // back to hundredths
		await api(page, 's => { s.seek(0); s.togglePlay(); }');
		const widths = await page.evaluate(async () => {
			const el = document.querySelector('[data-testid="clock"]') as HTMLElement;
			const out: { w: number; text: string }[] = [];
			const start = performance.now();
			await new Promise<void>((done) => {
				const tick = () => {
					out.push({ w: el.getBoundingClientRect().width, text: el.textContent!.replace(/\s+/g, ' ').trim() });
					if (performance.now() - start < 1200) requestAnimationFrame(tick);
					else done();
				};
				requestAnimationFrame(tick);
			});
			return out;
		});
		await api(page, 's => { if (s.playing) s.togglePlay(); }');
		expect(new Set(widths.map((x) => x.text)).size).toBeGreaterThan(20); // it ran
		for (const x of widths) expect(x.text).toMatch(/^0:0\d\.\d\d of 0:04\.00$/);
		expect(Math.max(...widths.map((x) => x.w)) - Math.min(...widths.map((x) => x.w))).toBeLessThan(0.5);

		// The timeline's live label while moving an item uses the same format.
		const id = await api<string>(page, `s => { s.addText('caption'); s.stopEditingText(); const id = s.selectedId; s.setTextTiming(id, 0.5, 2); return id; }`);
		const item = page.locator(`[data-item-id="${id}"] .item`);
		const dragLabel = async () => {
			const b = (await item.boundingBox())!;
			await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
			await page.mouse.down();
			await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2, { steps: 5 });
			const text = (await page.getByTestId('item-drag-label').textContent())!.trim();
			await page.mouse.up();
			return text;
		};
		expect(await dragLabel()).toMatch(/^0:0\d\.\d\d$/);
		await page.getByTestId('clock').click();
		expect(await dragLabel()).toMatch(/^0:0\d:\d\d$/);
	});

	test('loop repeats the whole video seamlessly, in picture and sound', async ({ page }, info) => {
		await setup(page);
		const loop = page.getByRole('button', { name: /^Loop/ });
		await expect(loop).toHaveAttribute('aria-pressed', 'false');
		await loop.click();
		await expect(loop).toHaveAttribute('aria-pressed', 'true');
		await api(page, 's => s.seek(2.45)');
		await page.getByTestId('clock').screenshot({ path: info.outputPath('clock.png') });
		await page.locator('.controls').screenshot({ path: info.outputPath('controls.png') });
		await api(page, 's => { s.seek(3.2); s.togglePlay(); }');
		const samples = await record(page, 2200);
		const { wraps, biggestStep } = analyse(samples);
		expect(wraps.length).toBe(1); // back to the start once, not stopped at the end
		expect(samples.every((x) => x.playing)).toBe(true);
		const w = wraps[0];
		expect(samples[w - 1].t).toBeGreaterThan(3.8);
		expect(samples[w].t).toBeLessThan(0.2);
		// No pause: time keeps moving frame to frame, on both sides of the join.
		expect(biggestStep).toBeLessThan(0.12);
		expect(samples.at(-1)!.t).toBeGreaterThan(0.6);
		// The picture follows straight away (prepared ahead): at most a couple of frames behind.
		const behind = samples.slice(w, w + 30).filter((x) => x.drawn !== null && Math.abs(x.drawn - x.t) > 0.12);
		expect(behind.length).toBeLessThanOrEqual(3);
		// The sound carries on: buffers are playing after the join.
		expect(samples.slice(w + 5).some((x) => x.scheduled > 0)).toBe(true);
		await api(page, 's => s.togglePlay()');
	});

	test('with a range, only the range repeats; play from outside it starts at its start', async ({ page }) => {
		await setup(page);
		await api(page, 's => { s.setRange({ start: 1, end: 2 }); s.seek(3.5); }');
		await page.locator('body').click({ position: { x: 5, y: 300 } });
		await page.keyboard.press(`${mod}+l`);
		await expect(page.getByRole('button', { name: /^Loop the range/ })).toHaveAttribute('aria-pressed', 'true');
		await api(page, 's => s.togglePlay()');
		await expect.poll(() => api<number>(page, 's => s.time')).toBeLessThan(2);
		const samples = await record(page, 2600);
		const { wraps, biggestStep } = analyse(samples);
		expect(wraps.length).toBeGreaterThanOrEqual(2);
		expect(biggestStep).toBeLessThan(0.12);
		for (const x of samples) {
			expect(x.t).toBeGreaterThanOrEqual(0.98);
			expect(x.t).toBeLessThanOrEqual(2.01);
		}
		await api(page, 's => s.togglePlay()');

		// Ctrl/Cmd+L again: off.
		await page.keyboard.press(`${mod}+l`);
		await expect(page.getByRole('button', { name: /^Loop/ })).toHaveAttribute('aria-pressed', 'false');
	});

	test('remembered per project, untouched by undo; listed in the shortcuts; Watch loops too', async ({ page }) => {
		await setup(page);
		await page.getByRole('button', { name: /^Loop/ }).click();
		// An edit, then undo: loop stays on (it isn't an edit).
		await api(page, `s => { s.addText('caption'); s.stopEditingText(); }`);
		await page.locator('body').click({ position: { x: 5, y: 300 } });
		await page.keyboard.press(`${mod}+z`);
		expect(await api<boolean>(page, 's => !!s.project.loop')).toBe(true);
		await api(page, 's => s.flushSave()');
		await page.reload();
		await expect(page.getByRole('button', { name: /^Loop/ })).toHaveAttribute('aria-pressed', 'true');

		await page.keyboard.press('?');
		await expect(page.getByRole('dialog')).toContainText('Loop');
		await page.keyboard.press('Escape');

		// Watch: past the end it starts again (no "Watch again").
		await page.getByRole('button', { name: 'Watch' }).click();
		await expect(page.getByRole('button', { name: 'Back to editing' })).toBeVisible();
		await api(page, 's => { if (s.playing) s.togglePlay(); s.seek(3.4); s.togglePlay(); }');
		const samples = await record(page, 1400);
		expect(analyse(samples).wraps.length).toBe(1);
		expect(samples.every((x) => x.playing)).toBe(true);
		await expect(page.getByRole('button', { name: 'Watch again' })).toHaveCount(0);
		await expect(page.locator('.watch').getByRole('button', { name: 'Loop: on' })).toHaveAttribute('aria-pressed', 'true');
	});
});
