import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, scenes, seekTo, setFormat } from './helpers';

type RGB = [number, number, number];
const isMagenta = ([r, g, b]: RGB) => r > 180 && g < 110 && b > 180;

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

/** Source pixels per screen pixel is 1 / (screen pixels per source pixel) of the crop view. */
async function cropScale(page: Page): Promise<number> {
	const box = (await page.getByRole('button', { name: /^Crop box/ }).boundingBox())!;
	const size = (await page.getByTestId('crop-size').innerText())
		.split('×')
		.map((v) => Number(v.trim()));
	return box.width / size[0];
}

async function dragHandle(
	page: Page,
	handle: string,
	dx: number,
	dy: number,
	opts: { shift?: boolean; check?: () => Promise<void> } = {}
) {
	const h = (await page.locator(`[data-handle="${handle}"]`).boundingBox())!;
	const x = h.x + h.width / 2;
	const y = h.y + h.height / 2;
	if (opts.shift) await page.keyboard.down('Shift');
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx, y + dy, { steps: 8 });
	await opts.check?.();
	await page.mouse.up();
	if (opts.shift) await page.keyboard.up('Shift');
}

const cropped = (page: Page) => page.getByTestId('cropped-size');
const summary = (page: Page) => page.getByTestId('crop-summary');
const sceneCrop = (page: Page, i = 0) =>
	scenes(page, (s) =>
		(s as unknown as { project: { scenes: { crop?: object }[] } }).project.scenes.map(
			(x) => x.crop ?? null
		)
	).then((c) => c[i] as { x: number; y: number; w: number; h: number } | null);

