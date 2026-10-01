import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fixture, importViaPicker, openNewVideo, seekTo } from './helpers';

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

/** RMS of the app's own mix (what playback and export use) over [from, to). */
const loudness = (page: Page, from: number, to: number) =>
	page.evaluate(
		async ({ from, to }) => {
			const s = (window as unknown as { __scenes: { mixdown(a: number, b: number): Promise<AudioBuffer> } }).__scenes;
			const data = (await s.mixdown(from, to)).getChannelData(0);
			let sum = 0;
			for (const v of data) sum += v * v;
			return Math.sqrt(sum / data.length);
		},
		{ from, to }
	);

async function settled(locator: Locator) {
	let last = '';
	await expect
		.poll(async () => {
			const now = JSON.stringify(await locator.boundingBox());
			const same = now === last;
			last = now;
			return same;
		}, { intervals: [80] })
		.toBe(true);
	return (await locator.boundingBox())!;
}

/** The long clip (12 s, sound off) and a song from 0 s; returns the song's id. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['long.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await api(page, `s => s.setSceneVolume(s.project.scenes[0].id, 0)`);
	await page.getByRole('button', { name: /^Sound Music/ }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: /^Music Add a song/ }).click();
	await (await chooser).setFiles(fixture('music.m4a'));
	await expect(page.locator('.item-slot.sound')).toHaveCount(1);
	await page.keyboard.press('Escape');
	// No automatic fades, so loudness is easy to compare.
	return api<string>(page, `s => { const id = s.project.sounds[0].id; s.setSoundFades(id, 0, 0); return id; }`);
}

const points = (page: Page, id: string) =>
	api<{ id: string; time: number; values: { gain: number }; easing: { kind: string } }[]>(
		page,
		`s => s.project.sounds.find((x) => x.id === '${id}').volumePoints ?? []`
	);

test.describe('Volume points (rubber band)', () => {
	test.setTimeout(180_000);

	test('lower the music with points: click the line, drag down (dB shown), it sounds quieter there', async ({ page }, info) => {
		const id = await setup(page);
		const slot = page.locator(`.item-slot.sound[data-item-id="${id}"]`);
		const box = await settled(slot);
		const pps = (await settled(page.locator('.card-slot').first())).width / 12;
		const line = page.locator(`[data-volume-line="${id}"] .hit`);
		await expect(line).toBeAttached();
		const lineY = async () => {
			const b = (await page.locator(`[data-volume-line="${id}"] .line`).boundingBox())!;
			return b.y + b.height / 2;
		};
		// Points at 4 s and 5 s on the line (0 dB), then the 5 s one down, and one at 8 s and 9 s
		// back up: quieter from 5 s to 8 s.
		const at = (t: number) => box.x + t * pps;
		const y0 = await lineY();
		for (const t of [4, 9]) await page.mouse.click(at(t), y0);
		expect((await points(page, id)).map((p) => Math.round(p.time))).toEqual([4, 9]);
		// Click at 5 s and drag that new point down; the dB label shows while dragging.
		await page.mouse.move(at(5), y0);
		await page.mouse.down();
		await page.mouse.move(at(5), y0 + 18, { steps: 6 });
		await expect(page.getByTestId('volume-db')).toHaveText(/^−\d+\.\d dB$/);
		await page.mouse.up();
		const low = (await points(page, id)).find((p) => Math.round(p.time) === 5)!;
		expect(low.values.gain).toBeLessThan(0.3);
		// A point at 8 s brought down to the same low level: find the line there, press and drag.
		const lowY = (await page.locator(`[data-volume-point="${low.id}"]`).boundingBox())!;
		const yAt8 = await page.evaluate(
			({ x, top, bottom }) => {
				for (let y = top; y <= bottom; y++) {
					const el = document.elementFromPoint(x, y);
					if (el?.classList.contains('hit')) return y + 2;
				}
				return -1;
			},
			{ x: at(8), top: box.y, bottom: box.y + box.height }
		);
		expect(yAt8).toBeGreaterThan(0);
		await page.mouse.move(at(8), yAt8);
		await page.mouse.down();
		await page.mouse.move(at(8), lowY.y + lowY.height / 2, { steps: 6 });
		await page.mouse.up();
		expect((await points(page, id)).length).toBe(4);

		const quiet = await loudness(page, 6, 7);
		const loud = await loudness(page, 1, 2);
		expect(quiet).toBeLessThan(loud * 0.4);
		// Multiplies with the clip's own volume.
		const v0 = await api<number>(page, `s => s.project.sounds[0].volume`);
		await api(page, `s => s.setSoundVolume('${id}', ${v0 / 2})`);
		expect(await loudness(page, 1, 2)).toBeCloseTo(loud * 0.5, 2);
		expect(await loudness(page, 6, 7)).toBeCloseTo(quiet * 0.5, 2);
		await api(page, `s => s.setSoundVolume('${id}', ${v0})`);

		// The waveform looks smaller where it's quieter.
		const ink = await slot.locator('canvas').evaluate((c: HTMLCanvasElement) => {
			const ctx = c.getContext('2d')!;
			const column = (fx: number) => {
				const d = ctx.getImageData(Math.floor(c.width * fx), 0, 1, c.height).data;
				let n = 0;
				for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
				return n;
			};
			let a = 0;
			let b = 0;
			for (let k = 0; k < 20; k++) {
				a = Math.max(a, column(0.05 + k * 0.01));
				b = Math.max(b, column(0.5 + k * 0.01));
			}
			return { loud: a, quiet: b };
		});
		expect(ink.quiet).toBeLessThan(ink.loud * 0.6);

		// The saved video sounds the same (ffmpeg measures it).
		if (!hasFfmpeg) return;
		await page.getByRole('button', { name: 'Save video' }).click();
		await page.getByRole('radio', { name: /Small file/ }).click();
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('volume.mp4');
		await (await download).saveAs(file);
		const rms = (from: number) => {
			const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', '1', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
			let sum = 0;
			const n = pcm.length / 2;
			for (let k = 0; k < n; k++) sum += (pcm.readInt16LE(k * 2) / 32768) ** 2;
			return Math.sqrt(sum / n);
		};
		expect(rms(6) / rms(1)).toBeCloseTo(quiet / loud, 1);
	});

	test('points select, delete, take an easing (the line follows), copy and paste like keyframes', async ({ page }) => {
		const id = await setup(page);
		await api(page, `s => {
			s.addVolumePoint('${id}', 2, 1);
			s.addVolumePoint('${id}', 4, 0.1);
			s.addVolumePoint('${id}', 6, 1);
		}`);
		const [a, b] = await points(page, id);
		// Linear halfway between 2 s (1.0) and 4 s (0.1).
		expect(await api<number>(page, `s => s.volumeAtTime('${id}', 3)`)).toBeCloseTo(0.55, 2);
		// Hold from the first point: stays at 1.0 until 4 s.
		await page.locator(`[data-volume-point="${a.id}"]`).click({ button: 'right' });
		const menu = page.getByRole('menu', { name: 'Volume point' });
		await expect(menu.getByRole('menuitem')).toHaveCount(7); // 5 easings, Copy, Delete
		await menu.getByRole('menuitem', { name: 'Hold' }).click();
		expect(await api<number>(page, `s => s.volumeAtTime('${id}', 3.9)`)).toBeCloseTo(1, 3);
		// Ease in: below linear halfway.
		await page.locator(`[data-volume-point="${a.id}"]`).click({ button: 'right' });
		await menu.getByRole('menuitem', { name: 'Ease in', exact: true }).click();
		expect(await api<number>(page, `s => s.volumeAtTime('${id}', 3)`)).toBeGreaterThan(0.6);

		// Select two (Shift), delete with the key.
		await page.locator(`[data-volume-point="${a.id}"]`).click();
		await page.locator(`[data-volume-point="${b.id}"]`).click({ modifiers: ['Shift'] });
		await page.keyboard.press(`${mod}+c`);
		await page.keyboard.press('Delete');
		expect((await points(page, id)).length).toBe(1);
		// Paste them back at 8 s on the same song (first at the playhead, spacing kept).
		await page.locator(`.item-slot.sound[data-item-id="${id}"] .item`).click({ position: { x: 5, y: 25 } });
		await seekTo(page, 8);
		await page.keyboard.press(`${mod}+v`);
		const after = await points(page, id);
		expect(after.map((p) => Math.round(p.time * 100) / 100)).toEqual([6, 8, 10]);
		expect(after[1].easing.kind).toBe('bezier');
		expect(after[2].values.gain).toBeCloseTo(0.1);
	});

	test('splitting a song keeps its volume line exactly', async ({ page }) => {
		const id = await setup(page);
		await api(page, `s => {
			s.addVolumePoint('${id}', 2, 1);
			s.addVolumePoint('${id}', 6, 0.2);
			s.setKeyframeEasing('${id}', s.project.sounds[0].volumePoints.map((p) => p.id), { kind: 'bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 }, undefined, 'volume');
		}`);
		const times = Array.from({ length: 40 }, (_, i) => 0.2 + i * 0.2);
		const before = await api<number[]>(page, `s => ${JSON.stringify(times)}.map((t) => s.volumeAtTime('${id}', t))`);
		const loudBefore = await loudness(page, 3, 5);
		await page.locator(`.item-slot.sound[data-item-id="${id}"] .item`).click({ position: { x: 5, y: 25 } });
		await seekTo(page, 3.3);
		await page.keyboard.press('s');
		expect(await api<number>(page, 's => s.project.sounds.length')).toBe(2);
		const after = await api<number[]>(page, `s => ${JSON.stringify(times)}.map((t) => {
			const x = s.project.sounds.find((x) => t >= x.start - 1e-9 && t < x.start + x.duration) ?? s.project.sounds[1];
			return s.volumeAtTime(x.id, t);
		})`);
		after.forEach((g, i) => expect(g, `t=${times[i]}`).toBeCloseTo(before[i], 4));
		expect(await loudness(page, 3, 5)).toBeCloseTo(loudBefore, 2);
	});

	test('video layers with their sound on, and video scenes, have the line too', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		const scene = await api<string>(page, 's => s.project.scenes[0].id');
		await expect(page.locator(`[data-volume-line="${scene}"]`)).toBeAttached();
		const layer = await api<string>(page, `s => {
			const m = Object.values(s.media).find((x) => x.name === 'green.mp4');
			const id = s.addOverlayFromMedia(m.id, 0);
			return id;
		}`);
		await expect(page.locator(`[data-volume-line="${layer}"]`)).toHaveCount(0);
		await api(page, `s => s.setOverlaySound('${layer}', { on: true, volume: 1 })`);
		await expect(page.locator(`[data-volume-line="${layer}"]`)).toBeAttached();
		// A point on the scene's sound silences it from there (the 440 Hz red clip).
		const before = await loudness(page, 1, 2);
		await api(page, `s => { s.addVolumePoint('${scene}', 0.5, 1); s.addVolumePoint('${scene}', 0.9, 0); s.setOverlaySound('${layer}', { on: false, volume: 1 }); }`);
		expect(before).toBeGreaterThan(0.01);
		expect(await loudness(page, 1, 2)).toBeLessThan(0.002);
	});
});
