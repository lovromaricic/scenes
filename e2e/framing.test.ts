import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { dominant, importViaPicker, scenes, seekTo, setFormat } from './helpers';

type RGB = [number, number, number];

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

async function preview(page: Page, fx: number, fy: number): Promise<RGB> {
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

function exported(file: string, t: number, fx: number, fy: number, w: number, h: number): RGB {
	const x = Math.round(fx * w) - 2;
	const y = Math.round(fy * h) - 2;
	const raw = execFileSync('ffmpeg', [
		'-v',
		'error',
		'-ss',
		t.toFixed(3),
		'-i',
		file,
		'-frames:v',
		'1',
		'-vf',
		`crop=4:4:${x}:${y}`,
		'-f',
		'rawvideo',
		'-pix_fmt',
		'rgb24',
		'-'
	]);
	const px: RGB = [0, 0, 0];
	for (let i = 0; i < 16; i++) for (let c = 0; c < 3; c++) px[c] += raw[i * 3 + c] / 16;
	return px.map(Math.round) as RGB;
}

/** Pixel at a relative spot inside tile `tile` of scene card `card`'s filmstrip. */
async function tile(page: Page, card: number, fx: number, fy: number): Promise<RGB> {
	return page.evaluate(
		({ card, fx, fy }) => {
			const canvas = document.querySelectorAll('[data-testid="filmstrip"]')[
				card
			] as HTMLCanvasElement;
			const tw = Number(canvas.dataset.tileWidth) * (canvas.width / canvas.clientWidth);
			const d = canvas
				.getContext('2d')!
				.getImageData(Math.floor(tw * fx), Math.floor(canvas.height * fy), 1, 1).data;
			return [d[0], d[1], d[2]] as RGB;
		},
		{ card, fx, fy }
	);
}

const near = (a: RGB, b: RGB, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const frameOf = (page: Page, i: number) =>
	scenes(page, (s) =>
		(s as unknown as { project: { scenes: { frame: object }[] } }).project.scenes.map(
			(x) => x.frame
		)
	).then((f) => f[i] as { mode: string; bars: string; zoom: number; x: number; y: number });

test.describe('Framing', () => {
	test.setTimeout(120_000);

	test('a wide clip in a 9:16 project: fill, fit with blur, and custom — preview, filmstrip and export match', async ({
		page
	}, info) => {
		test.skip(!hasFfmpeg, 'needs ffmpeg to inspect the saved file');
		await page.goto('/');
		// Red | green | blue thirds, three times.
		await importViaPicker(page, ['bands.mp4', 'bands.mp4', 'bands.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		await setFormat(page, 'Vertical', '720p');
		await expect(page.getByRole('button', { name: /^Project format: 720 × 1280/ })).toBeVisible();

		// Scene 1, Fill (the default): only the green middle third shows.
		await seekTo(page, 1.5);
		for (const fx of [0.05, 0.5, 0.95])
			expect(dominant(await preview(page, fx, 0.5))).toBe('green');

		// Scene 2, Fit with blurred bars: the whole picture across the middle, blur above and below.
		await page.getByRole('button', { name: /^Scene 2, / }).click();
		await page
			.getByRole('radiogroup', { name: 'Frame' })
			.getByRole('radio', { name: 'Fit' })
			.click();
		await page
			.getByRole('radiogroup', { name: 'Bars' })
			.getByRole('radio', { name: 'Blur' })
			.click();
		await seekTo(page, 4.5);
		expect(dominant(await preview(page, 0.1, 0.5))).toBe('red');
		expect(dominant(await preview(page, 0.9, 0.5))).toBe('blue');
		const bar = await preview(page, 0.5, 0.1);
		expect(bar[1]).toBeGreaterThan(90); // a soft green from the blurred copy, not black
		expect(bar[1]).toBeLessThan(250);

		// Scene 3, Custom: drag the picture right by 30% of the frame, so the red third comes in.
		await page.getByRole('button', { name: /^Scene 3, / }).click();
		await page
			.getByRole('radiogroup', { name: 'Frame' })
			.getByRole('radio', { name: 'Custom' })
			.click();
		await seekTo(page, 7.5);
		const box = (await page.getByTestId('preview').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		const custom = await frameOf(page, 2);
		expect(custom.mode).toBe('custom');
		expect(custom.x).toBeCloseTo(0.3, 1);
		expect(dominant(await preview(page, 0.1, 0.5))).toBe('red');
		expect(dominant(await preview(page, 0.9, 0.5))).toBe('green');

		// Thumbnails use the same framing.
		await expect
			.poll(async () => dominant(await tile(page, 1, 0.1, 0.5)), { timeout: 10_000 })
			.toBe('red');
		expect(dominant(await tile(page, 1, 0.9, 0.5))).toBe('blue');
		expect(dominant(await tile(page, 0, 0.1, 0.5))).toBe('green');
		await expect
			.poll(async () => dominant(await tile(page, 2, 0.1, 0.5)), { timeout: 10_000 })
			.toBe('red');

		// Save and compare the saved frames with the preview, at the chosen resolution.
		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		await expect(dialog.getByText('720 × 1280').first()).toBeVisible();
		const download = page.waitForEvent('download', { timeout: 90_000 });
		await dialog.getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('framing.mp4');
		await (await download).saveAs(file);
		await page.getByRole('button', { name: 'Done' }).click();
		const meta = JSON.parse(
			execFileSync('ffprobe', [
				'-v',
				'error',
				'-select_streams',
				'v',
				'-show_entries',
				'stream=width,height',
				'-of',
				'json',
				file
			]).toString()
		);
		expect(meta.streams[0]).toMatchObject({ width: 720, height: 1280 });
		for (const [t, points] of [
			[
				1.5,
				[
					[0.05, 0.5],
					[0.95, 0.5]
				]
			],
			[
				4.5,
				[
					[0.1, 0.5],
					[0.9, 0.5],
					[0.5, 0.1],
					[0.5, 0.9]
				]
			],
			[
				7.5,
				[
					[0.1, 0.5],
					[0.9, 0.5]
				]
			]
		] as [number, [number, number][]][]) {
			await seekTo(page, t);
			for (const [fx, fy] of points) {
				const want = await preview(page, fx, fy);
				const got = exported(file, t, fx, fy, 720, 1280);
				expect(near(got, want, 18), `${t}s at ${fx},${fy}: saved ${got} vs preview ${want}`).toBe(
					true
				);
			}
		}
	});

	test('framing is undoable, can be applied to all scenes, zooms, resets and is saved', async ({
		page
	}) => {
		await page.goto('/');
		await importViaPicker(page, ['bands.mp4', 'red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		await setFormat(page, 'Square');

		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page
			.getByRole('radiogroup', { name: 'Frame' })
			.getByRole('radio', { name: 'Custom' })
			.click();
		// Zoom with the slider, then with the mouse wheel on the preview.
		await page.getByRole('slider', { name: 'Zoom' }).fill('2');
		expect((await frameOf(page, 0)).zoom).toBeCloseTo(2);
		const box = (await page.getByTestId('preview').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.wheel(0, 300);
		expect((await frameOf(page, 0)).zoom).toBeLessThan(2);
		// Reset.
		await page.getByRole('button', { name: 'Reset' }).click();
		expect(await frameOf(page, 0)).toMatchObject({ mode: 'custom', zoom: 1, x: 0, y: 0 });

		// Undo walks back: reset → wheel → slider.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+z`);
		expect((await frameOf(page, 0)).zoom).toBeLessThan(2);
		await page.keyboard.press(`${mod}+z`);
		await page.keyboard.press(`${mod}+z`);
		expect((await frameOf(page, 0)).zoom).toBeCloseTo(1);

		// Apply Fit with white bars to every scene.
		await page
			.getByRole('radiogroup', { name: 'Frame' })
			.getByRole('radio', { name: 'Fit' })
			.click();
		await page
			.getByRole('radiogroup', { name: 'Bars' })
			.getByRole('radio', { name: 'White' })
			.click();
		await page.getByRole('button', { name: 'Apply to all scenes' }).click();
		expect(await frameOf(page, 1)).toMatchObject({ mode: 'fit', bars: 'white' });
		await seekTo(page, 4.5);
		const top = await preview(page, 0.5, 0.05);
		expect(top.every((v) => v > 235)).toBe(true);

		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		expect(await frameOf(page, 1)).toMatchObject({ mode: 'fit', bars: 'white' });
	});
});
