import { describe, expect, it } from 'vitest';
import { toolbarSide, toolbarSpot, turnedBounds } from './toolbarPlacement';

const frame = { left: 0, top: 0, right: 640, bottom: 360 };
const size = { width: 300, height: 40 };

describe('the floating toolbar’s fixed spot', () => {
	it('is centred at the bottom of the frame, 16 px in (or at the top)', () => {
		expect(toolbarSpot(frame, size, 'bottom')).toEqual({ left: 170, top: 304, right: 470, bottom: 344 });
		expect(toolbarSpot(frame, size, 'top')).toEqual({ left: 170, top: 16, right: 470, bottom: 56 });
		// In view only (zoomed): the part of the frame shown.
		expect(toolbarSpot({ left: 100, top: 50, right: 500, bottom: 300 }, size, 'bottom')).toMatchObject({ left: 150, top: 244 });
	});

	it('goes to the top only when the object covers the bottom spot', () => {
		expect(toolbarSide({ left: 270, top: 100, right: 370, bottom: 150 }, frame, size)).toBe('bottom');
		// A caption at the bottom.
		expect(toolbarSide({ left: 200, top: 290, right: 440, bottom: 330 }, frame, size)).toBe('top');
		// Large, turned, or far outside: by its on-screen box.
		expect(toolbarSide(turnedBounds(320, 180, 600, 40, 90), frame, size)).toBe('top');
		expect(toolbarSide({ left: -900, top: 0, right: -100, bottom: 360 }, frame, size)).toBe('bottom');
	});

	it('uses the turned box', () => {
		const b = turnedBounds(100, 100, 200, 20, 90);
		expect(b.left).toBeCloseTo(90);
		expect(b.right).toBeCloseTo(110);
		expect(b.top).toBeCloseTo(0);
		expect(b.bottom).toBeCloseTo(200);
	});
});
