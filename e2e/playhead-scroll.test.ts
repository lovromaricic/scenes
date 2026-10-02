import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo } from './helpers';

/**
 * The playhead's handle is part of the ruler, which stays at the top while the tracks scroll: it
 * stays visible, on top of the ruler and the range, aligned with the line, and draggable, at any
 * scroll position, zoom, and while playing.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Red (0–4 s), green (4–7 s), and ten more overlay tracks, so the tracks scroll. */
async function setup(page: Page) {
	await openNewVideo(page);
	await importViaPicker(page, ['red.mp4', 'green.mp4'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();
	await page.keyboard.press('Escape');
	await api(page, `s => {
		for (let k = 0; k < 10; k++) {
			const t = s.addTrack('overlay', 0);
			const c = s.addCardOverlay(k * 0.5, t);
			s.setOverlayTiming(c, k * 0.5, 1.5);
		}
		s.setRange({ start: 2, end: 5 });
		s.seek(3);
		s.deselect();
	}`);
}

/** The handle, the line, the ruler and the tracks' visible area, and what's on top at the handle. */
async function state(page: Page) {
	await frames(page);
	return page.evaluate(() => {
		const rect = (el: Element) => {
			const r = el.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		};
		const handle = document.querySelector('[data-testid="playhead-head"] .handle')!;
		const line = document.querySelector('.storyboard .playhead')!;
		const ruler = document.querySelector('.ruler')!;
		const tracks = document.querySelector('.storyboard .tracks')!;
		const corner = document.querySelector('.ruler-row .corner')!.getBoundingClientRect();
		const h = rect(handle);
		const top = document.elementFromPoint(h.x + h.width / 2, h.y + h.height / 2);
		return {
			handle: h,
			line: rect(line),
			ruler: rect(ruler),
			tracks: rect(tracks),
			onTop: top === handle,
			topIs: top ? `${top.tagName}.${top.className}` : 'none',
			/** Where the ruler's visible part starts (right of the track headers). */
			laneLeft: corner.right,
			scrollTop: tracks.scrollTop,
			maxScroll: tracks.scrollHeight - tracks.clientHeight
		};
	});
}

function expectAligned(s: Awaited<ReturnType<typeof state>>) {
	// Visible, inside the ruler (which is inside the tracks' visible area), on top of everything.
	expect(s.handle.y).toBeGreaterThanOrEqual(s.ruler.y - 1);
	expect(s.handle.y + s.handle.height).toBeLessThanOrEqual(s.ruler.y + s.ruler.height + 1);
	expect(s.ruler.y).toBeGreaterThanOrEqual(s.tracks.y - 1);
	expect(s.onTop, `${s.topIs} is on top of the handle`).toBe(true);
	// Lined up with the line.
	expect(Math.abs(s.handle.x + s.handle.width / 2 - (s.line.x + s.line.width / 2))).toBeLessThan(1.5);
}

test.describe('The playhead while the tracks scroll', () => {
	test.setTimeout(120_000);

	test('scrolled to the bottom and back: the handle stays on the ruler, on top, aligned with the line', async ({ page }, info) => {
		await setup(page);
		const top = await state(page);
		expect(top.maxScroll).toBeGreaterThan(100); // the tracks do scroll
		expectAligned(top);

		await page.locator('.storyboard .tracks').evaluate((el) => (el.scrollTop = el.scrollHeight));
		const bottom = await state(page);
		expect(bottom.scrollTop).toBeGreaterThan(100);
		expectAligned(bottom);
		// It didn't move on screen.
		expect(Math.abs(bottom.handle.y - top.handle.y)).toBeLessThan(1);
		await page.locator('.storyboard').screenshot({ path: info.outputPath('scrolled.png') });

		// Over the range's start edge: still the handle on top.
		await api(page, 's => s.seek(2)');
		expectAligned(await state(page));

		await page.locator('.storyboard .tracks').evaluate((el) => (el.scrollTop = 0));
		expectAligned(await state(page));
	});

	test('dragging the handle while scrolled down moves the playhead as usual', async ({ page }) => {
		await setup(page);
		await page.locator('.storyboard .tracks').evaluate((el) => (el.scrollTop = el.scrollHeight));
		const s = await state(page);
		const range = (await page.getByTestId('range').boundingBox())!;
		const pps = range.width / 3; // 2–5 s
		await page.mouse.move(s.handle.x + s.handle.width / 2, s.handle.y + s.handle.height / 2);
		await page.mouse.down();
		await page.mouse.move(s.handle.x + s.handle.width / 2 + pps * 2, s.handle.y + s.handle.height / 2, { steps: 8 });
		await page.mouse.up();
		expect(await api<number>(page, 's => s.time')).toBeCloseTo(5, 0);
		expect((await api<{ start: number }>(page, 's => s.range')).start).toBe(2); // not the range
		expectAligned(await state(page));
	});

	test('aligned while zoomed and scrolled sideways, and while playing', async ({ page }) => {
		await setup(page);
		await page.getByRole('slider', { name: 'Storyboard zoom' }).fill('0.7');
		await api(page, 's => s.seek(5)');
		const tracks = page.locator('.storyboard .tracks');
		// Scrolled down, and sideways so the playhead is in the middle.
		await tracks.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
			const line = el.querySelector('.playhead')!.getBoundingClientRect();
			el.scrollLeft += line.x - el.getBoundingClientRect().x - el.clientWidth / 2;
		});
		expect(await tracks.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);
		const zoomed = await state(page);
		expect(zoomed.handle.x).toBeGreaterThan(zoomed.laneLeft + 8);
		expectAligned(zoomed);

		await api(page, 's => { s.seek(0.2); s.togglePlay(); }');
		for (let i = 0; i < 8; i++) {
			const s = await state(page);
			// Where it's in view (not under the headers on the left).
			if (s.handle.x > s.laneLeft + 8 && s.handle.x < s.tracks.x + s.tracks.width - 16) expectAligned(s);
		}
		await api(page, 's => { if (s.playing) s.togglePlay(); }');
	});
});
