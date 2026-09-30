import { describe, expect, it } from 'vitest';
import {
	DEFAULT_OVERLAY_STYLE,
	defaultBox,
	fitShape,
	maxOverlayDuration,
	overlayAnimation,
	placeBox,
	placeOverlays,
	tooManyVideos,
	type Overlay
} from './overlay';



const overlay = (id: string, trackId: string, start: number, duration = 2): Overlay => ({
	id,
	kind: 'video',
	mediaId: 'm',
	name: id,
	trackId,
	start,
	duration,
	sourceStart: 0,
	box: { x: 0, y: 0, w: 0.4, h: 0.4 },
	style: { ...DEFAULT_OVERLAY_STYLE },
	enter: 'none',
	exit: 'none',
	sound: { on: false, volume: 1 }
});


describe('overlay timing and order', () => {
	it('a video overlay can not outlast its clip', () => {
		expect(maxOverlayDuration({ kind: 'video', sourceStart: 1 }, 5)).toBe(4);
		expect(maxOverlayDuration({ kind: 'photo', sourceStart: 0 }, 5)).toBe(Infinity);
	});
	it('draws lower tracks first (tracks listed top to bottom), then by start', () => {
		const list = [overlay('top', 'A', 0, 1), overlay('low', 'B', 0, 1), overlay('low2', 'B', 0.5, 1)];
		expect(placeOverlays(list, ['A', 'B', 'main']).map((p) => p.overlay.id)).toEqual(['low', 'low2', 'top']);
	});
});

describe('overlay limits and layout', () => {
	it('allows up to four videos at once', () => {
		const four = [0, 1, 2, 3].map((i) => overlay(`v${i}`, `t${i}`, 0, 4));
		const p = placeOverlays(four);
		expect(tooManyVideos(p, 1, 2)).toBe(true);
		expect(tooManyVideos(p, 4, 2)).toBe(false);
		expect(tooManyVideos(placeOverlays(four.slice(0, 3)), 1, 2)).toBe(false);
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
	it('takes a picture’s shape, keeping its centre (narrower if it would be too tall)', () => {
		const frame = { width: 1280, height: 720 };
		const wide = fitShape({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, { width: 640, height: 360 }, frame);
		expect(wide.w).toBeCloseTo(0.4);
		expect((wide.w * 1280) / (wide.h * 720)).toBeCloseTo(16 / 9);
		expect(wide.y + wide.h / 2).toBeCloseTo(0.5);
		const tall = fitShape({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, { width: 213, height: 360 }, frame);
		expect(tall.h).toBeCloseTo(0.9);
		expect((tall.w * 1280) / (tall.h * 720)).toBeCloseTo(213 / 360);
		expect(tall.x + tall.w / 2).toBeCloseTo(0.5);
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