async function setup(page: Page) {
	await page.goto('/');
	// A 1280×800 "screen recording" with an 80-pixel magenta browser toolbar across the top.
	await importViaPicker(page, ['screen.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await setFormat(page, 'Landscape', '720p');
	await page.getByRole('button', { name: /^Scene 1, / }).click();
	await seekTo(page, 1);
}

test.describe('Crop', () => {
	test.setTimeout(120_000);

	test('crop the toolbar off a screen recording: live size, and gone from preview, thumbnails and the saved MP4', async ({
		page
	}, info) => {
		await setup(page);
		await expect(summary(page)).toHaveText('1280 × 800');
		expect(isMagenta(await preview(page, 0.5, 0.02))).toBe(true);

		// C enters crop mode; the preview shows the whole clip.
		await page.keyboard.press('c');
		await expect(page.getByRole('heading', { name: 'Crop' })).toBeVisible();
		await expect(cropped(page)).toHaveText('1280 × 800');
		const scale = await cropScale(page);

		// Drag the top edge down by 80 source pixels; the size label updates while dragging.
		await dragHandle(page, 'n', 0, 80 * scale, {
			check: async () => {
				await expect(page.getByTestId('crop-size')).toHaveText('1280 × 720');
			}
		});
		await expect(cropped(page)).toHaveText('1280 × 720');
		await page.getByRole('button', { name: 'Done' }).click();
		await expect(page.getByRole('heading', { name: 'Crop' })).toHaveCount(0);
		await expect(summary(page)).toHaveText('1280 × 800 → cropped to 1280 × 720');
		expect(await sceneCrop(page)).toEqual({ x: 0, y: 80, w: 1280, h: 720 });

		// The preview no longer shows the toolbar.
		for (const fx of [0.1, 0.5, 0.9]) expect(isMagenta(await preview(page, fx, 0.01))).toBe(false);
		// Nor does the filmstrip.
		const tileTop = () =>
			page.evaluate(() => {
				const c = document.querySelector('[data-testid="filmstrip"]') as HTMLCanvasElement;
				const d = c.getContext('2d')!.getImageData(Math.floor(c.width * 0.1), 1, 1, 1).data;
				return [d[0], d[1], d[2]] as [number, number, number];
			});
		await expect.poll(async () => isMagenta(await tileTop())).toBe(false);
		expect((await tileTop())[2]).toBeGreaterThan(200); // page blue, so the frame is drawn

		// And neither does the saved video, which is 1280×720.
		test.skip(!hasFfmpeg, 'needs ffmpeg to inspect the saved file');
		await page.getByRole('button', { name: 'Save video' }).click();
		const download = page.waitForEvent('download', { timeout: 90_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('crop.mp4');
		await (await download).saveAs(file);
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
		expect(meta.streams[0]).toMatchObject({ width: 1280, height: 720 });
		const top = execFileSync('ffmpeg', [
			'-v',
			'error',
			'-ss',
			'1',
			'-i',
			file,
			'-frames:v',
			'1',
			'-vf',
			'crop=1280:24:0:0',
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgb24',
			'-'
		]);
		let magenta = 0;
		for (let i = 0; i < top.length; i += 3)
			if (isMagenta([top[i], top[i + 1], top[i + 2]])) magenta++;
		expect(magenta).toBe(0);
	});

	test('typing how much to cut from each side moves the box', async ({ page }) => {
		await setup(page);
		await page.getByRole('button', { name: 'Crop', exact: true }).click();
		const scale = await cropScale(page);
		const before = (await page.getByRole('button', { name: /^Crop box/ }).boundingBox())!;
		await page.getByRole('spinbutton', { name: 'Cut from left' }).fill('100');
		await page.getByRole('spinbutton', { name: 'Cut from right' }).fill('80');
		await page.getByRole('spinbutton', { name: 'Cut from top' }).fill('80');
		await page.getByRole('spinbutton', { name: 'Cut from bottom' }).fill('40');
		await expect(cropped(page)).toHaveText('1100 × 680');
		const after = (await page.getByRole('button', { name: /^Crop box/ }).boundingBox())!;
		expect(after.x - before.x).toBeCloseTo(100 * scale, 0);
		expect(after.y - before.y).toBeCloseTo(80 * scale, 0);
		expect(after.width).toBeCloseTo(1100 * scale, 0);
		expect(after.height).toBeCloseTo(680 * scale, 0);
		await page.keyboard.press('Enter');
		await expect(summary(page)).toHaveText('1280 × 800 → cropped to 1100 × 680');
	});

	test('shape chips, Shift to keep the shape, snapping, Reset, Cancel and undo', async ({
		page
	}) => {
		await setup(page);
		// Double-clicking the picture also enters crop mode.
		await page.getByTestId('preview').dblclick();
		await expect(page.getByRole('heading', { name: 'Crop' })).toBeVisible();

		const shape = page.getByRole('radiogroup', { name: 'Crop shape' });
		await shape.getByRole('radio', { name: '1:1' }).click();
		await expect(cropped(page)).toHaveText('800 × 800');
		await shape.getByRole('radio', { name: '16:9' }).click();
		await expect(cropped(page)).toHaveText('1280 × 720');
		await shape.getByRole('radio', { name: 'Original' }).click();
		await expect(cropped(page)).toHaveText('1280 × 800');
		await shape.getByRole('radio', { name: 'Match project' }).click();
		await expect(cropped(page)).toHaveText('1280 × 720');
		await shape.getByRole('radio', { name: '4:5' }).click();
		await expect(cropped(page)).toHaveText('640 × 800');

		// Free again; Shift on a corner keeps the current shape (4:5).
		await shape.getByRole('radio', { name: 'Free' }).click();
		const scale = await cropScale(page);
		await dragHandle(page, 'se', -160 * scale, -20 * scale, { shift: true });
		const [w, h] = (await cropped(page).innerText()).split('×').map((v) => Number(v.trim()));
		expect(w / h).toBeCloseTo(4 / 5, 1);
		expect(w).toBeLessThan(640);

		// Snapping: the left edge dragged to just past the middle lands exactly on it.
		await page.getByRole('button', { name: 'Reset' }).click();
		await expect(cropped(page)).toHaveText('1280 × 800');
		await dragHandle(page, 'w', 645 * scale, 0);
		await expect(cropped(page)).toHaveText('640 × 800');

		// Cancel (Esc) throws the session's changes away.
		await page.keyboard.press('Escape');
		await expect(page.getByRole('heading', { name: 'Crop' })).toHaveCount(0);
		expect(await sceneCrop(page)).toBeNull();

		// Done and undo.
		await page.keyboard.press('c');
		await dragHandle(page, 'n', 0, 80 * scale);
		await page.keyboard.press('Enter');
		expect(await sceneCrop(page)).toEqual({ x: 0, y: 80, w: 1280, h: 720 });
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+z`);
		expect(await sceneCrop(page)).toBeNull();
		await page.keyboard.press(`${mod}+Shift+z`);
		expect(await sceneCrop(page)).toEqual({ x: 0, y: 80, w: 1280, h: 720 });
		// Reset inside crop mode + Done removes the crop.
		await page.keyboard.press('c');
		await page.getByRole('button', { name: 'Reset' }).click();
		await page.getByRole('button', { name: 'Done' }).click();
		expect(await sceneCrop(page)).toBeNull();
	});

	test('crop works with framing, is shared across scenes from the same clip, and is saved', async ({
		page
	}) => {
		await setup(page);
		await page.keyboard.press('c');
		const scale = await cropScale(page);
		await dragHandle(page, 'n', 0, 80 * scale);
		await page.keyboard.press('Enter');

		// In a vertical project with Fit and white bars, the cropped picture sits in the middle,
		// and its top edge is page blue, not the toolbar.
		await setFormat(page, 'Vertical');
		await page
			.getByRole('radiogroup', { name: 'Frame' })
			.getByRole('radio', { name: 'Fit' })
			.click();
		await page
			.getByRole('radiogroup', { name: 'Bars' })
			.getByRole('radio', { name: 'White' })
			.click();
		// Picture height = 9/16 of the width → occupies 0.5 ± 0.158 of the height.
		expect((await preview(page, 0.5, 0.2)).every((v) => v > 235)).toBe(true);
		expect(isMagenta(await preview(page, 0.5, 0.35))).toBe(false);
		// Enlargement note: 1280 source pixels shown 720 wide → not enlarged.
		await expect(page.getByText(/Enlarged/)).toHaveCount(0);

		// Custom still works on the cropped picture.
		await page
			.getByRole('radiogroup', { name: 'Frame' })
			.getByRole('radio', { name: 'Custom' })
			.click();
		await page.getByRole('slider', { name: 'Zoom' }).fill('3');
		await expect(page.getByText(/Enlarged 5\.3×, may look a bit soft/)).toBeVisible();

		// A second scene from the same clip gets the crop with one click.
		await page.getByRole('region', { name: 'Your media' }).getByRole('button').first().click();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		expect(await sceneCrop(page, 1)).toBeNull();
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page.getByRole('button', { name: 'Apply crop to all scenes from this clip' }).click();
		expect(await sceneCrop(page, 1)).toEqual({ x: 0, y: 80, w: 1280, h: 720 });

		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		expect(await sceneCrop(page, 1)).toEqual({ x: 0, y: 80, w: 1280, h: 720 });
	});
});
