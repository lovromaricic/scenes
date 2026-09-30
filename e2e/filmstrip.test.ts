import { expect, test, type Page } from '@playwright/test';
import { dominant, importViaPicker } from './helpers';

/** Dominant colour at the centre of every filmstrip tile of the first scene card. */
async function tileColors(page: Page): Promise<string[]> {
	const rgb = await page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="filmstrip"]') as HTMLCanvasElement;
		const tiles = Number(canvas.dataset.tiles);
		const tileW = Number(canvas.dataset.tileWidth) * (canvas.width / canvas.clientWidth);
		const ctx = canvas.getContext('2d')!;
		const out: [number, number, number][] = [];
		for (let i = 0; i < tiles; i++) {
			const x = Math.min(canvas.width - 1, Math.floor((i + 0.5) * tileW));
			// Below the moving test pattern in the corner: the plain colour of that second.
			const d = ctx.getImageData(x, Math.floor(canvas.height * 0.75), 1, 1).data;
			out.push([d[0], d[1], d[2]]);
		}
		return out;
	});
	return rgb.map(dominant);
}

test('filmstrips show different frames across a clip and follow trimming', async ({ page }) => {
	await page.goto('/');
	// steps.mp4 is 6s: red, green, blue, white, black, yellow — one colour per second.
	await importViaPicker(page, ['steps.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();

	await expect
		.poll(async () => new Set(await tileColors(page)).size, { timeout: 15_000 })
		.toBeGreaterThanOrEqual(5);
	const colors = await tileColors(page);
	// In time order: the first tiles are red, the last yellow.
	expect(colors[0]).toBe('red');
	expect(colors.at(-1)).toBe('yellow');

	// Trim to the first 2 seconds: the filmstrip now only shows red and green.
	await page.getByRole('button', { name: /^Scene 1, / }).click();
	for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Shorter' }).click();
	await expect(page.getByRole('button', { name: /^Scene 1, Steps, 2s/ })).toBeVisible();
	await expect
		.poll(async () => [...new Set(await tileColors(page))].sort().join(','), { timeout: 15_000 })
		.toBe('green,red');
});
