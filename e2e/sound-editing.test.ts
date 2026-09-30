import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fixture, importViaPicker, openNewVideo, scenes, seekTo } from './helpers';

type Sound = { id: string; start: number; sourceStart: number; duration: number; fadeIn: number; fadeOut: number; trackId: string; volume: number };
const sounds = (page: Page) =>
	scenes(page, (s) => JSON.parse(JSON.stringify((s as unknown as { project: { sounds: Sound[] } }).project.sounds))) as Promise<Sound[]>;

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

/** RMS of the mix in [from, to), with the app's own offline mixer (what playback and export use). */
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

/** The long clip (12 s) and red (4 s): a 16 s video, clip sound muted; the 12 s song at 0 s. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['long.mp4', 'red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.evaluate(() => {
		const s = (window as unknown as { __scenes: { project: { scenes: { id: string }[] }; setSceneVolume(id: string, v: number): void } }).__scenes;
		for (const sc of s.project.scenes) s.setSceneVolume(sc.id, 0);
	});
	await addSong(page);
	const clip = page.locator('.item-slot.sound').first();
	await clip.locator('.item').click();
	await expect(page.getByRole('complementary', { name: 'Settings' }).getByRole('heading', { name: 'Music' })).toBeVisible();
	/** Pixels per second: the first scene (12 s) spans its slot. */
	const scene = await settled(page.locator('.card-slot').first());
	return scene.width / 12;
}

async function addSong(page: Page) {
	const count = await page.locator('.item-slot.sound').count();
	await page.getByRole('button', { name: /^Sound Music/ }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: /^Music Add a song/ }).click();
	await (await chooser).setFiles(fixture('music.m4a'));
	await expect(page.locator('.item-slot.sound')).toHaveCount(count + 1);
	await page.keyboard.press('Escape');
}

async function dragBy(page: Page, target: Locator, dx: number, dy = 0, opts: { alt?: boolean; hold?: () => Promise<void> } = {}) {
	const b = (await target.boundingBox())!;
	const x = b.x + b.width / 2;
	const y = b.y + Math.min(b.height / 2, 14);
	await page.mouse.move(x, y);
	await page.mouse.down();
	if (opts.alt) await page.keyboard.down('Alt');
	await page.mouse.move(x + dx, y + dy, { steps: 10 });
	await opts.hold?.();
	await page.mouse.up();
	if (opts.alt) await page.keyboard.up('Alt');
}

