import { describe, expect, it } from 'vitest';
import { offscreenCenter, snapOutside, turnedHalf } from './offscreen';
import { dragBox } from './crop';

describe('placing objects outside the frame', () => {
	it('works out the on-screen box of a turned box', () => {
		expect(turnedHalf(40, 20)).toEqual({ hw: 20, hh: 10 });
		const q = turnedHalf(40, 20, 90);
		expect(q.hw).toBeCloseTo(10);
		expect(q.hh).toBeCloseTo(20);
		const d = turnedHalf(10, 10, 45);
		expect(d.hw).toBeCloseTo(Math.SQRT2 * 5);
	});

	it('puts the centre just outside each edge, keeping the other coordinate', () => {
		expect(offscreenCenter('left', 0.1, 0.2)).toEqual({ x: -0.1 });
		expect(offscreenCenter('right', 0.1, 0.2)).toEqual({ x: 1.1 });
		expect(offscreenCenter('top', 0.1, 0.2)).toEqual({ y: -0.2 });
		expect(offscreenCenter('bottom', 0.1, 0.2)).toEqual({ y: 1.2 });
	});

	it('snaps a box just outside the edges, only when close', () => {
		// 100 wide in a 1000 frame: right edge on the frame's left edge at centre -50.
		expect(snapOutside(-46, 50, 1000, 8)).toBe(-50);
		expect(snapOutside(1055, 50, 1000, 8)).toBe(1050);
		expect(snapOutside(-30, 50, 1000, 8)).toBeNull();
		expect(snapOutside(500, 50, 1000, 8)).toBeNull();
	});

	it('lets layers be dragged anywhere, snapping their far edge onto the frame’s edge', () => {
		const area = { width: 1000, height: 500 };
		const start = { x: 450, y: 200, w: 100, h: 100 };
		// Far outside, in any direction: nothing holds it in.
		expect(dragBox(start, 'move', -2000, 1500, area, { bounded: false, snapDistance: 8 })).toMatchObject({ x: -1550, y: 1700 });
		// Right edge 5 px right of the left edge: onto it (completely outside).
		expect(dragBox(start, 'move', -545, 0, area, { bounded: false, snapDistance: 8 }).x).toBe(-100);
		// Top edge just below the bottom edge: onto it.
		expect(dragBox(start, 'move', 0, 306, area, { bounded: false, snapDistance: 8 }).y).toBe(500);
	});
});
