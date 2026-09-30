import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, setFormat } from './helpers';

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

function probe(file: string) {
	return JSON.parse(
		execFileSync('ffprobe', [
			'-v',
			'error',
			'-select_streams',
			'v',
			'-show_entries',
			'stream=width,height,r_frame_rate:format=duration',
			'-of',
			'json',
			file
		]).toString()
	) as {
		streams: { width: number; height: number; r_frame_rate: string }[];
		format: { duration: string };
	};
}

const sizeOf = (text: string) => Number(/about ([\d.]+) MB/.exec(text)?.[1] ?? 0);

test.describe('Save video uses the project format', () => {
	test.skip(!hasFfmpeg, 'needs ffmpeg to inspect the saved file');
	test.setTimeout(120_000);

	test('presets show the final size and frame rate, and save at the project’s resolution and fps', async ({
		page
	}, info) => {
		await page.goto('/');
		await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await setFormat(page, 'Landscape', '1080p', 60);
		await expect(
			page.getByRole('button', { name: /^Project format: 1920 × 1080 · 60 fps/ })
		).toBeVisible();

		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		const best = dialog.getByRole('radio', { name: /^Best quality/ });
		const balanced = dialog.getByRole('radio', { name: /^Balanced/ });
		const small = dialog.getByRole('radio', { name: /^Small file/ });
		await expect(best).toContainText('1920 × 1080 · 60 fps');
		await expect(balanced).toContainText('1920 × 1080 · 60 fps');
		await expect(small).toContainText('1280 × 720 · 60 fps');
		const sizes = [await best.innerText(), await balanced.innerText(), await small.innerText()].map(
			sizeOf
		);
		expect(sizes[0]).toBeGreaterThan(sizes[1]);
		expect(sizes[1]).toBeGreaterThan(sizes[2]);

		await balanced.click();
		const download = page.waitForEvent('download', { timeout: 90_000 });
		await dialog.getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('balanced.mp4');
		await (await download).saveAs(file);
		const meta = probe(file);
		expect(meta.streams[0]).toMatchObject({ width: 1920, height: 1080, r_frame_rate: '60/1' });
		expect(Number(meta.format.duration)).toBeCloseTo(4, 0);
	});

	test('Small file scales a vertical 1080p project down to 720 wide', async ({ page }, info) => {
		await page.goto('/');
		await importViaPicker(page, ['portrait.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await setFormat(page, 'Vertical', '1080p');
		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		await dialog.getByRole('radio', { name: /^Small file/ }).click();
		await expect(dialog.getByRole('radio', { name: /^Small file/ })).toContainText(
			'720 × 1280 · 25 fps'
		);
		const download = page.waitForEvent('download', { timeout: 90_000 });
		await dialog.getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('small.mp4');
		await (await download).saveAs(file);
		expect(probe(file).streams[0]).toMatchObject({
			width: 720,
			height: 1280,
			r_frame_rate: '25/1'
		});
	});
});
