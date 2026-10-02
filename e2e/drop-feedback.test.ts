import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixture, importViaPicker, openNewVideo } from './helpers';

/**
 * Drops that aren't allowed are shown before the drop (the track dims, the cursor says no, a
 * hint by the pointer says why) and change nothing on release, with no message after. Messages
 * about an item appear as a bubble next to it in the storyboard; other messages as a toast at the
 * bottom centre, never over the video.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;
const box = async (l: Locator) => (await l.boundingBox())!;
const row = (page: Page, name: string) => page.locator('[data-track-row]').filter({ has: page.getByRole('group', { name, exact: true }) });
const lane = (page: Page, name: string) => page.getByRole('group', { name, exact: true });
const hint = (page: Page) => page.getByTestId('drop-hint');
const bubble = (page: Page) => page.getByTestId('item-bubble');
const toast = (page: Page) => page.locator('.toast');

async function setup(page: Page, clips = ['red.mp4']) {
	await openNewVideo(page);
	await importViaPicker(page, clips, 'Choose photos & videos');
	await expect(page.getByRole('button', { name: new RegExp(`^Scene ${clips.length}, `) })).toBeVisible();
	await page.keyboard.press('Escape');
	// The welcome message, out of the way.
	await page.evaluate(() => document.querySelectorAll('.toast button').forEach((b) => (b as HTMLButtonElement).click()));
	await expect(page.locator('.toast')).toHaveCount(0);
}

/** Press on `from`, move onto the middle of `to` (holding there), and give back a way to release. */
async function dragOnto(page: Page, from: Locator, to: Locator, fx = 0.3) {
	const a = await box(from);
	const b = await box(to);
	await page.mouse.move(a.x + Math.min(30, a.width / 2), a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width * fx, b.y + b.height / 2, { steps: 10 });
	return async () => page.mouse.up();
}

/** The hint's shown, the track dims with the "not allowed" cursor, and there's no drop marker. */
async function expectBlocked(page: Page, track: Locator, text: string) {
	await expect(hint(page)).toHaveText(text);
	await expect(track).toHaveClass(/blocked/);
	expect(await page.evaluate(() => document.documentElement.classList.contains('drop-blocked'))).toBe(true);
	expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe('not-allowed');
	await expect(page.locator('.gap-line, .row.target')).toHaveCount(0);
	// Next to the pointer.
	const h = await box(hint(page));
	const t = await box(track);
	expect(h.y).toBeGreaterThan(t.y - 10);
}

/** After a refused drop: nothing left on screen, and no message about it. */
async function expectNothingAfter(page: Page) {
	await expect(hint(page)).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.classList.contains('drop-blocked'))).toBe(false);
	await expect(bubble(page)).toHaveCount(0);
	await expect(toast(page)).toHaveCount(0);
}

