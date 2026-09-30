import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fixture, importViaPicker, scenes, seekTo, textAreaPixels, openNewVideo } from './helpers';

type RGB = [number, number, number];
const near = (a: RGB, b: RGB, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

type Font = { family: string; source: string; weight: number; italic: boolean; id: string };
type Text = { font?: Font; size?: number; colors?: object; style: string };
const text = (page: Page) =>
	scenes(page, (s) => (s as unknown as { project: { texts: Text[] } }).project.texts[0]).then(
		(t) => JSON.parse(JSON.stringify(t)) as Text
	);
const boxSize = async (page: Page) => {
	const b = (await page.locator('.text-box').first().boundingBox())!;
	return { w: b.width, h: b.height };
};

async function setup(page: Page, words = 'Saturday market') {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await seekTo(page, 1);
	await page.getByRole('button', { name: /^Words/ }).click();
	await page.getByRole('button', { name: /^Caption/ }).click();
	await page.keyboard.type(words);
	await page.keyboard.press('Enter');
	await page
		.getByRole('button', { name: `Words: ${words}` })
		.first()
		.click();
}

async function openFonts(page: Page) {
	await page.getByRole('button', { name: /^Font:/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Choose a font' });
	await expect(dialog).toBeVisible();
	return dialog;
}

test.describe('Text colour, size and fonts', () => {
	test.setTimeout(120_000);

	test('built-in fonts with weights and italic, and recently used fonts', async ({ page }) => {
		await setup(page);
		const geist = await boxSize(page);

		let dialog = await openFonts(page);
		await dialog.getByRole('button', { name: /^Anton/ }).click();
		await expect(page.getByRole('button', { name: /^Font: Anton/ })).toBeVisible();
		expect((await text(page)).font).toMatchObject({
			family: 'Anton',
			source: 'builtin',
			weight: 400
		});
		await expect.poll(async () => (await boxSize(page)).w).not.toBeCloseTo(geist.w, 0);

		dialog = await openFonts(page);
		await dialog.getByRole('searchbox', { name: 'Search fonts' }).fill('lor');
		await expect(dialog.getByRole('button', { name: /^Anton/ })).toHaveCount(0);
		await dialog.getByRole('button', { name: /^Lora/ }).click();
		const styles = page.getByRole('radiogroup', { name: 'Font style' });
		await expect(styles.getByRole('radio')).toHaveText([
			'Regular',
			'Bold',
			'Italic',
			'Bold Italic'
		]);
		const regular = await boxSize(page);
		await styles.getByRole('radio', { name: 'Bold Italic' }).click();
		expect((await text(page)).font).toMatchObject({ family: 'Lora', weight: 700, italic: true });
		await expect.poll(async () => (await boxSize(page)).w).not.toBeCloseTo(regular.w, 0);

		// Recently used fonts are at the top.
		dialog = await openFonts(page);
		const recent = await dialog.locator('.option').allInnerTexts();
		expect(recent.slice(0, 2)).toEqual(['Lora', 'Anton']);
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);

		// Undo steps back through the font changes.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+z`);
		expect((await text(page)).font).toMatchObject({ family: 'Lora', weight: 400, italic: false });
	});

	test('text, box and outline colours with custom hex and opacity; reset; size in pixels', async ({
		page
	}) => {
		await setup(page, 'MMMM');
		// Big text in the middle, so the letters cover plenty of pixels inside the frame.
		await page
			.getByRole('radiogroup', { name: 'Position' })
			.getByRole('radio', { name: 'Middle' })
			.click();
		const before = await boxSize(page);
		const size = page.getByRole('spinbutton', { name: 'Text size in pixels' });
		await size.fill('160');
		await size.press('Enter');
		expect((await text(page)).size! * 720).toBeCloseTo(160, 0);
		await expect.poll(async () => (await boxSize(page)).h).toBeGreaterThan(before.h * 2);

		// Box colour: custom hex at full opacity.
		const boxHex = page.getByRole('textbox', { name: 'Box color: hex code' });
		await boxHex.fill('#336699');
		await boxHex.press('Enter');
		await page.getByRole('slider', { name: 'Box color: opacity' }).fill('1');
		expect((await textAreaPixels(page)).some((p) => near(p, [51, 102, 153], 6))).toBe(true);

		// Text colour: green letters, then half transparent over the blue box.
		const textHex = page.getByRole('textbox', { name: 'Text color: hex code' });
		await textHex.fill('#00ff00');
		await textHex.press('Enter');
		expect((await textAreaPixels(page)).some((p) => near(p, [0, 255, 0], 10))).toBe(true);
		await page.getByRole('slider', { name: 'Text color: opacity' }).fill('0.5');
		const half: RGB = [26, 179, 77];
		const pixels = await textAreaPixels(page);
		expect(pixels.some((p) => near(p, half, 14))).toBe(true);
		expect(pixels.some((p) => near(p, [0, 255, 0], 10))).toBe(false);

		// Reset colours goes back to the style's own (white on a dark box).
		await page.getByRole('button', { name: 'Reset colors' }).click();
		expect((await text(page)).colors).toBeUndefined();
		expect((await textAreaPixels(page)).some((p) => near(p, [51, 102, 153], 6))).toBe(false);

		// Outlined: outline colour and thickness. Picking a style applies its own colours.
		await page
			.getByRole('radiogroup', { name: 'Text style' })
			.getByRole('radio', { name: 'Outlined' })
			.click();
		await expect(page.getByRole('textbox', { name: 'Box color: hex code' })).toHaveCount(0);
		const outline = page.getByRole('textbox', { name: 'Outline color: hex code' });
		await outline.fill('#ff00ff');
		await outline.press('Enter');
		await page.getByRole('slider', { name: 'Outline thickness' }).fill('0.3');
		expect((await textAreaPixels(page)).some((p) => near(p, [255, 0, 255], 12))).toBe(true);
		await page
			.getByRole('radiogroup', { name: 'Text style' })
			.getByRole('radio', { name: 'Clean white' })
			.click();
		expect((await text(page)).colors).toBeUndefined();
	});

	test('uploaded fonts work, survive a reload, and a missing font falls back with a warning', async ({
		page
	}) => {
		await setup(page);
		const geist = await boxSize(page);
		const dialog = await openFonts(page);
		const chooser = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'Upload font file' }).click();
		await (await chooser).setFiles(fixture('Pacifico-Regular.ttf'));
		await expect(page.getByRole('button', { name: /^Font: Pacifico/ })).toBeVisible();
		expect((await text(page)).font).toMatchObject({
			family: 'Pacifico',
			source: 'upload',
			weight: 400,
			italic: false
		});
		await expect.poll(async () => (await boxSize(page)).w).not.toBeCloseTo(geist.w, 0);
		const pacifico = await boxSize(page);

		// Listed under Uploaded.
		const again = await openFonts(page);
		await expect(again.getByRole('button', { name: /^Pacifico/ })).toHaveCount(2); // recent + uploaded
		await page.keyboard.press('Escape');

		// After a reload it still renders in Pacifico, straight from this device.
		await page.reload();
		await expect(page.locator('.text-box').first()).toBeVisible();
		await expect.poll(async () => (await boxSize(page)).w).toBeCloseTo(pacifico.w, 0);
		await expect(page.getByRole('button', { name: 'Font missing' })).toHaveCount(0);

		// If the stored font disappears, Geist is used and the words say so.
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					const r = indexedDB.open('scenes');
					r.onsuccess = () => {
						const tx = r.result.transaction('fonts', 'readwrite');
						tx.objectStore('fonts').clear();
						tx.oncomplete = () => resolve();
					};
				})
		);
		await page.reload();
		await expect(page.getByRole('button', { name: 'Font missing' })).toBeVisible();
		// Drawn in Geist (at the missing font's weight), so no longer Pacifico's width.
		await expect
			.poll(async () => Math.abs((await boxSize(page)).w - pacifico.w))
			.toBeGreaterThan(5);
		await page.getByRole('button', { name: 'Font missing' }).click();
		await expect(page.getByRole('alert')).toContainText('couldn’t be loaded, so Geist is used');
		await page.getByRole('button', { name: 'Pick another font' }).click();
		await expect(page.getByRole('dialog', { name: 'Choose a font' })).toBeVisible();
	});

	test('the saved MP4 shows the same font and colours as the preview', async ({ page }, info) => {
		test.skip(!hasFfmpeg, 'needs ffmpeg to inspect the saved file');
		await setup(page, 'MARKET');
		await page
			.getByRole('radiogroup', { name: 'Position' })
			.getByRole('radio', { name: 'Middle' })
			.click();
		const dialog = await openFonts(page);
		await dialog.getByRole('button', { name: /^Anton/ }).click();
		const size = page.getByRole('spinbutton', { name: 'Text size in pixels' });
		await size.fill('140');
		await size.press('Enter');
		const boxHex = page.getByRole('textbox', { name: 'Box color: hex code' });
		await boxHex.fill('#1f2a44');
		await boxHex.press('Enter');
		const textHex = page.getByRole('textbox', { name: 'Text color: hex code' });
		await textHex.fill('#ffe14d');
		await textHex.press('Enter');
		await seekTo(page, 2);
		const want = await textAreaPixels(page);
		const box = (await page.locator('.text-box').first().boundingBox())!;
		const canvas = (await page.getByTestId('preview').boundingBox())!;

		await page.getByRole('button', { name: 'Save video' }).click();
		const download = page.waitForEvent('download', { timeout: 90_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('text.mp4');
		await (await download).saveAs(file);

		// Sample the same grid of points as textAreaPixels, in the 1280×720 saved frame.
		const raw = execFileSync(
			'ffmpeg',
			[
				'-v',
				'error',
				'-ss',
				'2',
				'-i',
				file,
				'-frames:v',
				'1',
				'-f',
				'rawvideo',
				'-pix_fmt',
				'rgb24',
				'-'
			],
			{ maxBuffer: 64 * 1024 * 1024 }
		);
		const got: RGB[] = [];
		for (let i = 1; i < 12; i++) {
			for (let j = 1; j < 6; j++) {
				const x = Math.floor(((box.x - canvas.x + (box.width * i) / 12) / canvas.width) * 1280);
				const y = Math.floor(((box.y - canvas.y + (box.height * j) / 6) / canvas.height) * 720);
				const o = (y * 1280 + x) * 3;
				got.push([raw[o], raw[o + 1], raw[o + 2]]);
			}
		}
		// Yellow letters on a navy box, in the same places (a few edge pixels may differ).
		const agree = got.filter((p, i) => near(p, want[i], 40)).length;
		expect(agree / got.length).toBeGreaterThan(0.85);
		expect(got.some((p) => near(p, [255, 225, 77], 30))).toBe(true);
		// The box keeps Bold box's 88% opacity: navy with a little of the red video through it.
		const boxColor: RGB = [
			Math.round(0.88 * 31 + 0.12 * 255),
			Math.round(0.88 * 42),
			Math.round(0.88 * 68)
		];
		expect(got.some((p) => near(p, boxColor, 20))).toBe(true);
	});
});
