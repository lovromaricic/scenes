import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * Words update live as they're typed, in the settings and on the preview: the preview, the
 * timeline and the other field follow every keystroke; Enter is a new line; Esc or a click
 * elsewhere stops; undo takes a burst of typing at a time; edits survive an immediate reload;
 * composed characters (č, ć, š, ž, đ) arrive whole.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const words = (page: Page) => api<string>(page, 's => s.project.texts[0]?.text');
const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

/** A caption "Hello" on the red video, selected (not being typed into). */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['solid-red.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
	const id = await api<string>(page, `s => {
		s.addText('caption');
		s.stopEditingText();
		const id = s.selectedId;
		s.setTextWords(id, 'Hello');
		s.setTextAnimation(id, 'none');
		s.setTextTiming(id, 0, 6);
		s.seek(1);
		s.select(id);
		return id;
	}`);
	await expect(page.getByRole('textbox', { name: 'Words', exact: true })).toHaveValue('Hello');
	return id;
}

const label = (page: Page, id: string) => page.locator(`[data-item-id="${id}"] .name`);
const box = async (page: Page) => (await page.locator('.text-box').first().boundingBox())!;

test.describe('Typing words, live', () => {
	test.setTimeout(120_000);

	test('in the Words field: the preview and the timeline follow every keystroke; Enter is a new line; Esc stops', async ({ page }) => {
		const id = await setup(page);
		const field = page.getByRole('textbox', { name: 'Words', exact: true });
		await field.click();
		await field.press('End');
		const w0 = (await box(page)).width;
		let last = w0;
		for (const ch of ' there') {
			await page.keyboard.type(ch);
			// Without Enter or leaving the field: already in the words, the timeline, the preview.
			const now = await field.inputValue();
			await expect.poll(() => words(page)).toBe(now);
			await expect(label(page, id)).toHaveText(now);
			if (ch !== ' ') {
				await expect.poll(async () => (await box(page)).width).toBeGreaterThan(last);
				last = (await box(page)).width;
			}
		}
		expect(last).toBeGreaterThan(w0);

		// Enter: a new line (two lines on the preview), still typing.
		const h1 = (await box(page)).height;
		await page.keyboard.press('Enter');
		await page.keyboard.type('friend');
		await expect.poll(() => words(page)).toBe('Hello there\nfriend');
		await expect.poll(async () => (await box(page)).height).toBeGreaterThan(h1 * 1.6);
		await expect(field).toBeFocused();

		// Esc stops typing and keeps it.
		await page.keyboard.press('Escape');
		await expect(field).not.toBeFocused();
		expect(await words(page)).toBe('Hello there\nfriend');
		expect(await api<string | null>(page, 's => s.selectedId')).toBe(id);
	});

	test('on the preview: live, Enter is a new line, the Words field follows, Esc or a click elsewhere stops and keeps it', async ({ page }) => {
		const id = await setup(page);
		const field = page.getByRole('textbox', { name: 'Words', exact: true });
		await page.locator('.text-box .hit').first().dblclick();
		const typing = page.getByRole('textbox', { name: 'Type the words on the video' });
		await expect(typing).toBeFocused();
		await page.keyboard.press('End');
		for (const ch of '!!') {
			await page.keyboard.type(ch);
			await expect.poll(() => words(page)).toMatch(/^Hello!+$/);
		}
		expect(await words(page)).toBe('Hello!!');
		// Both visible: the field follows, and so does the timeline.
		await expect(field).toHaveValue('Hello!!');
		await expect(label(page, id)).toHaveText('Hello!!');
		// Enter: a new line, still typing.
		await page.keyboard.press('Enter');
		await page.keyboard.type('Bye');
		await expect.poll(() => words(page)).toBe('Hello!!\nBye');
		await expect(typing).toBeFocused();
		await expect(field).toHaveValue('Hello!!\nBye');

		// Esc: stops, keeps it.
		await page.keyboard.press('Escape');
		await expect(typing).toHaveCount(0);
		expect(await words(page)).toBe('Hello!!\nBye');

		// A click elsewhere also stops and keeps it.
		await page.locator('.text-box .hit').first().dblclick();
		await expect(typing).toBeFocused();
		await page.keyboard.press('End');
		await page.keyboard.type(' x');
		await page.mouse.click(5, 300);
		await expect(typing).toHaveCount(0);
		expect(await words(page)).toBe('Hello!!\nBye x');

		// Typing in the field while typing on the preview: the preview stops, the field takes over.
		await page.locator('.text-box .hit').first().dblclick();
		await expect(typing).toBeFocused();
		await api(page, `s => s.select('${id}')`);
		await field.click();
		await field.press('End');
		await page.keyboard.type('z');
		await expect(typing).toHaveCount(0);
		await expect.poll(() => words(page)).toBe('Hello!!\nBye xz');
	});

	test('undo takes back a burst of typing at a time', async ({ page }) => {
		await setup(page);
		const field = page.getByRole('textbox', { name: 'Words', exact: true });
		await field.click();
		await field.press('End');
		await page.keyboard.type(' one', { delay: 40 });
		await page.waitForTimeout(1300); // a pause: the next burst is a new step
		await page.keyboard.type(' two', { delay: 40 });
		await page.keyboard.press('Escape'); // leaving the field ends it too
		expect(await words(page)).toBe('Hello one two');
		await page.keyboard.press(undoKey);
		expect(await words(page)).toBe('Hello one');
		await page.keyboard.press(undoKey);
		expect(await words(page)).toBe('Hello');

		// On the preview too: everything typed before Esc is one step.
		await page.locator('.text-box .hit').first().dblclick();
		await page.keyboard.press('End');
		await page.keyboard.type(' again', { delay: 40 });
		await page.keyboard.press('Escape');
		expect(await words(page)).toBe('Hello again');
		await page.keyboard.press(undoKey);
		expect(await words(page)).toBe('Hello');
	});

	test('saved shortly after typing stops, not on every keystroke; an immediate reload keeps it', async ({ page }) => {
		await setup(page);
		await api(page, 's => s.flushSave()');
		await page.evaluate(() => {
			const w = window as unknown as { __saves: number };
			w.__saves = 0;
			const put = IDBObjectStore.prototype.put;
			IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
				if (this.name === 'projects') w.__saves++;
				return put.apply(this, args);
			};
		});
		const saves = () => page.evaluate(() => (window as unknown as { __saves: number }).__saves);
		const field = page.getByRole('textbox', { name: 'Words', exact: true });
		await field.click();
		await field.press('End');
		await page.keyboard.type(' typed quickly', { delay: 30 });
		// Fourteen keystrokes in about half a second: at most one save so far.
		expect(await saves()).toBeLessThanOrEqual(1);
		await page.waitForTimeout(900);
		const after = await saves();
		expect(after).toBeGreaterThanOrEqual(1);
		expect(after).toBeLessThanOrEqual(2);

		// Typing, then reloading straight away (still in the field, nothing confirmed).
		await page.keyboard.type(' and kept');
		await page.reload();
		await expect.poll(() => words(page), { timeout: 15_000 }).toBe('Hello typed quickly and kept');

		// The same on the preview.
		await api(page, `s => { s.seek(1); s.select(s.project.texts[0].id); }`);
		await page.locator('.text-box .hit').first().dblclick();
		await page.keyboard.press('End');
		await page.keyboard.type('!');
		await page.reload();
		await expect.poll(() => words(page), { timeout: 15_000 }).toBe('Hello typed quickly and kept!');
	});

	test('Croatian letters, typed and composed, arrive whole', async ({ page }) => {
		await setup(page);
		const field = page.getByRole('textbox', { name: 'Words', exact: true });
		await field.click();
		await field.press('End');
		await page.keyboard.type(' čćšžđ ČĆŠŽĐ');
		await expect.poll(() => words(page)).toBe('Hello čćšžđ ČĆŠŽĐ');

		// An input method composing a character: nothing halfway, the whole letter at the end.
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.imeSetComposition', { text: 'c', selectionStart: 1, selectionEnd: 1 });
		await cdp.send('Input.imeSetComposition', { text: 'cˇ', selectionStart: 2, selectionEnd: 2 });
		expect(await words(page)).toBe('Hello čćšžđ ČĆŠŽĐ');
		await cdp.send('Input.insertText', { text: 'č' });
		await expect.poll(() => words(page)).toBe('Hello čćšžđ ČĆŠŽĐč');
		await expect(label(page, await api<string>(page, 's => s.project.texts[0].id'))).toHaveText('Hello čćšžđ ČĆŠŽĐč');

		// On the preview as well.
		await page.keyboard.press('Escape');
		await page.locator('.text-box .hit').first().dblclick();
		await page.keyboard.press('End');
		await cdp.send('Input.imeSetComposition', { text: 'd', selectionStart: 1, selectionEnd: 1 });
		expect(await words(page)).toBe('Hello čćšžđ ČĆŠŽĐč');
		await cdp.send('Input.insertText', { text: 'đ' });
		await page.keyboard.type('ž');
		await expect.poll(() => words(page)).toBe('Hello čćšžđ ČĆŠŽĐčđž');
		await page.keyboard.press('Escape');
		expect(await words(page)).toBe('Hello čćšžđ ČĆŠŽĐčđž');
	});
});
