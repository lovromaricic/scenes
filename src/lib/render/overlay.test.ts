import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY_STYLE, type PlacedOverlay } from '$lib/model/overlay';
import { coverUv, hexToRgb, overlayDraw, overlayRect, shadowParams } from './overlay';

const placed = (over: Partial<PlacedOverlay['overlay']> = {}): PlacedOverlay => ({
	start: 2,
	end: 7,
	overlay: {
		id: 'o',
		kind: 'video',
		mediaId: 'm',
		name: 'o',
		sceneId: null,
		offset: 2,
		duration: 5,
		sourceStart: 0,
		row: 0,
		box: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 },
		style: { ...DEFAULT_OVERLAY_STYLE },
		enter: 'none',
		exit: 'none',
		sound: { on: false, volume: 1 },
		...over
	}
});

const frame = { image: {} as ImageBitmap, width: 640, height: 360, exact: true } as never;

describe('overlay drawing', () => {
	it('fills its box without stretching (trims the long side)', () => {
		expect(coverUv([0, 0, 1, 1], 2, 1)).toEqual([0.25, 0, 0.5, 1]);
		expect(coverUv([0, 0, 1, 1], 1, 2)).toEqual([0, 0.25, 1, 0.5]);
		expect(coverUv([0, 0, 1, 1], 16 / 9, 16 / 9)).toEqual([0, 0, 1, 1]);
	});
	it('places the box in output pixels and animates it', () => {
		expect(overlayRect(placed(), 3, 1920, 1080).rect).toEqual({ x: 960, y: 540, w: 768, h: 432 });
		const popping = overlayRect(placed({ enter: 'pop' }), 2.05, 1920, 1080);
		expect(popping.rect.w).toBeLessThan(768);
		expect(popping.rect.x + popping.rect.w / 2).toBeCloseTo(960 + 384); // scales about its centre
		const sliding = overlayRect(placed({ enter: 'slide-up' }), 2.05, 1920, 1080);
		expect(sliding.rect.y).toBeGreaterThan(540);
	});
	it('scales corners, border and shadow with the output size', () => {
		const style = { radius: 1, borderColor: '#ff0000', borderWidth: 10, shadow: 'soft' as const, opacity: 0.5 };
		const full = overlayDraw(frame, placed({ style }), 3, 'natural', 1920, 1080, 1920);
		const small = overlayDraw(frame, placed({ style }), 3, 'natural', 960, 540, 1920);
		expect(full.radius).toBeCloseTo(216);
		expect(small.radius).toBeCloseTo(108);
		expect(full.borderWidth).toBe(10);
		expect(small.borderWidth).toBe(5);
		expect(full.borderColor).toEqual([1, 0, 0]);
		expect(full.opacity).toBe(0.5);
		expect(small.shadow!.blur).toBeCloseTo(full.shadow!.blur / 2);
		expect(shadowParams('off', 100, 100)).toBeNull();
		expect(hexToRgb('#336699')).toEqual([0.2, 0.4, 0.6]);
	});
	it('applies the crop before fitting', () => {
		const d = overlayDraw(
			frame,
			placed({ crop: { x: 0, y: 0, w: 320, h: 360 }, box: { x: 0, y: 0, w: 0.2, h: 0.4 } }),
			3,
			'natural',
			1920,
			1080,
			1920
		);
		// Left half of the picture (u 0–0.5); the box is 384 × 432, so it trims the sides a little.
		expect(d.uv[0]).toBeGreaterThanOrEqual(0);
		expect(d.uv[0] + d.uv[2]).toBeLessThanOrEqual(0.5 + 1e-9);
	});
});
