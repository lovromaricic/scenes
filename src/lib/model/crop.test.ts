import { describe, expect, it } from 'vitest';
import {
	clampCrop,
	cropToRatio,
	cropUv,
	dragCrop,
	fullCrop,
	isFull,
	MIN_CROP,
	setSide,
	sidesOf
} from './crop';
import { splitAt } from './edits';
import { dragBox } from './crop';
import type { Scene } from './types';

const src = { width: 1280, height: 800 };
const full = fullCrop(src);

describe('dragCrop', () => {
	it('moves only one side with an edge handle', () => {
		expect(dragCrop(full, 'n', 0, 80, src)).toEqual({ x: 0, y: 80, w: 1280, h: 720 });
		expect(dragCrop(full, 'e', -100, 30, src)).toEqual({ x: 0, y: 0, w: 1180, h: 800 });
	});
	it('moves two sides with a corner', () => {
		expect(dragCrop(full, 'sw', 40, -50, src)).toEqual({ x: 40, y: 0, w: 1240, h: 750 });
	});
	it('moves the whole box without resizing, and keeps it inside the clip', () => {
		const box = { x: 100, y: 100, w: 400, h: 300 };
		expect(dragCrop(box, 'move', 50, -20, src)).toEqual({ x: 150, y: 80, w: 400, h: 300 });
		expect(dragCrop(box, 'move', 5000, 5000, src)).toEqual({ x: 880, y: 500, w: 400, h: 300 });
	});
	it('never goes outside the clip or below the minimum size', () => {
		expect(dragCrop(full, 'n', 0, -50, src).y).toBe(0);
		const tiny = dragCrop(full, 'se', -5000, -5000, src);
		expect(tiny).toMatchObject({ w: MIN_CROP, h: MIN_CROP });
	});
	it('snaps to the edges and centre lines when close', () => {
		expect(dragCrop(full, 'w', 634, 0, src, { snapDistance: 10 }).x).toBe(640);
		expect(dragCrop(full, 'w', 620, 0, src, { snapDistance: 10 }).x).toBe(620);
		const box = { x: 100, y: 100, w: 400, h: 300 };
		expect(dragCrop(box, 'move', -95, 0, src, { snapDistance: 10 }).x).toBe(0);
	});
	it('keeps the shape on a corner when asked', () => {
		const box = { x: 0, y: 0, w: 1280, h: 720 };
		const r = dragCrop(box, 'se', -320, -10, src, { keepRatio: 16 / 9 });
		expect(r.w).toBe(960);
		expect(r.w / r.h).toBeCloseTo(16 / 9, 2);
		expect(r).toMatchObject({ x: 0, y: 0 });
	});
});

describe('sides', () => {
	it('reads and writes how much is cut from each side', () => {
		let c = setSide(full, 'left', 100, src);
		c = setSide(c, 'right', 80, src);
		c = setSide(c, 'top', 80, src);
		c = setSide(c, 'bottom', 40, src);
		expect(c).toEqual({ x: 100, y: 80, w: 1100, h: 680 });
		expect(sidesOf(c, src)).toEqual({ left: 100, right: 80, top: 80, bottom: 40 });
	});
	it('won’t cut past the minimum size', () => {
		expect(setSide(full, 'left', 5000, src).w).toBe(MIN_CROP);
	});
});

describe('cropToRatio', () => {
	it('uses the largest box of that shape, centred on the current box', () => {
		expect(cropToRatio(full, 1, src)).toEqual({ x: 240, y: 0, w: 800, h: 800 });
		expect(cropToRatio(full, 16 / 9, src)).toEqual({ x: 0, y: 40, w: 1280, h: 720 });
		// Centred on a box near the left edge, but kept inside the clip.
		expect(cropToRatio({ x: 0, y: 0, w: 200, h: 200 }, 1, src)).toEqual({
			x: 0,
			y: 0,
			w: 800,
			h: 800
		});
	});
});

describe('helpers', () => {
	it('knows a full crop', () => {
		expect(isFull(undefined, src)).toBe(true);
		expect(isFull(full, src)).toBe(true);
		expect(isFull({ ...full, y: 10, h: 790 }, src)).toBe(false);
	});
	it('clamps and rounds', () => {
		expect(clampCrop({ x: -5, y: 10.4, w: 99999, h: 20 }, src)).toEqual({
			x: 0,
			y: 10,
			w: 1280,
			h: 64
		});
	});
	it('gives texture coordinates from the bottom-left', () => {
		expect(cropUv({ x: 0, y: 80, w: 1280, h: 720 }, src)).toEqual([0, 0, 1, 0.9]);
		expect(cropUv(undefined, src)).toEqual([0, 0, 1, 1]);
	});
	it('both halves of a split keep the crop', () => {
		const scene: Scene = {
			id: 'a',
			mediaId: 'm',
			kind: 'video',
			name: 'a',
			sourceStart: 0,
			sourceEnd: 10,
			speed: 1,
			volume: 1,
			mood: null,
			transition: { kind: 'cut', duration: 0 },
			crop: { x: 0, y: 80, w: 1280, h: 720 }
		};
		const result = splitAt([scene], 4, () => 'b')!;
		expect(result.scenes.map((s) => s.crop)).toEqual([scene.crop, scene.crop]);
	});
});

describe('dragBox keeping the shape on edges', () => {
	it('an edge scales the whole box, around the opposite edge’s middle', () => {
		const start = { x: 100, y: 100, w: 400, h: 300 };
		const area = { width: 1280, height: 720 };
		const e = dragBox(start, 'e', 80, 0, area, { bounded: false, keepRatio: 4 / 3, keepRatioOnEdges: true });
		expect(e).toEqual({ x: 100, y: 70, w: 480, h: 360 });
		const n = dragBox(start, 'n', 0, -60, area, { bounded: false, keepRatio: 4 / 3, keepRatioOnEdges: true });
		expect(n).toEqual({ x: 60, y: 40, w: 480, h: 360 });
		// Without the option, edges stay free.
		expect(dragBox(start, 'e', 80, 0, area, { bounded: false, keepRatio: 4 / 3 }).h).toBe(300);
	});
});
