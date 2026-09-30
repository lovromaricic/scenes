import { expect, test, type Page } from '@playwright/test';
import { importViaPicker } from './helpers';

const cardNames = (page: Page) =>
	page.getByRole('button', { name: /^Scene \d+, / }).evaluateAll((els) =>
		els
			.map((el) => ({ name: el.getAttribute('aria-label')!, x: el.getBoundingClientRect().x }))
			.sort((a, b) => a.x - b.x)
			.map((e) => e.name.replace(/^Scene \d+, /, '').replace(/, .*$/, ''))
	);

/** The preview's size and the space it could use (the viewport's content box). */
async function fit(page: Page) {
	return page.evaluate(() => {
		const v = document.querySelector('.viewport') as HTMLElement;
		const p = document.querySelector('.preview') as HTMLElement;
		const cs = getComputedStyle(v);
		const vw = v.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
		const vh = v.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
		const r = p.getBoundingClientRect();
		return { vw, vh, w: r.width, h: r.height };
	});
}

export async function expectPreviewFills(page: Page, ratio: number) {
	await expect
		.poll(async () => {
			const f = await fit(page);
			const shapeOk = Math.abs(f.w / f.h - ratio) / ratio < 0.01;
			const fills = Math.abs(f.w - f.vw) < 2 || Math.abs(f.h - f.vh) < 2;
			const inside = f.w <= f.vw + 1 && f.h <= f.vh + 1;
			return shapeOk && fills && inside;
		})
		.toBe(true);
}

test('the preview fills the stage in the project’s shape and follows window size', async ({
	page
}) => {
	await page.goto('/');
	await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	for (const [aspect, ratio] of [
		['16:9', 16 / 9],
		['9:16', 9 / 16],
		['1:1', 1]
	] as const) {
		await page.evaluate(
			(a) =>
				(window as unknown as { __scenes: { setAspect(a: string): void } }).__scenes.setAspect(a),
			aspect
		);
		await expectPreviewFills(page, ratio);
	}
	// A tall project gets a tall preview: it uses the full available height.
	const tall = await fit(page);
	await page.evaluate(() =>
		(window as unknown as { __scenes: { setAspect(a: string): void } }).__scenes.setAspect('9:16')
	);
	await expectPreviewFills(page, 9 / 16);
	expect((await fit(page)).h).toBeGreaterThan(tall.h * 0.95);
	// Resizing the window resizes the preview immediately.
	await page.setViewportSize({ width: 1280, height: 760 });
	await expectPreviewFills(page, 9 / 16);
});

test('“Your media” lists imported clips; click or drag one to add it as a scene', async ({
	page
}) => {
	await page.goto('/');
	await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();

	// Delete the red scene: its clip stays in "Your media".
	await page.getByRole('button', { name: /^Scene 1, Red/ }).click();
	await page.keyboard.press('Delete');
	await expect(page.getByRole('button', { name: /^Scene \d+, / })).toHaveCount(1);
	const library = page.getByRole('region', { name: 'Your media' });
	await expect(library.getByRole('button')).toHaveCount(2);
	await expect(library.getByRole('button', { name: /^Add red\.mp4/ })).toContainText('4s');

	// Click: added at the end.
	await library.getByRole('button', { name: /^Add red\.mp4/ }).click();
	await expect.poll(() => cardNames(page)).toEqual(['Green', 'Red']);

	// Drag: dropped before the first card.
	const target = (await page.getByRole('button', { name: /^Scene 1, / }).boundingBox())!;
	const source = (await library.getByRole('button', { name: /^Add green\.mp4/ }).boundingBox())!;
	await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
	await page.mouse.down();
	await page.mouse.move(target.x + 30, target.y + 30, { steps: 10 });
	await page.mouse.move(target.x + 4, target.y + 30, { steps: 4 });
	await page.mouse.up();
	await expect.poll(() => cardNames(page)).toEqual(['Green', 'Green', 'Red']);

	// It's undoable, and the list survives a reload.
	const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
	await page.keyboard.press(`${mod}+z`);
	await expect.poll(() => cardNames(page)).toEqual(['Green', 'Red']);
	await page.reload();
	await expect(page.getByRole('region', { name: 'Your media' }).getByRole('button')).toHaveCount(2);
});
