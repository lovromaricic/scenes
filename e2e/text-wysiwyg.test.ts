import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * Typing on the preview looks exactly like the result: the words are drawn by the video's own
 * renderer while they're typed (lines, font, shadow, outline, box, turn, faded outside the
 * frame), so entering, typing and leaving typing cause no jump. Caret and selection land on the
 * drawn letters. No spellcheck.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));

/** Hide what's meant to differ (the caret, the toolbar and turn handle that show when not typing, toasts). */
async function steady(page: Page) {
	await page.addStyleTag({
		content: `.caret, [data-testid="selection-toolbar"], [data-text-handle="rotate"], .toasts, .font-missing { visibility: hidden !important; }
		* { animation: none !important; transition: none !important; }`
	});
}

/** The stage (the preview and the faded parts outside it), once the frame is drawn. */
async function shot(page: Page): Promise<Buffer> {
	await expect.poll(() => api<boolean>(page, 's => s.player.isFrameReady()'), { timeout: 10_000 }).toBe(true);
	await frames(page);
	return page.getByTestId('stage').screenshot();
}

/** How many pixels differ visibly between two screenshots (any channel by more than 24). */
async function diff(page: Page, a: Buffer, b: Buffer): Promise<{ changed: number; total: number }> {
	return page.evaluate(
		async ([a, b]) => {
			const load = async (b64: string) => {
				const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
				const c = new OffscreenCanvas(img.width, img.height);
				const ctx = c.getContext('2d')!;
				ctx.drawImage(img, 0, 0);
				return ctx.getImageData(0, 0, img.width, img.height);
			};
			const [x, y] = await Promise.all([load(a), load(b)]);
			if (x.width !== y.width || x.height !== y.height) return { changed: Infinity, total: 0 };
			let changed = 0;
			for (let i = 0; i < x.data.length; i += 4)
				if (Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2])) > 24)
					changed++;
			return { changed, total: x.data.length / 4 };
		},
		[a.toString('base64'), b.toString('base64')]
	);
}

const textBox = async (page: Page) => (await page.locator('.text-box').first().boundingBox())!;

type Case = {
	name: string;
	words: string;
	setup: string;
	/** What to type while editing (at the end). */
	type: string;
};

const CASES: Case[] = [
	{
		name: 'long words wrapping onto several lines, with a shadow',
		words: 'Saturday morning market by the old harbour in Split, with fresh figs',
		setup: `s.setTextStyle(id, 'clean'); s.setTextShadow(id, { on: true, color: '#000000', opacity: 0.8, blur: 0.1, distance: 0.08, angle: 45 });`,
		type: ' and more'
	},
	{
		name: 'a large italic title with its shadow',
		words: 'Big day',
		setup: `s.setTextStyle(id, 'title'); s.setTextSize(id, 220 / 720);`,
		type: '!'
	},
	{
		name: 'an outline',
		words: 'Outlined words',
		setup: `s.setTextStyle(id, 'outline');`,
		type: ' here'
	},
	{
		name: 'a box, turned and scaled',
		words: 'In a box\nturned',
		setup: `s.setTextStyle(id, 'boxed'); s.setItemValues(id, { rotation: 15, scaleX: 1.3, scaleY: 1.3 });`,
		type: ' more'
	},
	{
		name: 'the highlighter',
		words: 'Highlighted',
		setup: `s.setTextStyle(id, 'highlight');`,
		type: ' line'
	},
	{
		name: 'partly outside the frame (faded on the pasteboard)',
		words: 'Sliding in from the left',
		setup: `s.setTextStyle(id, 'clean'); s.setTextSize(id, 90 / 720); s.setTextPosition(id, 0.08, 0.5);`,
		type: ' now'
	}
];

async function setup(page: Page, c: Case) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	await api(page, `s => {
		s.addText('caption');
		s.stopEditingText();
		const id = s.selectedId;
		s.setTextWords(id, ${JSON.stringify(c.words)});
		s.setTextAnimation(id, 'none');
		s.setTextTiming(id, 0, 6);
		s.setTextPosition(id, 0.5, 0.5);
		${c.setup}
		s.seek(1);
		s.select(id);
	}`);
	await steady(page);
}

