import { describe, expect, it } from 'vitest';
import { MOOD_GRADES } from '$lib/model/moods';
import { reachesOutside, type VisualDraw } from './visuals';
import { MAX_SPRITE_PIXELS, spriteFactor } from './text';

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

describe('text sprites for very large words', () => {
	it('draws growing words larger, within the texture limit and the pixel budget', () => {
		// Small words growing 4×: drawn 4× larger.
		expect(spriteFactor(400, 100, 4, 16384)).toBe(4);
		// 2000 px words (about 6500 × 2500 in the frame) growing 4×: as large as fits.
		const f = spriteFactor(6500, 2500, 4, 16384);
		expect(f).toBeLessThan(4);
		expect(6500 * f).toBeLessThanOrEqual(16384);
		expect(6500 * 2500 * f * f).toBeLessThanOrEqual(MAX_SPRITE_PIXELS + 1);
		expect(f).toBeGreaterThan(1); // still sharper than the frame
		// A small GPU limit: scaled down to fit rather than failing.
		const g = spriteFactor(6500, 2500, 1, 4096);
		expect(6500 * g).toBeLessThanOrEqual(4096);
	});
});
