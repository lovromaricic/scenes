import { expect, test, type Page } from '@playwright/test';
import { centerColor, dominant, importViaPicker, scenes, seekTo } from './helpers';

const cardNames = (page: Page) =>
	page.getByRole('button', { name: /^Scene \d+, / }).evaluateAll((els) =>
		els
			.map((el) => ({ name: el.getAttribute('aria-label')!, x: el.getBoundingClientRect().x }))
			.sort((a, b) => a.x - b.x)
			.map((e) => e.name.replace(/^Scene \d+, /, ''))
	);

const projectJson = (page: Page) =>
	scenes(page, (s) =>
		JSON.stringify({ ...(s as unknown as { project: object }).project, updatedAt: 0 })
	);

async function setup(page: Page) {
	await page.goto('/');
	await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
}

test.describe('Phase 3: editing scenes', () => {
	test('reorder, trim, length, speed, split and delete — all undoable', async ({ page }) => {
		await setup(page);
		const history: string[] = [await projectJson(page)];
		const record = async () => history.push(await projectJson(page));

		// Reorder: drag the first card past the last one.
		const first = page.getByRole('button', { name: /^Scene 1, Red/ });
		const last = page.getByRole('button', { name: /^Scene 3, Blue/ });
		const a = (await first.boundingBox())!;
		const b = (await last.boundingBox())!;
		await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
		await page.mouse.down();
		for (let i = 1; i <= 12; i++) {
			await page.mouse.move(
				a.x + a.width / 2 + ((b.x + b.width - a.x - a.width / 2 + 10) * i) / 12,
				a.y + a.height / 2
			);
		}
		await page.mouse.up();
		await expect.poll(() => cardNames(page)).toEqual(['Green, 3s', 'Blue, 3s', 'Red, 4s']);
		await record();

		// Trim: drag the right edge of the (now last) red card to the left by about 1 second.
		await page.getByRole('button', { name: /^Scene \d, Red/ }).click();
		const slot = page.locator('.card-slot', {
			has: page.getByRole('button', { name: /^Scene \d, Red/ })
		});
		const handle = slot.locator('.trim-handle.end');
		const h = (await handle.boundingBox())!;
		const pps = await page.evaluate(() => {
			const c = document.querySelector('.card-slot') as HTMLElement;
			return c.getBoundingClientRect().width / 3; // Green is 3s long
		});
		await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
		await page.mouse.down();
		for (let i = 1; i <= 6; i++)
			await page.mouse.move(h.x + h.width / 2 - (pps * i) / 6, h.y + h.height / 2);
		await page.mouse.up();
		await expect(page.getByRole('button', { name: /^Scene 3, Red, 3s/ })).toBeVisible();
		await record();

		// Length stepper: one step longer (+0.5s).
		await page.getByRole('button', { name: 'Longer' }).click();
		await expect(page.getByRole('group', { name: 'Length' })).toContainText('3.5 sec');
		await record();

		// Speed: 2× halves the red scene.
		await page.getByRole('radio', { name: '2×' }).click();
		await expect(page.getByRole('button', { name: /^Scene 3, Red, 1.8s/ })).toBeVisible();
		await record();

		// Split the green scene at 1.5s with the S key.
		await seekTo(page, 1.5);
		await page.keyboard.press('s');
		await expect(page.getByRole('button', { name: /^Scene \d+, / })).toHaveCount(4);
		expect(await cardNames(page)).toEqual(['Green, 1.5s', 'Green, 1.5s', 'Blue, 3s', 'Red, 1.8s']);
		await record();

		// Delete the selected (second half) with the Delete key.
		await page.keyboard.press('Delete');
		await expect(page.getByRole('button', { name: /^Scene \d+, / })).toHaveCount(3);
		await record();

		// Undo everything, one step at a time, checking each state.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		for (let i = history.length - 2; i >= 0; i--) {
			await page.keyboard.press(`${mod}+z`);
			await expect.poll(() => projectJson(page)).toBe(history[i]);
		}
		// One more undo removes the imported clips themselves.
		await page.keyboard.press(`${mod}+z`);
		await expect(page.getByRole('button', { name: /^Scene \d+, / })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
		await page.keyboard.press(`${mod}+Shift+z`);
		await expect.poll(() => projectJson(page)).toBe(history[0]);
		// …and redo everything.
		for (let i = 1; i < history.length; i++) {
			await page.keyboard.press(`${mod}+Shift+z`);
			await expect.poll(() => projectJson(page)).toBe(history[i]);
		}
		await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
	});

	test('reordering works from the keyboard', async ({ page }) => {
		await setup(page);
		await page.getByRole('button', { name: /^Scene 1, Red/ }).focus();
		await page.keyboard.press('Alt+ArrowRight');
		await expect.poll(() => cardNames(page)).toEqual(['Green, 3s', 'Red, 4s', 'Blue, 3s']);
		await expect(page.getByRole('button', { name: /^Scene 2, Red/ })).toBeFocused();
	});

	test('reloading brings back the exact project', async ({ page }) => {
		await setup(page);
		await page.getByRole('button', { name: /^Scene 2, Green/ }).click();
		await page.getByRole('radio', { name: '0.5×' }).click();
		await page.getByRole('button', { name: /, rename$/ }).click();
		await page.getByRole('textbox', { name: 'Video title' }).fill('Summer holiday');
		await page.keyboard.press('Enter');
		await page.getByRole('radio', { name: '9:16' }).click();
		await seekTo(page, 5);
		const before = await projectJson(page);

		// Reload straight away: nothing may be lost, even an edit made a moment ago.
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		expect(await projectJson(page)).toBe(before);
		await expect(page.getByRole('button', { name: 'Summer holiday, rename' })).toBeVisible();
		await expect(page.getByText('3 scenes · 13 sec')).toBeVisible();
		// Media plays again straight from IndexedDB, at the saved playhead position.
		expect(await scenes(page, (s) => s.time)).toBeCloseTo(5, 1);
		expect(dominant(await centerColor(page))).toBe('green');
		await expect(page.locator('.card .thumb').first()).toHaveAttribute('style', /url\("blob:/);
	});
});
