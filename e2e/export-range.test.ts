import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const range = (page: Page) => api<{ start: number; end: number } | null>(page, 's => s.project.range ?? null');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const hasFfmpeg = (() => {
	try {
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

/** Red (0–4 s) then green (4–7 s). */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.keyboard.press('Escape');
}

test.describe('Range', () => {
	test.setTimeout(180_000);

	test('I and O set it at the playhead; it shows on the ruler; Alt+X clears it; saved and undoable', async ({ page }) => {
		await setup(page);
		await seekTo(page, 1);
		await page.keyboard.press('i');
		expect(await range(page)).toEqual({ start: 1, end: 7 });
		await seekTo(page, 3);
		await page.keyboard.press('o');
		expect(await range(page)).toEqual({ start: 1, end: 3 });
		// On the ruler, from 1 s to 3 s.
		const r = (await page.getByTestId('range').boundingBox())!;
		const card = (await page.locator('.card-slot').first().boundingBox())!;
		const pps = card.width / 4;
		expect(r.x - card.x).toBeCloseTo(pps, -1);
		expect(r.width).toBeCloseTo(2 * pps, -1);

		await page.keyboard.press('Alt+x');
		expect(await range(page)).toBeNull();
		await expect(page.getByTestId('range')).toHaveCount(0);
		await page.keyboard.press(`${mod}+z`);
		expect(await range(page)).toEqual({ start: 1, end: 3 });
		await expect(page.getByText('Saved on this device')).toBeVisible({ timeout: 10_000 });
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
		expect(await range(page)).toEqual({ start: 1, end: 3 });
	});

	test('drag its edges (snapping to scene edges), the toolbar buttons, and Set range to selection', async ({ page }) => {
		await setup(page);
		await seekTo(page, 1);
		await page.getByRole('button', { name: 'Range start at the playhead' }).click();
		await seekTo(page, 3);
		await page.getByRole('button', { name: 'Range end at the playhead' }).click();
		expect(await range(page)).toEqual({ start: 1, end: 3 });
		const card = (await page.locator('.card-slot').first().boundingBox())!;
		const pps = card.width / 4;
		const end = (await page.locator('[data-range-edge="end"]').boundingBox())!;
		// Drag the end (by its grip at the bottom, clear of the playhead's knob) to just short of
		// 4 s: it snaps to the cut between the scenes.
		const gy = end.y + end.height - 4;
		await page.mouse.move(end.x + end.width / 2, gy);
		await page.mouse.down();
		await page.mouse.move(end.x + end.width / 2 + pps * 0.97, gy, { steps: 6 });
		await page.mouse.up();
		expect((await range(page))!.end).toBeCloseTo(4, 3);
		// One undo step for the drag.
		await page.keyboard.press(`${mod}+z`);
		expect((await range(page))!.end).toBeCloseTo(3, 3);

		// The second scene selected: the range covers it.
		await page.getByRole('button', { name: /^Scene 2, / }).click();
		await page.getByRole('button', { name: 'More range options' }).click();
		await page.getByRole('menuitem', { name: 'Set range to selection' }).click();
		expect(await range(page)).toEqual({ start: 4, end: 7 });
		await page.getByRole('button', { name: 'More range options' }).click();
		await page.getByRole('menuitem', { name: 'Clear range' }).click();
		expect(await range(page)).toBeNull();
	});

	test('saving a range as video: Range is chosen, the length is the range’s, and the file is just that part', async ({ page }, info) => {
		await setup(page);
		await api(page, 's => s.setRange({ start: 3, end: 5 })');
		await page.getByRole('button', { name: 'Save video' }).click();
		const dialog = page.getByRole('dialog', { name: 'Save video' });
		await expect(dialog.getByRole('radiogroup', { name: 'What' }).getByRole('radio', { name: 'Range' })).toHaveAttribute('aria-checked', 'true');
		await expect(dialog.getByTestId('export-summary')).toContainText('· 2 sec ·');
		if (!hasFfmpeg) return;
		await dialog.getByRole('radio', { name: /Small file/ }).click();
		const download = page.waitForEvent('download', { timeout: 120_000 });
		await dialog.getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('range.mp4');
		await (await download).saveAs(file);
		const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
		expect(length).toBeGreaterThan(1.9);
		expect(length).toBeLessThan(2.2);
		const centre = (t: number) => {
			const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=16:9,crop=2:2:7:4', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
			return [raw[0], raw[1], raw[2]];
		};
		// Red for its first second (3–4 s), green after (4–5 s).
		const a = centre(0.5);
		const b = centre(1.5);
		expect(a[0]).toBeGreaterThan(180);
		expect(a[1]).toBeLessThan(80);
		expect(b[1]).toBeGreaterThan(180);
		expect(b[0]).toBeLessThan(80);
	});
});