test.describe('Drops that aren’t allowed', () => {
	test.setTimeout(120_000);

	test('the only scene over an overlay track: not allowed, with a hint; released, it stays a scene', async ({ page }, info) => {
		await setup(page);
		const release = await dragOnto(page, page.locator('.card-slot').first(), lane(page, 'Overlay 1'));
		await expectBlocked(page, row(page, 'Overlay 1'), 'Your video needs at least one scene, so this stays a scene.');
		await page.screenshot({ path: info.outputPath('only-scene.png') });
		await release();
		expect(await api<number>(page, 's => s.project.scenes.length')).toBe(1);
		expect(await api<number>(page, 's => s.project.overlays.length')).toBe(0);
		await expectNothingAfter(page);
	});

	test('a sound onto a picture track, a layer onto an audio track, words onto the scenes, anything onto a locked track: all go back', async ({ page }) => {
		await setup(page);
		// A taller storyboard (the divider dragged up), so every track is in view at once.
		const d = await box(page.getByRole('separator', { name: 'Resize the storyboard' }));
		await page.mouse.move(d.x + 300, d.y + d.height / 2);
		await page.mouse.down();
		await page.mouse.move(d.x + 300, d.y + d.height / 2 - 260, { steps: 6 });
		await page.mouse.up();
		// A song on Audio 1, a card on Overlay 1, words on Text, and a locked overlay track.
		await page.getByRole('button', { name: /^Sound Music/ }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: /^Music Add a song/ }).click();
		await (await chooser).setFiles(fixture('music.m4a'));
		await expect(page.locator('.item-slot.sound')).toHaveCount(1);
		await page.keyboard.press('Escape');
		const ids = await api<{ card: string; words: string; locked: string }>(page, `s => {
			const card = s.addCardOverlay(0.5, s.project.tracks.find((t) => t.name === 'Overlay 1').id);
			s.setOverlayTiming(card, 0.5, 1.5);
			s.addText('caption');
			s.stopEditingText();
			const words = s.selectedId;
			const locked = s.addTrack('overlay', 0, 'Locked');
			s.edit('lock', (p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === locked ? { ...t, locked: true } : t)) }));
			s.deselect();
			return { card, words, locked };
		}`);
		const before = await api<string>(page, 's => JSON.stringify({ o: s.project.overlays, t: s.project.texts, s: s.project.sounds.map((x) => [x.trackId, x.start]) })');

		const cases: [Locator, string, string][] = [
			[page.locator('.item-slot.sound .item'), 'Overlay 1', 'Sounds go on the audio tracks below the scenes.'],
			[page.locator(`[data-item-id="${ids.card}"] .item`), 'Audio 1', 'Pictures and words go on the tracks above the scenes.'],
			[page.locator(`[data-item-id="${ids.card}"] .item`), 'Locked', 'This track is locked. Unlock it to put things on it.']
		];
		for (const [item, name, text] of cases) {
			const release = await dragOnto(page, item, lane(page, name));
			await expectBlocked(page, row(page, name), text);
			await release();
			await expectNothingAfter(page);
		}
		// Words onto the Scenes track.
		const release = await dragOnto(page, page.locator(`[data-item-id="${ids.words}"] .item`), page.getByRole('group', { name: 'Scenes' }));
		await expectBlocked(page, page.getByRole('group', { name: 'Scenes' }), 'Words can’t be a scene. Put them on a track above the scenes.');
		await release();
		await expectNothingAfter(page);
		// Everything is exactly where it was.
		expect(await api<string>(page, 's => JSON.stringify({ o: s.project.overlays, t: s.project.texts, s: s.project.sounds.map((x) => [x.trackId, x.start]) })')).toBe(before);
	});

	test('from outside: a photo from Your media over an audio track, and a sound file over a picture track', async ({ page }) => {
		await setup(page);
		const media = await api<string>(page, 's => Object.keys(s.media)[0]');
		const drag = async (target: Locator, types: { media?: string; sound?: boolean }, event: 'dragover' | 'drop') => {
			const b = await box(target);
			await target.evaluate(
				(el, { x, y, media, sound, event }) => {
					const dt = new DataTransfer();
					if (media) dt.setData('application/x-scenes-media', media);
					if (sound) dt.items.add(new File([new Uint8Array(8)], 'song.mp3', { type: 'audio/mpeg' }));
					el.dispatchEvent(new DragEvent(event, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
				},
				{ x: b.x + 60, y: b.y + b.height / 2, media: types.media, sound: types.sound, event }
			);
		};
		await drag(lane(page, 'Audio 1'), { media }, 'dragover');
		await expectBlocked(page, row(page, 'Audio 1'), 'Pictures and words go on the tracks above the scenes.');
		await drag(lane(page, 'Audio 1'), { media }, 'drop');
		await expect(hint(page)).toHaveCount(0);
		await drag(lane(page, 'Overlay 1'), { sound: true }, 'dragover');
		await expect(hint(page)).toHaveText('To add a sound, use Sound in the Add panel.');
		await drag(lane(page, 'Overlay 1'), { sound: true }, 'drop');
		expect(await api<number>(page, 's => s.project.overlays.length')).toBe(0);
		expect(await api<number>(page, 's => s.project.scenes.length')).toBe(1);
		await expectNothingAfter(page);
	});
});

test.describe('Where messages appear', () => {
	test.setTimeout(120_000);

	test('a message about an item: a bubble next to it in the storyboard, which goes by itself, on a click or on Esc', async ({ page }, info) => {
		await setup(page);
		const card = await api<string>(page, `s => {
			const c = s.addCardOverlay(0.5);
			s.setOverlayTiming(c, 0.5, 1.5);
			s.select(c);
			s.seek(3);
			return c;
		}`);
		// Adding a keyframe with the playhead outside it: the message is about that layer.
		await api(page, `s => s.toggleKeyframe('${card}')`);
		await expect(bubble(page)).toHaveText(/Move the playhead onto it to add a keyframe\./);
		await expect(bubble(page)).toHaveAttribute('data-item', card);
		await expect(toast(page)).toHaveCount(0);
		const b = await box(bubble(page));
		const item = await box(page.locator(`[data-item-id="${card}"]`));
		const story = await box(page.locator('.storyboard'));
		const ruler = await box(page.locator('.ruler-row'));
		const preview = await box(page.getByTestId('preview'));
		// Next to the item (above it, or below when there's no room under the ruler), pointing at it.
		expect(b.y + b.height <= item.y + 1 || b.y >= item.y + item.height - 1).toBe(true);
		expect(b.x).toBeLessThan(item.x + item.width);
		expect(b.x + b.width).toBeGreaterThan(item.x);
		// Inside the storyboard, under the ruler (so not over the playhead's handle), not on the video.
		expect(b.x).toBeGreaterThanOrEqual(story.x);
		expect(b.x + b.width).toBeLessThanOrEqual(story.x + story.width);
		expect(b.y + b.height).toBeLessThanOrEqual(story.y + story.height);
		expect(b.y).toBeGreaterThanOrEqual(ruler.y + ruler.height - 0.5);
		expect(b.y).toBeGreaterThan(preview.y + preview.height);
		await page.screenshot({ path: info.outputPath('bubble.png') });

		// Only one: a new one replaces it.
		await api(page, `s => s.splitItemAtPlayhead('${card}')`);
		await expect(bubble(page)).toHaveCount(1);
		await expect(bubble(page)).toHaveText(/Move the playhead onto it to split it\./);
		// Goes by itself after about 4 s.
		await expect(bubble(page)).toHaveCount(0, { timeout: 6000 });
		// On a click anywhere.
		await api(page, `s => s.toggleKeyframe('${card}')`);
		await expect(bubble(page)).toBeVisible();
		await page.mouse.click(5, 300);
		await expect(bubble(page)).toHaveCount(0);
		// On Esc.
		await api(page, `s => s.toggleKeyframe('${card}')`);
		await expect(bubble(page)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(bubble(page)).toHaveCount(0);
		// With its close button.
		await api(page, `s => s.toggleKeyframe('${card}')`);
		await bubble(page).getByRole('button', { name: 'Close' }).click();
		await expect(bubble(page)).toHaveCount(0);
	});

	test('the bubble stays inside the storyboard, below an item at the top, and goes when the item scrolls away', async ({ page }) => {
		await setup(page);
		const card = await api<string>(page, `s => {
			for (let i = 0; i < 8; i++) s.addTrack('overlay', 0);
			const top = s.project.tracks[0].id;
			const c = s.addCardOverlay(0.5, top);
			s.setOverlayTiming(c, 0.5, 1.5);
			s.seek(3);
			return c;
		}`);
		await page.locator('.storyboard .tracks').evaluate((el) => (el.scrollTop = 0));
		await api(page, `s => s.toggleKeyframe('${card}')`);
		await expect(bubble(page)).toBeVisible();
		const item = await box(page.locator(`[data-item-id="${card}"]`));
		await expect.poll(async () => (await box(bubble(page))).y).toBeGreaterThanOrEqual(item.y + item.height - 1); // no room above: below
		const ruler = await box(page.locator('.ruler-row'));
		expect((await box(bubble(page))).y).toBeGreaterThanOrEqual(ruler.y + ruler.height - 0.5);
		// Scrolled out of view: it goes.
		await page.locator('.storyboard .tracks').evaluate((el) => (el.scrollTop = el.scrollHeight));
		await expect(bubble(page)).toHaveCount(0);
	});

	test('other messages: a toast at the bottom centre, never over the video; info goes, errors stay until closed', async ({ page }, info) => {
		await openNewVideo(page);
		// Nothing to split yet: a general message.
		await page.keyboard.press('s');
		await expect(toast(page)).toHaveText(/Add a clip first, then split it\./);
		const t = await box(toast(page));
		const view = page.viewportSize()!;
		expect(Math.abs(t.x + t.width / 2 - view.width / 2)).toBeLessThan(2);
		expect(t.y + t.height).toBeLessThanOrEqual(view.height - 8);
		expect(t.y).toBeGreaterThan(view.height / 2);
		const preview = await box(page.locator('.preview'));
		expect(t.y).toBeGreaterThan(preview.y + preview.height);
		await page.screenshot({ path: info.outputPath('toast.png') });
		await expect(toast(page)).toHaveCount(0, { timeout: 7000 });

		// An error (a file that can't be used) stays until it's closed.
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: 'Choose photos & videos' }).click();
		await (await chooser).setFiles(fixture('notes.txt'));
		await expect(toast(page)).toHaveText(/notes\.txt/);
		await page.waitForTimeout(6000);
		await expect(toast(page)).toHaveCount(1);
		await toast(page).getByRole('button', { name: 'Dismiss' }).click();
		await expect(toast(page)).toHaveCount(0);
	});
});
