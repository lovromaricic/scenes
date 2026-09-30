import { describe, expect, it } from 'vitest';
import { dragBox, dragCrop } from './crop';
import { defaultRect, normalizeHex, radiusPixels, rectFromPixels, rectToPixels } from './card';

const frame = { width: 1920, height: 1080 };

describe('card rectangle', () => {
	it('converts between fractions and project pixels', () => {
		const r = defaultRect('#141417');
		expect(rectToPixels(r, frame)).toEqual({ x: 384, y: 378, w: 1152, h: 324 });
		expect(
			rectToPixels(rectFromPixels(r, { x: 360, y: 340, w: 1200, h: 400 }, frame), frame)
		).toEqual({
			x: 360,
			y: 340,
			w: 1200,
			h: 400
		});
	});
	it('keeps its relative place when the format changes', () => {
		const r = rectFromPixels(defaultRect('#fff'), { x: 360, y: 340, w: 1200, h: 400 }, frame);
		expect(rectToPixels(r, { width: 1080, height: 1920 })).toEqual({
			x: 203,
			y: 604,
			w: 675,
			h: 711
		});
	});
	it('rounds corners up to half the shorter side', () => {
		expect(radiusPixels(1, 400, 200)).toBe(100);
		expect(radiusPixels(0.5, 400, 200)).toBe(50);
		expect(radiusPixels(0, 400, 200)).toBe(0);
	});
	it('reads colours', () => {
		expect(normalizeHex('ABC')).toBe('#aabbcc');
		expect(normalizeHex('#336699')).toBe('#336699');
		expect(normalizeHex('blue')).toBeNull();
	});
});

describe('dragBox for card rectangles', () => {
	const box = { x: 100, y: 100, w: 400, h: 200 };
	it('may go past the frame edges', () => {
		expect(dragBox(box, 'move', -300, -300, frame, { bounded: false, min: 8 })).toEqual({
			x: -200,
			y: -200,
			w: 400,
			h: 200
		});
		expect(dragBox(box, 'w', -500, 0, frame, { bounded: false, min: 8 })).toMatchObject({
			x: -400,
			w: 900
		});
	});
	it('has an 8 × 8 minimum', () => {
		expect(dragBox(box, 'se', -1000, -1000, frame, { bounded: false, min: 8 })).toMatchObject({
			w: 8,
			h: 8
		});
	});
	it('snaps the centre to the frame’s centre when moving', () => {
		const r = dragBox(box, 'move', 655, 336, frame, { bounded: false, min: 8, snapDistance: 10 });
		expect(r.x + r.w / 2).toBe(960);
	});
	it('snaps the centre even when the move has floating-point leftovers', () => {
		const start = { x: 384, y: 378, w: 1152, h: 324 };
		expect(
			dragBox(start, 'move', 6.9397590361445785, 4.626506024096385, frame, {
				bounded: false,
				min: 8,
				snapDistance: 18.5
			})
		).toEqual(start);
	});
	it('keeps proportions on a corner', () => {
		const r = dragBox(box, 'se', 200, 0, frame, { bounded: false, min: 8, keepRatio: 2 });
		expect(r).toEqual({ x: 100, y: 100, w: 600, h: 300 });
	});
	it('crops still stay inside the clip', () => {
		expect(dragCrop(box, 'move', -300, -300, frame)).toMatchObject({ x: 0, y: 0 });
	});
});
