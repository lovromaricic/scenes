import { describe, expect, it } from 'vitest';
import { MOOD_GRADES } from '$lib/model/moods';
import { reachesOutside, type VisualDraw } from './visuals';

const overlay = (x: number, y: number, w: number, h: number, extra: object = {}): VisualDraw => ({
	type: 'overlay',
	draw: {
		image: {} as never,
		uv: [0, 0, 1, 1],
		rect: { x, y, w, h },
		radius: 0,
		borderWidth: 0,
		borderColor: [1, 1, 1],
		shadow: null,
		rotation: 0,
		opacity: 1,
		grade: MOOD_GRADES.natural,
		...extra
	}
});

describe('what reaches outside the frame (drawn faded on the pasteboard)', () => {
	it('tells pictures inside the frame from those reaching out of it', () => {
		expect(reachesOutside(overlay(10, 10, 100, 100), 640, 360)).toBe(false);
		expect(reachesOutside(overlay(-5, 10, 100, 100), 640, 360)).toBe(true);
		expect(reachesOutside(overlay(600, 10, 100, 100), 640, 360)).toBe(true);
		expect(reachesOutside(overlay(-500, -500, 100, 100), 640, 360)).toBe(true);
		// Turned, its corners reach out; a shadow counts too; invisible ones don't.
		expect(reachesOutside(overlay(270, 0, 100, 100, { rotation: Math.PI / 4 }), 640, 360)).toBe(true);
		expect(reachesOutside(overlay(270, 4, 100, 100, { shadow: { blur: 10, offsetX: 0, offsetY: 2, alpha: 0.3 } }), 640, 360)).toBe(true);
		expect(reachesOutside(overlay(-50, 10, 100, 100, { opacity: 0 }), 640, 360)).toBe(false);
	});

	it('counts words’ scale', () => {
		const words = (scale: number): VisualDraw => ({
			type: 'text',
			draw: { key: 'k', image: {} as never, cx: 320, cy: 180, width: 200, height: 50, scale, opacity: 1 }
		});
		expect(reachesOutside(words(1), 640, 360)).toBe(false);
		expect(reachesOutside(words(4), 640, 360)).toBe(true);
	});
});
