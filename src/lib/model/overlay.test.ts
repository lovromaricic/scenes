import { describe, expect, it } from 'vitest';
import { placeScenes } from './timeline';
import type { Scene } from './types';
import {
	DEFAULT_OVERLAY_STYLE,
	assignRow,
	compactRows,
	defaultBox,
	linkAt,
	maxOverlayDuration,
	overlayAnimation,
	overlayStart,
	placeBox,
	placeOverlays,
	relinkByTime,
	rowCount,
	tooManyVideos,
	type Overlay
} from './overlay';

const scene = (id: string, length: number): Scene => ({
	id,
	mediaId: id,
	kind: 'video',
	name: id,
	sourceStart: 0,
	sourceEnd: length,
	speed: 1,
	volume: 1,
	mood: null,
	transition: { kind: 'cut', duration: 0 }
});

const overlay = (id: string, sceneId: string | null, offset: number, duration = 2, row = 0): Overlay => ({
	id,
	kind: 'video',
	mediaId: 'm',
	name: id,
	sceneId,
	offset,
	duration,
	sourceStart: 0,
	row,
	box: { x: 0, y: 0, w: 0.4, h: 0.4 },
	style: { ...DEFAULT_OVERLAY_STYLE },
	enter: 'none',
	exit: 'none',
	sound: { on: false, volume: 1 }
});

const placed = placeScenes([scene('a', 4), scene('b', 6), scene('c', 3)]);

describe('overlay timing', () => {
	it('starts relative to its scene, so it moves with it', () => {
		const o = overlay('o', 'b', 1);
		expect(overlayStart(o, placed)).toBe(5);
		// Scene b moved to the front: the overlay follows.
		const moved = placeScenes([scene('b', 6), scene('a', 4), scene('c', 3)]);
		expect(overlayStart(o, moved)).toBe(1);
		// Scene a trimmed shorter: b and its overlay start earlier.
		const trimmed = placeScenes([scene('a', 2), scene('b', 6), scene('c', 3)]);
		expect(overlayStart(o, trimmed)).toBe(3);
	});
	it('links to the scene under its start', () => {
		expect(linkAt(4.5, placed)).toEqual({ sceneId: 'b', offset: 0.5 });
		expect(linkAt(20, placed)).toEqual({ sceneId: 'c', offset: 10 });
		expect(linkAt(2, [])).toEqual({ sceneId: null, offset: 2 });
	});
	it('keeps overlays in place when scenes change', () => {
		const o = overlay('o', 'b', 3); // at 7 s
		const after = placeScenes([scene('a', 4), scene('b1', 2), scene('b2', 4), scene('c', 3)]);
		const [relinked] = relinkByTime([o], placed, after);
		expect(relinked).toMatchObject({ sceneId: 'b2', offset: 1 });
		expect(overlayStart(relinked, after)).toBe(7);
	});
	it('a video overlay can not outlast its clip', () => {
		expect(maxOverlayDuration({ kind: 'video', sourceStart: 1 }, 5)).toBe(4);
		expect(maxOverlayDuration({ kind: 'photo', sourceStart: 0 }, 5)).toBe(Infinity);
	});
});

describe('overlay rows', () => {
	it('an overlapping overlay gets a new row just above', () => {
		const list = [overlay('x', 'a', 0, 3, 0), overlay('y', 'a', 1, 3, 0), overlay('z', 'a', 0, 1, 1)];
		const next = assignRow(list, 'y', 0, placed);
		expect(next.map((o) => [o.id, o.row])).toEqual([
			['x', 0],
			['y', 1],
			['z', 2]
		]);
	});
	it('a free row is used as is', () => {
		const list = [overlay('x', 'a', 0, 1, 0), overlay('y', 'a', 2, 1, 0)];
		expect(assignRow(list, 'y', 0, placed).map((o) => o.row)).toEqual([0, 0]);
	});
	it('empty rows disappear', () => {
		expect(compactRows([overlay('x', 'a', 0, 1, 2), overlay('y', 'a', 0, 1, 5)]).map((o) => o.row)).toEqual([0, 1]);
		expect(rowCount([])).toBe(1);
	});
	it('draws lower rows first', () => {
		const list = [overlay('top', 'a', 0, 1, 1), overlay('low', 'a', 0, 1, 0)];
		expect(placeOverlays(list, placed).map((p) => p.overlay.id)).toEqual(['low', 'top']);
	});
});

describe('overlay limits and layout', () => {
	it('allows up to four videos at once', () => {
		const four = [0, 1, 2, 3].map((i) => overlay(`v${i}`, 'a', 0, 4, i));
		const p = placeOverlays(four, placed);
		expect(tooManyVideos(p, 1, 2)).toBe(true);
		expect(tooManyVideos(p, 4, 2)).toBe(false);
		expect(tooManyVideos(placeOverlays(four.slice(0, 3), placed), 1, 2)).toBe(false);
	});
	it('makes a centred box 40% wide with the picture’s proportions', () => {
		const box = defaultBox({ width: 640, height: 360 }, { width: 1920, height: 1080 });
		expect(box.w).toBeCloseTo(0.4);
		expect(box.h).toBeCloseTo(0.4);
		expect(box.x).toBeCloseTo(0.3);
		const tall = defaultBox({ width: 360, height: 640 }, { width: 1920, height: 1080 });
		expect(tall.h).toBeLessThanOrEqual(0.9);
		expect((tall.w * 1920) / (tall.h * 1080)).toBeCloseTo(360 / 640);
	});
	it('places boxes in corners with a margin', () => {
		const box = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
		const frame = { width: 1920, height: 1080 };
		const br = placeBox(box, 'bottom-right', frame);
		expect(br.x + br.w).toBeCloseTo(1 - (0.04 * 1080) / 1920);
		expect(br.y + br.h).toBeCloseTo(0.96);
		expect(placeBox(box, 'center', frame)).toEqual(box);
	});
	it('animates in and out', () => {
		const o = { enter: 'fade' as const, exit: 'slide-up' as const, duration: 4 };
		expect(overlayAnimation(o, 0).alpha).toBe(0);
		expect(overlayAnimation(o, 2)).toEqual({ alpha: 1, dy: 0, scale: 1 });
		const leaving = overlayAnimation(o, 3.9);
		expect(leaving.alpha).toBeLessThan(1);
		expect(leaving.dy).toBeLessThan(0); // moving up as it leaves
		expect(overlayAnimation({ enter: 'pop', exit: 'none', duration: 4 }, 0.1).scale).toBeLessThan(1);
	});
});