test.describe('Typing on the preview looks like the result', () => {
	test.setTimeout(120_000);

	for (const c of CASES) {
		test(`no jump entering, typing and leaving: ${c.name}`, async ({ page }, info) => {
			await setup(page, c);
			const before = await shot(page);
			const boxBefore = await textBox(page);

			// Enter typing: identical (the same renderer draws the words; the outline is the same).
			await page.locator('.text-box .hit').first().dblclick();
			const typing = page.getByRole('textbox', { name: 'Type the words on the video' });
			await expect(typing).toBeFocused();
			await page.keyboard.press('ArrowRight'); // drop the select-all highlight
			await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
			const entering = await shot(page);
			const d1 = await diff(page, before, entering);
			expect(d1.changed, 'entering').toBeLessThan(d1.total * 0.0005);
			const boxEditing = await textBox(page);
			for (const k of ['x', 'y', 'width', 'height'] as const) expect(boxEditing[k]).toBeCloseTo(boxBefore[k], 0);

			// Type, with a new line: during typing, exactly what it'll be once typing stops.
			await page.keyboard.type(c.type);
			await page.keyboard.press('Enter');
			await page.keyboard.type('next');
			const during = await shot(page);
			await page.screenshot({ path: info.outputPath('typing.png') });
			await page.keyboard.press('Escape');
			await expect(typing).toHaveCount(0);
			const after = await shot(page);
			await page.screenshot({ path: info.outputPath('after.png') });
			const d2 = await diff(page, during, after);
			expect(d2.changed, 'leaving').toBeLessThan(d2.total * 0.0005);
			expect(await api<string>(page, 's => s.project.texts[0].text')).toBe(`${c.words}${c.type}\nnext`);
		});
	}

	test('Enter at the end then leaving: the new empty line causes no jump either', async ({ page }) => {
		const c = CASES[1];
		await setup(page, c);
		const before = await shot(page);
		await page.locator('.text-box .hit').first().dblclick();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Enter');
		await page.keyboard.type('  ');
		const during = await shot(page);
		expect((await diff(page, before, during)).changed).toBeLessThan(50);
		await page.keyboard.press('Escape');
		const after = await shot(page);
		expect((await diff(page, before, after)).changed).toBeLessThan(50);
		expect(await api<string>(page, 's => s.project.texts[0].text')).toBe('Big day');
	});

	test('no spellcheck, autocorrect or autocapitalize; no HTML text drawn over the video', async ({ page }) => {
		await setup(page, CASES[0]);
		await page.locator('.text-box .hit').first().dblclick();
		const typing = page.getByRole('textbox', { name: 'Type the words on the video' });
		for (const [attr, value] of [
			['spellcheck', 'false'],
			['autocorrect', 'off'],
			['autocapitalize', 'off'],
			['autocomplete', 'off']
		])
			await expect(typing).toHaveAttribute(attr, value);
		// The field taking the typing is invisible; nothing editable is shown as HTML text.
		expect(await typing.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
		await expect(page.locator('.text-box [contenteditable]')).toHaveCount(0);
		const words = page.getByRole('textbox', { name: 'Words', exact: true });
		for (const [attr, value] of [
			['spellcheck', 'false'],
			['autocorrect', 'off'],
			['autocapitalize', 'off'],
			['autocomplete', 'off']
		])
			await expect(words).toHaveAttribute(attr, value);
	});

	test('the caret and selection land on the drawn letters: click, drag, double-click, Shift + arrows, Up and Down', async ({ page }) => {
		await setup(page, { name: '', words: 'HELLO WORLD', setup: `s.setTextStyle(id, 'boxed'); s.setTextSize(id, 80 / 720);`, type: '' });
		await page.locator('.text-box .hit').first().dblclick();
		const typing = page.getByRole('textbox', { name: 'Type the words on the video' });
		const sel = () => typing.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]);
		const b = await textBox(page);
		const mid = b.y + b.height / 2;

		// A click just right of the middle: the caret is between the words (index 5 or 6), and drawn there.
		await page.mouse.click(b.x + b.width / 2 + 2, mid);
		const [s0, e0] = await sel();
		expect(s0).toBe(e0);
		expect([5, 6]).toContain(s0);
		const caret = (await page.getByTestId('text-caret').boundingBox())!;
		expect(Math.abs(caret.x - (b.x + b.width / 2))).toBeLessThan(30);
		// Typing goes in there.
		await page.keyboard.type('_');
		await expect.poll(() => api<string>(page, 's => s.project.texts[0].text')).toMatch(/^HELLO_? ?_?WORLD$/);
		await page.keyboard.press('Backspace');

		// Double-click the right word: "WORLD" selected, highlighted on the right half.
		await page.mouse.dblclick(b.x + b.width * 0.75, mid);
		expect(await sel()).toEqual([6, 11]);
		const h = (await page.locator('.highlight').first().boundingBox())!;
		expect(h.x).toBeGreaterThan(b.x + b.width * 0.42); // after "HELLO " (WORLD is a little wider)
		expect(h.x + h.width).toBeLessThan(b.x + b.width);
		// Shift + Left shrinks it by one.
		await page.keyboard.press('Shift+ArrowLeft');
		expect(await sel()).toEqual([6, 10]);

		// Drag from the left edge of the letters to the middle: the first word.
		await page.mouse.move(b.x + 2, mid);
		await page.mouse.down();
		await page.mouse.move(b.x + b.width * 0.3, mid, { steps: 4 });
		await page.mouse.move(b.x + b.width / 2 - 6, mid, { steps: 4 });
		await page.mouse.up();
		const [ds, de] = await sel();
		expect(ds).toBe(0);
		expect(de).toBeGreaterThanOrEqual(4);
		expect(de).toBeLessThanOrEqual(6);

		// Two lines: Up and Down move between the drawn lines, keeping the place across.
		await page.keyboard.press('ArrowRight');
		await typing.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.type('ONE TWO\nTHREE FOUR');
		await expect.poll(() => api<string>(page, 's => s.project.texts[0].text')).toBe('ONE TWO\nTHREE FOUR');
		await page.keyboard.press('ArrowUp');
		const [up] = await sel();
		expect(up).toBeLessThanOrEqual(7);
		expect(up).toBeGreaterThan(3);
		await page.keyboard.press('ArrowDown');
		expect((await sel())[0]).toBeGreaterThan(8);
		await page.keyboard.press('Home');
		expect((await sel())[0]).toBe(8);
		await page.keyboard.press('End');
		expect((await sel())[0]).toBe(18);
	});

	test('clicking on turned words places the caret on the drawn letter', async ({ page }) => {
		await setup(page, { name: '', words: 'ABCDEFGH', setup: `s.setTextStyle(id, 'boxed'); s.setTextSize(id, 80 / 720); s.setItemValues(id, { rotation: 30 });`, type: '' });
		await page.locator('.text-box .hit').first().dblclick();
		const typing = page.getByRole('textbox', { name: 'Type the words on the video' });
		// The box's own (unturned) frame: click near its left end, along the turned line.
		const info = await page.locator('.text-box').first().evaluate((el) => {
			const r = el.getBoundingClientRect();
			return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: (el as HTMLElement).offsetWidth };
		});
		const t = (30 * Math.PI) / 180;
		const along = -info.w * 0.32; // about the second letter
		await page.mouse.click(info.cx + along * Math.cos(t), info.cy + along * Math.sin(t));
		const i = await typing.evaluate((el: HTMLTextAreaElement) => el.selectionStart);
		expect(i).toBeGreaterThanOrEqual(1);
		expect(i).toBeLessThanOrEqual(2);
	});
});
