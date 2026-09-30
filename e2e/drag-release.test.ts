import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, seekTo } from './helpers';

/**
 * Every drag must stop when the mouse button is released, wherever that happens: inside the
 * preview, outside it, outside the browser window, or when the release never reaches the page
 * at all (e.g. the window lost focus mid-drag). After the release, moving the mouse must change
 * nothing. Mouse input goes through Chrome's DevTools protocol so it can leave the window and
 * so a release can be "lost".
 */

type Release = 'inside' | 'outside-preview' | 'outside-window' | 'lost';
const RELEASES: Release[] = ['inside', 'outside-preview', 'outside-window', 'lost'];

async function mouse(page: Page) {
	const cdp: CDPSession = await page.context().newCDPSession(page);
	// `button` on a move means "held": moves with no button held must say 'none'.
	const send = (type: string, x: number, y: number, buttons: number) =>
		cdp.send('Input.dispatchMouseEvent', {
			type,
			x,
			y,
			button: buttons || type !== 'mouseMoved' ? 'left' : 'none',
			buttons,
			clickCount: 1
		} as never);
	return {
		/** Press at (x, y), move by (dx, dy) in steps, then release the chosen way. */
		async drag(x: number, y: number, dx: number, dy: number, release: Release) {
			await send('mousePressed', x, y, 1);
			for (let i = 1; i <= 8; i++) await send('mouseMoved', x + (dx * i) / 8, y + (dy * i) / 8, 1);
			if (release === 'inside') await send('mouseReleased', x + dx, y + dy, 0);
			if (release === 'outside-preview') {
				await send('mouseMoved', 1420, 880, 1); // over the right column / storyboard corner
				await send('mouseReleased', 1420, 880, 0);
			}
			if (release === 'outside-window') {
				await send('mouseMoved', -40, y + dy, 1);
				await send('mouseReleased', -40, y + dy, 0);
			}
			// 'lost': the button is up, but no release event ever arrives.
		},
		/** One move with no button pressed. */
		async nudge(x: number, y: number) {
			await send('mouseMoved', x + 1, y, 0);
		},
		/** Wander about with no button pressed. */
		async wander(x: number, y: number) {
			for (let i = 0; i < 8; i++) await send('mouseMoved', x + 40 - i * 17, y - 30 + i * 11, 0);
		}
	};
}

const state = (page: Page, what: string) =>
	page.evaluate((what) => {
		const s = (window as unknown as { __scenes: Record<string, unknown> & { project: Record<string, unknown[]> } }).__scenes;
		const p = s.project as unknown as {
			overlays: { box: object }[];
			scenes: { id: string; card?: { rect: object }; sourceStart: number; sourceEnd: number }[];
			texts: { x: number; y: number; start: number }[];
			sounds: { start: number }[];
		};
		switch (what) {
			case 'layer':
				return JSON.stringify(p.overlays.map((o) => o.box));
			case 'crop':
				return JSON.stringify((s.cropping as { draft: object } | null)?.draft);
			case 'rect':
				return JSON.stringify(p.scenes.map((x) => x.card?.rect ?? null));
			case 'text':
				return JSON.stringify(p.texts.map((t) => [t.x, t.y, t.start]));
			case 'scenes':
				return JSON.stringify(p.scenes.map((x) => [x.id, x.sourceStart, x.sourceEnd]));
			case 'time':
				return String(s.time);
			default:
				return '';
		}
	}, what);

/** Drag, release (some way), wander: the state must not change after the release. */
async function checkRelease(page: Page, what: string, x: number, y: number, dx: number, dy: number, release: Release) {
	const m = await mouse(page);
	const before = await state(page, what);
	await m.drag(x, y, dx, dy, release);
	// A lost release is noticed at the first move with no button held; that's where it ends
	// (and, e.g., a reorder is put in place).
	if (release === 'lost') await m.nudge(x + dx, y + dy);
	const released = await state(page, what);
	// (Released outside, the pointer travelled on first, which may land back where it started.)
	if (release === 'inside') expect(released, `${what}: the drag did something`).not.toBe(before);
	await m.wander(x + dx, y + dy);
	expect(await state(page, what), `${what} kept changing after a ${release} release`).toBe(released);
	// And a fresh drag still works afterwards.
	await m.wander(x, y);
}