test.describe('Editing sound clips', () => {
	test.setTimeout(120_000);

	test('trim from both sides with handles: live length, the waveform cropped, never beyond the file', async ({ page }) => {
		const pps = await setup(page);
		const clip = page.locator('.item-slot.sound').first();
		const startHandle = clip.locator('[data-sound-trim="start"]');
		const endHandle = clip.locator('[data-sound-trim="end"]');
		await expect(startHandle).toBeVisible();

		// Cut 2 s off the beginning: the rest of the song stays where it was.
		await dragBy(page, startHandle, pps * 2, 0, {
			alt: true,
			hold: async () => {
				await expect(page.getByTestId('item-drag-label')).toHaveText(/0:1\d/);
			}
		});
		let [s] = await sounds(page);
		expect(s.start).toBeCloseTo(2, 0);
		expect(s.sourceStart).toBeCloseTo(2, 0);
		expect(s.duration).toBeCloseTo(10, 0);
		// The waveform shows the trimmed part at the same scale (cropped, not squeezed).
		const box = await settled(clip);
		expect(box.x - (await settled(page.locator('.card-slot').first())).x).toBeCloseTo(pps * s.start, -1);
		expect(box.width).toBeCloseTo(pps * s.duration - 3, -1);

		// Cut 3 s off the end, then drag it back out far: only up to the end of the file.
		await dragBy(page, endHandle, -pps * 3, 0, { alt: true });
		[s] = await sounds(page);
		expect(s.duration).toBeCloseTo(7, 0);
		await dragBy(page, endHandle, pps * 8, 0, { alt: true });
		[s] = await sounds(page);
		expect(s.sourceStart + s.duration).toBeCloseTo(12, 1);
		// And the start back out: not before the file's beginning.
		await dragBy(page, startHandle, -pps * 5, 0, { alt: true });
		[s] = await sounds(page);
		expect(s.sourceStart).toBeCloseTo(0, 1);
		expect(s.start).toBeCloseTo(0, 1);

		// Trimmed audio is what plays: after trimming 2 s off the start, silence before 2 s.
		await dragBy(page, startHandle, pps * 2, 0, { alt: true });
		expect(await loudness(page, 0.2, 1.8)).toBeLessThan(0.001);
		expect(await loudness(page, 6, 7)).toBeGreaterThan(0.05);
		// One undo per trim.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+z`);
		expect((await sounds(page))[0].sourceStart).toBeCloseTo(0, 1);
	});

	test('move a clip, with snapping (Alt drags freely); split it with S and with Split here', async ({ page }) => {
		const pps = await setup(page);
		const clip = page.locator('.item-slot.sound').first();
		// Trim to about 4 s so there's room to move it, then make it exactly 3.5 s (so only its
		// start can snap to the scene boundary at 12 s, not its end to the video's end).
		await dragBy(page, clip.locator('[data-sound-trim="end"]'), -pps * 8, 0, { alt: true });
		expect((await sounds(page))[0].duration).toBeCloseTo(4, 0);
		await page.evaluate(() => {
			const st = (window as unknown as { __scenes: { project: { sounds: { id: string; start: number; sourceStart: number }[] }; setSoundTiming(id: string, t: object): void } }).__scenes;
			const x = st.project.sounds[0];
			st.setSoundTiming(x.id, { start: x.start, sourceStart: x.sourceStart, duration: 3.5 });
		});

		// Move it right to about 11.9 s: its start snaps to the scene boundary at 12 s.
		await dragBy(page, clip.locator('.item'), pps * 11.9, 0, {
			hold: async () => {
				await expect(page.locator('.snap-line')).toBeVisible();
			}
		});
		expect((await sounds(page))[0].start).toBe(12);
		await expect(page.locator('.snap-line')).toHaveCount(0);
		// With Alt, no snapping.
		await dragBy(page, clip.locator('.item'), -pps * 3.02, 0, { alt: true });
		const free = (await sounds(page))[0].start;
		expect(free).not.toBe(9);
		expect(free).toBeCloseTo(9, 0);
		// A gap before it is fine.
		expect(free).toBeGreaterThan(8);

		// Split at the playhead with S.
		await seekTo(page, free + 1.5);
		await clip.locator('.item').click();
		await page.keyboard.press('s');
		let list = await sounds(page);
		expect(list).toHaveLength(2);
		const [a, b] = [...list].sort((x, y) => x.start - y.start);
		expect(a.start + a.duration).toBeCloseTo(b.start, 5);
		expect(b.sourceStart - a.sourceStart).toBeCloseTo(a.duration, 5);
		expect(a.fadeOut).toBe(0);
		expect(b.fadeIn).toBe(0);
		// And with the Split here button.
		await seekTo(page, b.start + 1);
		await page.locator(`[data-item-id="${b.id}"] .item`).click();
		await page.getByRole('complementary', { name: 'Settings' }).getByRole('button', { name: 'Split here' }).click();
		list = await sounds(page);
		expect(list).toHaveLength(3);
		// Splitting doesn't change the sound.
		expect(list.reduce((n, x) => n + x.duration, 0)).toBeCloseTo(3.5, 3);
	});

	test('a second song that overlaps goes on a new audio track; it can be dragged between audio tracks', async ({ page }) => {
		const pps = await setup(page);
		await seekTo(page, 3);
		await addSong(page);
		let list = await sounds(page);
		const tracks = () =>
			scenes(page, (s) => (s as unknown as { project: { tracks: { id: string; name: string; kind: string }[] } }).project.tracks);
		let t = await tracks();
		expect(t.filter((x) => x.kind === 'audio').map((x) => x.name)).toEqual(['Audio 1', 'Audio 2']);
		expect(list.map((s) => t.find((x) => x.id === s.trackId)!.name)).toEqual(['Audio 1', 'Audio 2']);
		expect(list[1].start).toBeCloseTo(3, 1);

		// Trim the first song to 2.5 s, then drag the second up onto Audio 1 where it fits.
		await page.locator('.item-slot.sound').first().locator('.item').click();
		await dragBy(page, page.locator('.item-slot.sound').first().locator('[data-sound-trim="end"]'), -pps * 9.5, 0, { alt: true });
		const second = page.locator('.item-slot.sound').nth(1).locator('.item');
		await dragBy(page, second, 0, -48, { alt: true });
		list = await sounds(page);
		t = await tracks();
		expect(list.map((s) => t.find((x) => x.id === s.trackId)!.name)).toEqual(['Audio 1', 'Audio 1']);

		// Dropped where it overlaps the first: a new audio track just above.
		await dragBy(page, page.locator('.item-slot.sound').nth(1).locator('.item'), -pps * 2, 0, { alt: true });
		list = await sounds(page);
		t = await tracks();
		expect(new Set(list.map((s) => s.trackId)).size).toBe(2);
	});

	test('fades follow the trimmed edges and can be dragged', async ({ page }) => {
		const pps = await setup(page);
		const clip = page.locator('.item-slot.sound').first();
		let [s] = await sounds(page);
		expect([s.fadeIn, s.fadeOut]).toEqual([1.5, 3]);
		// The automatic fade: quiet at the very start, full in the middle.
		const middle = await loudness(page, 5, 6);
		expect(await loudness(page, 0, 0.15)).toBeLessThan(middle * 0.15);

		// Trim 4 s off the start: the fade in now starts at the new start.
		await dragBy(page, clip.locator('[data-sound-trim="start"]'), pps * 4, 0, { alt: true });
		[s] = await sounds(page);
		expect(s.start).toBeCloseTo(4, 0);
		expect(await loudness(page, s.start, s.start + 0.15)).toBeLessThan(middle * 0.15);
		expect(await loudness(page, s.start + 2, s.start + 3)).toBeGreaterThan(middle * 0.9);

		// Drag the fade-in dot out to about 3 s; the label shows it live.
		const dot = clip.locator('[data-sound-fade="in"]');
		await expect(dot).toBeVisible();
		await dragBy(page, dot, pps * 2.5, 0, {
			hold: async () => {
				await expect(page.getByTestId('item-drag-label')).toHaveText(/Fade in \d\.\d s/);
			}
		});
		[s] = await sounds(page);
		expect(s.fadeIn).toBeGreaterThan(2.5);
		expect(s.fadeIn).toBeLessThanOrEqual(5);
		// Half-way through the fade it's clearly quieter than full.
		const half = await loudness(page, s.start + s.fadeIn / 2 - 0.1, s.start + s.fadeIn / 2 + 0.1);
		expect(half).toBeLessThan(middle * 0.7);
		expect(half).toBeGreaterThan(middle * 0.3);
		// The fade is drawn as a sloped line.
		await expect(clip.locator('.fade-line.in')).toBeVisible();

		// The fade-out dot: to 0 means the song ends at full volume.
		const out = clip.locator('[data-sound-fade="out"]');
		await dragBy(page, out, pps * 6, 0);
		[s] = await sounds(page);
		expect(s.fadeOut).toBe(0);
		// The right column shows the same numbers.
		const settings = page.getByRole('complementary', { name: 'Settings' });
		await expect(settings.getByRole('slider', { name: 'Fade out' })).toHaveValue('0');
		await expect(settings.getByRole('slider', { name: 'Fade in' })).toHaveValue(String(s.fadeIn));
	});

	test('the saved MP4’s audio matches the preview mix exactly', async ({ page }, info) => {
		test.skip(!hasFfmpeg, 'needs ffmpeg to inspect the saved file');
		const pps = await setup(page);
		const clip = page.locator('.item-slot.sound').first();
		// Trim both ends, move it, give it a long fade in, and add a second song later.
		await dragBy(page, clip.locator('[data-sound-trim="start"]'), pps * 1, 0, { alt: true });
		await dragBy(page, clip.locator('[data-sound-trim="end"]'), -pps * 4, 0, { alt: true });
		await dragBy(page, clip.locator('.item'), pps * 2, 0, { alt: true });
		await dragBy(page, clip.locator('[data-sound-fade="in"]'), pps * 2, 0);
		await seekTo(page, 12.5);
		await addSong(page);
		const windows: [number, number][] = [
			[0.2, 2.8],
			[3.2, 4.2],
			[5, 6],
			[9.5, 10.4],
			[10.6, 12.4],
			[13, 14],
			[15, 15.8]
		];
		const preview: number[] = [];
		for (const [a, b] of windows) preview.push(await loudness(page, a, b));

		await page.getByRole('button', { name: 'Save video' }).click();
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('sound.mp4');
		await (await download).saveAs(file);
		for (const [i, [a, b]] of windows.entries()) {
			const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(a), '-t', String(b - a), '-i', file, '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
			let sum = 0;
			for (let k = 0; k < pcm.length; k += 2) sum += (pcm.readInt16LE(k) / 32768) ** 2;
			const saved = Math.sqrt(sum / (pcm.length / 2));
			if (preview[i] < 0.002) expect(saved, `silent at ${a}–${b}s`).toBeLessThan(0.004);
			else expect(saved / preview[i], `at ${a}–${b}s: saved ${saved} vs preview ${preview[i]}`).toBeGreaterThan(0.85);
			if (preview[i] >= 0.002) expect(saved / preview[i]).toBeLessThan(1.15);
		}
	});
});
