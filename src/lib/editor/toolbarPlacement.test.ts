import { describe, expect, it } from 'vitest';
import { placeToolbar, turnedBounds } from './toolbarPlacement';

const frame = { left: 0, top: 0, right: 640, bottom: 360 };
const size = { width: 300, height: 40 };
const inside = (p: { left: number; top: number }) =>
	p.left >= 8 - 1e-9 && p.top >= 8 - 1e-9 && p.left + size.width <= 632 + 1e-9 && p.top + size.height <= 352 + 1e-9;

describe('placing the floating toolbar', () => {
	it('above the object, centred, when it fits', () => {
		const p = placeToolbar({ left: 270, top: 200, right: 370, bottom: 240 }, frame, size);
		expect(p.placement).toBe('above');
		expect(p.top).toBe(200 - 40 - 40);
		expect(p.left).toBe(320 - 150);
	});

	it('below when there’s no room above; pinned at the top when neither fits', () => {
		const below = placeToolbar({ left: 270, top: 30, right: 370, bottom: 80 }, frame, size);
		expect(below).toMatchObject({ placement: 'below', top: 92 });
		const pinned = placeToolbar({ left: 20, top: 20, right: 620, bottom: 340 }, frame, size);
		expect(pinned).toMatchObject({ placement: 'pinned', top: 8 });
		// Huge (2000 px words), reaching far past the frame: still pinned inside.
		const huge = placeToolbar({ left: -2000, top: -1500, right: 2600, bottom: 1900 }, frame, size);
		expect(huge.placement).toBe('pinned');
		expect(inside(huge)).toBe(true);
	});

	it('kept inside across, centred on the visible part', () => {
		const nearRight = placeToolbar({ left: 600, top: 200, right: 700, bottom: 240 }, frame, size);
		expect(nearRight.left).toBe(632 - 300);
		expect(inside(nearRight)).toBe(true);
		const nearLeft = placeToolbar({ left: -200, top: 200, right: 40, bottom: 240 }, frame, size);
		expect(nearLeft.left).toBe(8);
	});

	it('entirely outside: at the nearest edge', () => {
		const left = placeToolbar({ left: -300, top: 150, right: -100, bottom: 200 }, frame, size);
		expect(left).toMatchObject({ placement: 'edge', left: 8 });
		expect(left.top).toBeCloseTo(175 - 20);
		const below = placeToolbar({ left: 300, top: 500, right: 400, bottom: 560 }, frame, size);
		expect(below).toMatchObject({ placement: 'edge', top: 352 - 40 });
		for (const p of [left, below]) expect(inside(p)).toBe(true);
	});

	it('uses the turned box', () => {
		const b = turnedBounds(100, 100, 200, 20, 90);
		expect(b.left).toBeCloseTo(90);
		expect(b.right).toBeCloseTo(110);
		expect(b.top).toBeCloseTo(0);
		expect(b.bottom).toBeCloseTo(200);
	});
});
