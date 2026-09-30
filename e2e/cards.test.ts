import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { importViaPicker, scenes, seekTo, setFormat, openNewVideo } from './helpers';

type RGB = [number, number, number];
const near = (a: RGB, b: RGB, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

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

const cardNames = (page: Page) =>
	page.getByRole('button', { name: /^Scene \d+, / }).evaluateAll((els) =>
		els
			.map((el) => ({ name: el.getAttribute('aria-label')!, x: el.getBoundingClientRect().x }))
			.sort((a, b) => a.x - b.x)
			.map((e) => e.name.replace(/^Scene \d+, /, '').replace(/, .*$/, ''))
	);

type Card = {
	background: string;
	rect: null | { color: string; x: number; y: number; w: number; h: number; radius: number };
};
const cardOf = (page: Page, i: number) =>
	scenes(page, (s) =>
		(s as unknown as { project: { scenes: { card?: Card }[] } }).project.scenes.map(
			(x) => x.card ?? null
		)
	).then((c) => c[i]);

async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'blue.webm'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await setFormat(page, 'Landscape', '1080p');
}

test.describe('Cards', () => {
	test.setTimeout(120_000);

	test('Looks is gone from the Add column; moods still work from scene settings', async ({
		page
	}) => {
		await setup(page);
		const add = page.getByRole('complementary', { name: 'Add' });
		await expect(add.getByRole('button', { name: /^Looks/ })).toHaveCount(0);
		const labels = await add.locator('.add .label').allInnerTexts();
		expect(labels).toEqual(['Clips', 'Cards', 'Words', 'Sound']);
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await seekTo(page, 2);
		const before = await preview(page, 0.6, 0.6);
		await page
			.getByRole('radiogroup', { name: 'Mood' })
			.getByRole('radio', { name: 'B & W' })
			.click();
		const after = await preview(page, 0.6, 0.6);
		expect(near(after, before, 20)).toBe(false);
		expect(Math.abs(after[0] - after[1])).toBeLessThan(8);
	});

	test('add cards by clicking (after the selected scene) or by dragging onto the storyboard', async ({
		page
	}) => {
		await setup(page);
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page.getByRole('button', { name: /^Cards/ }).click();
		await expect.poll(() => cardNames(page)).toEqual(['Red', 'Card', 'Blue']);
		await expect(page.getByRole('button', { name: /^Scene 2, Card, 3s/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(page.getByRole('heading', { name: 'Scene 2' })).toBeVisible();
		// Settings that don't apply to cards are hidden.
		for (const name of ['Speed', 'Frame', 'Mood'])
			await expect(page.getByRole('radiogroup', { name })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Crop', exact: true })).toHaveCount(0);
		await page.keyboard.press('c');
		await expect(page.getByRole('heading', { name: 'Crop' })).toHaveCount(0);

		// Drag the Cards button to the very start of the storyboard.
		const source = (await page.getByRole('button', { name: /^Cards/ }).boundingBox())!;
		const target = (await page.getByRole('button', { name: /^Scene 1, / }).boundingBox())!;
		await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
		await page.mouse.down();
		await page.mouse.move(target.x + 30, target.y + 30, { steps: 10 });
		await page.mouse.move(target.x + 4, target.y + 30, { steps: 4 });
		await page.mouse.up();
		await expect.poll(() => cardNames(page)).toEqual(['Card', 'Red', 'Card', 'Blue']);

		// While a card is dragged over the storyboard, an insertion marker shows where it will land.
		// (Playwright's native drag only delivers the final events, so check the marker directly.)
		await page.waitForTimeout(400); // let the cards finish sliding into place
		await page.evaluate(() => {
			const row = document.querySelector('[role="group"][aria-label="Scenes"]') as HTMLElement;
			const card = document.querySelectorAll('.card-slot')[1] as HTMLElement;
			const r = card.getBoundingClientRect();
			const dt = new DataTransfer();
			dt.setData('application/x-scenes-card', 'card');
			row.dispatchEvent(
				new DragEvent('dragover', {
					dataTransfer: dt,
					bubbles: true,
					cancelable: true,
					clientX: r.x + 6,
					clientY: r.y + 20
				})
			);
		});
		const marker = (await page.locator('.drop-marker').boundingBox())!;
		const second = (await page.locator('.card-slot').nth(1).boundingBox())!;
		expect(Math.abs(marker.x + marker.width / 2 - second.x)).toBeLessThan(12);
		await page.evaluate(() =>
			document
				.querySelector('[role="group"][aria-label="Scenes"]')!
				.dispatchEvent(new DragEvent('dragleave', { bubbles: true }))
		);

		// Cards can be split, duplicated, removed and undone like any scene.
		await page.getByRole('button', { name: 'Duplicate' }).click();
		await expect.poll(() => cardNames(page)).toEqual(['Card', 'Card', 'Red', 'Card', 'Blue']);
		await page.getByRole('button', { name: 'Remove', exact: true }).click();
		await expect.poll(() => cardNames(page)).toEqual(['Card', 'Red', 'Card', 'Blue']);
		await seekTo(page, 1.5);
		await page.keyboard.press('s');
		await expect.poll(() => cardNames(page)).toEqual(['Card', 'Card', 'Red', 'Card', 'Blue']);
	});

	test('background, rectangle (handles, typed size, live size, snapping, Shift, corners) and a title', async ({
		page
	}) => {
		await setup(page);
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page.getByRole('button', { name: /^Cards/ }).click();

		// Background: a swatch, then a custom hex.
		await page
			.getByRole('radiogroup', { name: 'Background' })
			.getByRole('radio', { name: 'Sand' })
			.click();
		expect(near(await preview(page, 0.1, 0.1), hex('#efe6d8'), 3)).toBe(true);
		const hexField = page.getByRole('textbox', { name: 'Background: hex code' });
		await hexField.fill('#336699');
		await hexField.press('Enter');
		expect(near(await preview(page, 0.1, 0.1), hex('#336699'), 3)).toBe(true);

		// Rectangle: add, then type its size.
		await page.getByRole('button', { name: 'Add rectangle' }).click();
		await page.getByRole('spinbutton', { name: 'Rectangle width' }).fill('1200');
		await page.getByRole('spinbutton', { name: 'Rectangle height' }).fill('400');
		await expect(page.getByTestId('rect-size')).toHaveText('1200 × 400');
		await page.getByRole('button', { name: 'Center' }).click();
		await expect(page.getByRole('spinbutton', { name: 'Rectangle x' })).toHaveValue('360');
		await expect(page.getByRole('spinbutton', { name: 'Rectangle y' })).toHaveValue('340');
		expect(near(await preview(page, 0.5, 0.5), hex('#d63f1f'), 3)).toBe(true);

		// Resize with a handle: the label and the fields follow live.
		const scale = (await page.getByTestId('preview').boundingBox())!.width / 1920;
		const e = (await page.locator('[data-rect-handle="e"]').boundingBox())!;
		await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
		await page.mouse.down();
		await page.mouse.move(e.x + e.width / 2 + 100 * scale, e.y + e.height / 2, { steps: 8 });
		await expect(page.getByTestId('rect-size')).toHaveText('1300 × 400');
		await expect(page.getByRole('spinbutton', { name: 'Rectangle width' })).toHaveValue('1300');
		await page.mouse.up();

		// Shift on a corner keeps proportions.
		const se = (await page.locator('[data-rect-handle="se"]').boundingBox())!;
		await page.keyboard.down('Shift');
		await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
		await page.mouse.down();
		await page.mouse.move(se.x + se.width / 2 - 260 * scale, se.y + se.height / 2 - 10 * scale, {
			steps: 8
		});
		await page.mouse.up();
		await page.keyboard.up('Shift');
		const [w, h] = (await page.getByTestId('rect-size').innerText())
			.split('×')
			.map((v) => Number(v.trim()));
		expect(w / h).toBeCloseTo(1300 / 400, 1);

		// Snapping: moving it near the middle lands its centre exactly on the frame's centre.
		const box = (await page.getByRole('button', { name: /^Rectangle, / }).boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		const preview1 = (await page.getByTestId('preview').boundingBox())!;
		await page.mouse.move(
			preview1.x + preview1.width / 2 + 3,
			preview1.y + preview1.height / 2 + 2,
			{ steps: 8 }
		);
		await page.mouse.up();
		const rect = (await cardOf(page, 1))!.rect!;
		expect((rect.x + rect.w / 2) * 1920).toBeCloseTo(960, 0);
		expect((rect.y + rect.h / 2) * 1080).toBeCloseTo(540, 0);

		// Round the corners fully: the rectangle's corner area shows the background.
		await page.getByRole('slider', { name: 'Corner radius' }).fill('1');
		const r = (await cardOf(page, 1))!.rect!;
		const corner = await preview(page, r.x + 0.004, r.y + 0.008);
		expect(near(corner, hex('#336699'), 6)).toBe(true);
		expect(near(await preview(page, r.x + r.w / 2, r.y + r.h / 2), hex('#d63f1f'), 3)).toBe(true);

		// A title on the card.
		await page.getByRole('button', { name: /^Words/ }).click();
		await page.getByRole('button', { name: /^Title/ }).click();
		await page.keyboard.type('Chapter two');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: 'Words: Chapter two' }).first()).toBeVisible();

		// The background can still change once there's a rectangle.
		await page.getByRole('button', { name: /^Scene 2, Card/ }).click();
		await page
			.getByRole('radiogroup', { name: 'Background' })
			.getByRole('radio', { name: 'Sage' })
			.click();
		expect((await cardOf(page, 1))!.background).toBe('#d9e4d0');
		await hexField.fill('#336699');
		await hexField.press('Enter');

		// Changing the format keeps the rectangle's relative place and size.
		const before = (await cardOf(page, 1))!.rect!;
		await setFormat(page, 'Vertical');
		expect((await cardOf(page, 1))!.rect).toEqual(before);
		await page.getByRole('button', { name: /^Scene 2, Card/ }).click();
		await expect(page.getByRole('spinbutton', { name: 'Rectangle width' })).toHaveValue(
			String(Math.round(before.w * 1080))
		);

		// Undo and reload.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		// Undo walks back through the later changes and then the corner rounding.
		for (let i = 0; i < 10 && (await cardOf(page, 1))!.rect!.radius >= 1; i++) {
			await page.keyboard.press(`${mod}+z`);
		}
		expect((await cardOf(page, 1))!.rect!.radius).toBeLessThan(1);
		await page.reload();
		await expect(page.getByRole('button', { name: /^Scene 2, Card/ })).toBeVisible();
		expect((await cardOf(page, 1))!.background).toBe('#336699');
	});

	test('transitions into and out of a card, and the saved MP4 shows the card exactly', async ({
		page
	}, info) => {
		await setup(page);
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		await page.getByRole('button', { name: /^Cards/ }).click();
		const bg = page.getByRole('textbox', { name: 'Background: hex code' });
		await bg.fill('#336699');
		await bg.press('Enter');
		await page.getByRole('button', { name: 'Add rectangle' }).click();

		for (const between of ['1 and 2', '2 and 3']) {
			await page
				.getByRole('button', { name: new RegExp(`Transition between scene ${between}`) })
				.click();
			await page
				.getByRole('dialog', { name: /Transition between/ })
				.getByRole('radio', { name: /^Crossfade/ })
				.click();
		}
		// Red → card at 4s; card → blue at 7s. Half-way through each crossfade the colours blend.
		const card = hex('#336699');
		await seekTo(page, 4);
		const into = await preview(page, 0.9, 0.9);
		expect(near(into, [(255 + card[0]) / 2, card[1] / 2, card[2] / 2] as RGB, 30)).toBe(true);
		await seekTo(page, 7);
		const outOf = await preview(page, 0.9, 0.9);
		expect(near(outOf, [card[0] / 2, card[1] / 2, (255 + card[2]) / 2] as RGB, 30)).toBe(true);

		test.skip(!hasFfmpeg, 'needs ffmpeg to inspect the saved file');
		await page.getByRole('button', { name: 'Save video' }).click();
		const download = page.waitForEvent('download', { timeout: 90_000 });
		await page.getByRole('dialog').getByRole('button', { name: 'Save video' }).click();
		const file = info.outputPath('card.mp4');
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
		expect(meta.streams[0]).toMatchObject({ width: 1920, height: 1080 });
		const r = (await cardOf(page, 1))!.rect!;
		for (const [fx, fy] of [
			[0.05, 0.1],
			[r.x + r.w / 2, r.y + r.h / 2],
			[r.x + 0.03, r.y + r.h / 2],
			[r.x + 0.001, r.y + 0.002],
			[0.95, 0.9]
		]) {
			await seekTo(page, 5.5);
			const want = await preview(page, fx, fy);
			const x = Math.round(fx * 1920) - 2;
			const y = Math.round(fy * 1080) - 2;
			const raw = execFileSync('ffmpeg', [
				'-v',
				'error',
				'-ss',
				'5.5',
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
			const got: RGB = [0, 0, 0];
			for (let i = 0; i < 16; i++) for (let c = 0; c < 3; c++) got[c] += raw[i * 3 + c] / 16;
			expect(near(got.map(Math.round) as RGB, want, 12), `at ${fx},${fy}: ${got} vs ${want}`).toBe(
				true
			);
		}
	});
});
