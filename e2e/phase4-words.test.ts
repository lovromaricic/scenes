import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, isInkish, isYellowish, scenes, seekTo, textAreaPixels } from './helpers';

type Text = {
	id: string;
	text: string;
	start: number;
	duration: number;
	style: string;
	animation: string;
	x: number;
	y: number;
};
const texts = (page: Page) =>
	scenes(page, (s) =>
		(s as unknown as { project: { texts: Text[] } }).project.texts.map((t) => ({ ...t }))
	);

test.describe('Phase 4: words', () => {
	test('add a caption, type on the preview, restyle, animate and retime it', async ({ page }) => {
		await page.goto('/');
		await importViaPicker(page, ['red.mp4', 'green.mp4', 'blue.webm'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
		await seekTo(page, 1);

		// Add a caption from the Words panel: it's ready to type straight away.
		await page.getByRole('button', { name: /^Words/ }).click();
		await page.getByRole('button', { name: /^Caption/ }).click();
		const typing = page.getByRole('textbox', { name: 'Type the words on the video' });
		await expect(typing).toBeFocused();
		await page.keyboard.type('Hello from Split');
		await page.keyboard.press('Enter');
		await expect.poll(async () => (await texts(page))[0]?.text).toBe('Hello from Split');
		// Typing "S" must not have split a scene.
		await expect(page.getByRole('button', { name: /^Scene \d, / })).toHaveCount(3);

		// Drawn by WebGL in the "Bold box" style: dark box pixels over the red video.
		const words = page.getByRole('button', { name: 'Words: Hello from Split' }).first();
		await expect(words).toBeVisible();
		expect((await textAreaPixels(page)).some(isInkish)).toBe(true);

		// Edit the words again directly on the preview (double-click).
		await words.dblclick();
		await expect(typing).toBeFocused();
		await page.keyboard.type('Split at noon');
		await page.keyboard.press('Enter');
		await expect.poll(async () => (await texts(page))[0].text).toBe('Split at noon');

		// Restyle with the floating toolbar: Highlighter draws a yellow band.
		await page.getByRole('button', { name: 'Words: Split at noon' }).first().click();
		await page
			.getByRole('toolbar', { name: 'Text options' })
			.getByRole('button', { name: 'Style' })
			.click();
		await page
			.getByRole('dialog', { name: 'Text style' })
			.getByRole('radio', { name: 'Highlighter' })
			.click();
		await expect.poll(async () => (await texts(page))[0].style).toBe('highlight');
		expect((await textAreaPixels(page)).some(isYellowish)).toBe(true);

		// Animate: Pop.
		await page
			.getByRole('toolbar', { name: 'Text options' })
			.getByRole('button', { name: 'Animate' })
			.click();
		await page
			.getByRole('dialog', { name: 'Animation' })
			.getByRole('radio', { name: 'Pop' })
			.click();
		await expect.poll(async () => (await texts(page))[0].animation).toBe('pop');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Animation' })).toHaveCount(0);

		// At the very start of a pop the words are invisible; a moment later they're fully there.
		const t0 = (await texts(page))[0];
		await seekTo(page, t0.start);
		expect((await textAreaPixels(page)).some(isYellowish)).toBe(false);
		await seekTo(page, t0.start + 1);
		expect((await textAreaPixels(page)).some(isYellowish)).toBe(true);

		// Drag the pill in the Words lane about 2 seconds later.
		const lane = page.getByRole('group', { name: 'Words' });
		const pill = lane.getByRole('button', { name: /^Words: Split at noon/ });
		const pps = await page.evaluate(() => {
			const cards = document.querySelectorAll('.card-slot');
			return (cards[0] as HTMLElement).getBoundingClientRect().width / 4; // red.mp4 is 4s
		});
		const box = (await pill.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + pps * 2, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		const moved = (await texts(page))[0];
		expect(moved.start).toBeCloseTo(t0.start + 2, 0);
		expect(moved.duration).toBeCloseTo(t0.duration, 5);

		// Resize: drag the end edge 1.5 seconds later.
		const edge = page.locator('.pill-slot .edge.end').first();
		const e = (await edge.boundingBox())!;
		await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
		await page.mouse.down();
		await page.mouse.move(e.x + e.width / 2 + pps * 1.5, e.y + e.height / 2, { steps: 8 });
		await page.mouse.up();
		const resized = (await texts(page))[0];
		expect(resized.start).toBeCloseTo(moved.start, 5);
		expect(resized.duration).toBeCloseTo(moved.duration + 1.5, 0);

		// Drag the words on the preview to a new place.
		await seekTo(page, resized.start + 1);
		const onVideo = page.getByRole('button', { name: 'Words: Split at noon' }).first();
		const v = (await onVideo.boundingBox())!;
		await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
		await page.mouse.down();
		await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2 - 150, { steps: 8 });
		await page.mouse.up();
		expect((await texts(page))[0].y).toBeLessThan(0.7);

		// Every step can be undone: add, two word edits, style, animation, lane move, lane resize,
		// move on the preview.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		for (let i = 0; i < 7; i++) await page.keyboard.press(`${mod}+z`);
		expect(await texts(page)).toHaveLength(1);
		await page.keyboard.press(`${mod}+z`);
		expect(await texts(page)).toEqual([]);
	});

	test('a title is added at the playhead and can be removed with Delete', async ({ page }) => {
		await page.goto('/');
		await importViaPicker(page, ['green.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
		await page.getByRole('button', { name: /^Words/ }).click();
		await page.getByRole('button', { name: /^Title/ }).click();
		await page.keyboard.type('Big day');
		await page.keyboard.press('Enter');
		const [title] = await texts(page);
		expect(title).toMatchObject({ text: 'Big day', style: 'title', x: 0.5, y: 0.5 });
		await page.getByRole('button', { name: 'Words: Big day' }).first().click();
		await page.keyboard.press('Delete');
		expect(await texts(page)).toEqual([]);
	});
});