const center = async (page: Page, selector: string) => {
	const b = (await page.locator(selector).first().boundingBox())!;
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** A scene (the long clip) and one layer of the given kind at 1–6 s, selected, playhead at 2 s. */
async function withLayer(page: Page, kind: 'image' | 'video' | 'card') {
	await openNewVideo(page);
	await importViaPicker(page, ['long.mp4', 'quads.jpg', 'blue.webm'], 'Choose photos & videos');
	await expect(page.getByRole('button', { name: /^Scene 3, / })).toBeVisible();
	await page.evaluate((kind) => {
		const s = (window as unknown as {
			__scenes: {
				project: { scenes: { id: string }[] };
				media: Record<string, { id: string; name: string }>;
				deleteScene(id: string): void;
				addOverlayFromMedia(id: string, t: number): string;
				addCardOverlay(t: number): string;
			};
		}).__scenes;
		s.deleteScene(s.project.scenes[2].id);
		s.deleteScene(s.project.scenes[1].id);
		const id = (n: string) => Object.values(s.media).find((m) => m.name === n)!.id;
		if (kind === 'image') s.addOverlayFromMedia(id('quads.jpg'), 1);
		else if (kind === 'video') s.addOverlayFromMedia(id('blue.webm'), 1);
		else s.addCardOverlay(1);
	}, kind);
	await seekTo(page, 2);
	await expect(page.locator('[data-layer-handle="w"]')).toBeVisible();
	await page.waitForTimeout(300);
}

const reset = (page: Page) =>
	page.evaluate(() => {
		const s = (window as unknown as { __scenes: { project: { overlays: { id: string }[] }; setOverlayBox(id: string, b: object): void } }).__scenes;
		s.setOverlayBox(s.project.overlays[0].id, { x: 0.3, y: 0.3, w: 0.35, h: 0.35 });
	});

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const OUTWARD: Record<(typeof HANDLES)[number], [number, number]> = {
	nw: [-40, -30],
	n: [0, -40],
	ne: [40, -30],
	e: [50, 0],
	se: [40, 30],
	s: [0, 40],
	sw: [-40, 30],
	w: [-50, 0]
};

test.describe('Drags stop when the mouse button is released', () => {
	test.setTimeout(180_000);

	for (const kind of ['image', 'video', 'card'] as const) {
		test(`all 8 handles and moving a ${kind} layer, however the button is released`, async ({ page }) => {
			await withLayer(page, kind);
			for (const handle of HANDLES) {
				for (const release of RELEASES) {
					await reset(page);
					const { x, y } = await center(page, `[data-layer-handle="${handle}"]`);
					const [dx, dy] = OUTWARD[handle];
					await checkRelease(page, 'layer', x, y, dx, dy, release);
				}
			}
			for (const release of RELEASES) {
				await reset(page);
				const { x, y } = await center(page, '.layer-box.selected .move');
				await checkRelease(page, 'layer', x, y, -60, 30, release);
			}
		});
	}

	test('crop handles, however the button is released', async ({ page }) => {
		await withLayer(page, 'image');
		await page.getByRole('toolbar', { name: 'Layer options' }).getByRole('button', { name: 'Crop' }).click();
		await expect(page.getByRole('complementary', { name: 'Settings' }).getByRole('heading', { name: 'Crop' })).toBeVisible();
		for (const handle of ['nw', 'e', 's', 'w']) {
			for (const release of RELEASES) {
				await page.getByRole('complementary', { name: 'Settings' }).getByRole('button', { name: 'Reset' }).click();
				const sel = `[data-handle="${handle}"]`;
				const { x, y } = await center(page, sel);
				const [dx, dy] = handle === 'e' ? [-40, 0] : handle === 's' ? [0, -40] : handle === 'w' ? [40, 0] : [30, 30];
				await checkRelease(page, 'crop', x, y, dx, dy, release);
			}
		}
	});

	test('card rectangles, words on the video and the storyboard stop too', async ({ page }) => {
		await openNewVideo(page);
		await importViaPicker(page, ['long.mp4', 'red.mp4'], 'Choose photos & videos');
		await expect(page.getByRole('button', { name: /^Scene 2, / })).toBeVisible();

		// Words on the video.
		await seekTo(page, 1);
		await page.getByRole('button', { name: /^Words Titles/ }).click();
		await page.getByRole('button', { name: /^Title/ }).click();
		await page.keyboard.type('Drag me');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Escape');
		for (const [i, release] of RELEASES.entries()) {
			const { x, y } = await center(page, '.text-box .hit');
			await checkRelease(page, 'text', x, y, i % 2 ? -40 : 40, i % 2 ? -20 : 20, release);
		}

		// Storyboard: trimming a scene's end, and scrubbing the ruler.
		await page.getByRole('button', { name: /^Scene 1, / }).click();
		for (const release of RELEASES) {
			// The upper part: the middle of the edge is where the transition button sits.
			const h = (await page.locator('.card-slot:first-child .trim-handle.end').boundingBox())!;
			await checkRelease(page, 'scenes', h.x + h.width / 2, h.y + 8, -25, 0, release);
		}
		for (const release of RELEASES) {
			const { x, y } = await center(page, '.ruler');
			await checkRelease(page, 'time', x - 200 + RELEASES.indexOf(release) * 30, y, 120, 0, release);
		}
		// Reordering scenes (drag scene 2 before scene 1).
		for (const release of ['inside', 'lost'] as const) {
			const first = (await page.locator('.card-slot').first().boundingBox())!;
			const second = (await page.locator('.card-slot').nth(1).boundingBox())!;
			await checkRelease(page, 'scenes', second.x + 20, second.y + 40, first.x - second.x - 10, 0, release);
		}

		// A card rectangle.
		await page.getByRole('button', { name: /^Cards/ }).click();
		await page.getByRole('button', { name: 'Add rectangle' }).click();
		await expect(page.locator('[data-rect-handle="w"]')).toBeVisible();
		for (const release of RELEASES) {
			const { x, y } = await center(page, '[data-rect-handle="w"]');
			await checkRelease(page, 'rect', x, y, release === 'inside' ? -30 : 30, 0, release);
		}
	});
});
