import { describe, expect, it } from 'vitest';
import { clampFrame, DEFAULT_FRAME, frameRect, minZoom, showsBars } from './framing';

// A 16:9 clip in a 9:16 frame.
const src = [1920, 1080] as const;
const out = [1080, 1920] as const;

describe('frameRect', () => {
	it('Fill covers the frame and crops the sides', () => {
		const r = frameRect(DEFAULT_FRAME, ...src, ...out);
		expect(r.h).toBeCloseTo(1920);
		expect(r.w).toBeCloseTo(3413.33, 1);
		expect(r.x).toBeCloseTo((1080 - r.w) / 2);
		expect(showsBars(r, ...out)).toBe(false);
	});
	it('Fit shows the whole picture with bars above and below', () => {
		const r = frameRect({ ...DEFAULT_FRAME, mode: 'fit' }, ...src, ...out);
		expect(r).toMatchObject({ x: 0, w: 1080 });
		expect(r.h).toBeCloseTo(607.5);
		expect(r.y).toBeCloseTo((1920 - 607.5) / 2);
		expect(showsBars(r, ...out)).toBe(true);
	});
	it('Custom at zoom 1 and no offset equals Fill', () => {
		expect(frameRect({ ...DEFAULT_FRAME, mode: 'custom' }, ...src, ...out)).toEqual(
			frameRect(DEFAULT_FRAME, ...src, ...out)
		);
	});
	it('Custom moves and zooms the picture', () => {
		const r = frameRect(
			{ ...DEFAULT_FRAME, mode: 'custom', zoom: 2, x: 0.25, y: 0 },
			...src,
			...out
		);
		expect(r.h).toBeCloseTo(3840);
		expect(r.x + r.w / 2).toBeCloseTo(540 + 270);
	});
	it('matches when the shapes already match', () => {
		const fill = frameRect(DEFAULT_FRAME, 1920, 1080, 1280, 720);
		const fit = frameRect({ ...DEFAULT_FRAME, mode: 'fit' }, 1920, 1080, 1280, 720);
		expect(fill).toEqual(fit);
	});
	it('is the same at any output resolution (relative)', () => {
		const a = frameRect(
			{ ...DEFAULT_FRAME, mode: 'custom', zoom: 1.5, x: -0.1, y: 0.2 },
			...src,
			720,
			1280
		);
		const b = frameRect(
			{ ...DEFAULT_FRAME, mode: 'custom', zoom: 1.5, x: -0.1, y: 0.2 },
			...src,
			1080,
			1920
		);
		expect(b.x / 1080).toBeCloseTo(a.x / 720);
		expect(b.h / 1920).toBeCloseTo(a.h / 1280);
	});
});

describe('clampFrame', () => {
	it('limits zoom between Fit and 4×, and keeps the centre inside the frame', () => {
		const lo = minZoom(...src, ...out);
		expect(lo).toBeCloseTo(1080 / 3413.33, 3);
		const c = clampFrame(
			{ ...DEFAULT_FRAME, mode: 'custom', zoom: 0.01, x: 3, y: -3 },
			...src,
			...out
		);
		expect(c.zoom).toBeCloseTo(lo);
		expect(c).toMatchObject({ x: 0.5, y: -0.5 });
		expect(clampFrame({ ...DEFAULT_FRAME, zoom: 99 }, ...src, ...out).zoom).toBe(4);
	});
});
