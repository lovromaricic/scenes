import { describe, expect, it } from 'vitest';
import { fitPxPerSec, MAX_PX_PER_SEC, MIN_PX_PER_SEC, ticks, tickStep } from './scale';

describe('fitPxPerSec', () => {
	it('fits the video to the available width', () => {
		expect(fitPxPerSec(930, 31)).toBe(30);
	});
	it('clamps to zoom limits', () => {
		expect(fitPxPerSec(1000, 1)).toBe(MAX_PX_PER_SEC);
		expect(fitPxPerSec(1000, 300)).toBe(MIN_PX_PER_SEC);
	});
	it('has a default for an empty project', () => {
		expect(fitPxPerSec(1000, 0)).toBeGreaterThan(0);
	});
});

describe('ticks', () => {
	it('spaces labels at least the minimum gap apart', () => {
		expect(tickStep(30)).toBe(5);
		expect(tickStep(100)).toBe(1);
		expect(tickStep(14)).toBe(5);
	});
	it('lists tick times up to the end', () => {
		expect(ticks(31, 30)).toEqual([0, 5, 10, 15, 20, 25, 30]);
	});
});

import { fitTimeline, mapTicks, MIN_ITEM_PX, ppsToZoom, timeMap, zoomToPps } from './scale';

describe('timeMap', () => {
	it('is linear when every scene is wide enough', () => {
		const m = timeMap([4, 6], 20);
		expect(m.x(0)).toBe(0);
		expect(m.x(4)).toBe(80);
		expect(m.x(7)).toBe(140);
		expect(m.t(140)).toBeCloseTo(7);
		expect(m.x(12)).toBe(240); // past the end, at pps
	});
	it('gives short scenes the minimum width and keeps later times lined up', () => {
		const m = timeMap([4, 0.5, 4], 20);
		expect(m.xs).toEqual([0, 80, 80 + MIN_ITEM_PX, 80 + MIN_ITEM_PX + 80]);
		expect(m.x(4.25)).toBeCloseTo(80 + MIN_ITEM_PX / 2);
		expect(m.t(m.x(6.3))).toBeCloseTo(6.3);
		expect(m.width(4, 0.5)).toBe(MIN_ITEM_PX);
		expect(m.width(0, 0.1)).toBe(MIN_ITEM_PX);
	});
	it('works with no scenes', () => {
		const m = timeMap([], 30);
		expect(m.x(2)).toBe(60);
		expect(m.t(60)).toBe(2);
	});
});

describe('fitTimeline', () => {
	it('fits the whole video, minimum widths included', () => {
		const durations = [10, 0.3, 0.3, 10];
		const pps = fitTimeline(durations, 1000);
		const m = timeMap(durations, pps);
		expect(m.xs.at(-1)).toBeLessThanOrEqual(1000);
		expect(m.xs.at(-1)).toBeGreaterThan(990);
	});
	it('shows long videos whole, below the old zoom limit', () => {
		const pps = fitTimeline([600], 900);
		expect(pps).toBeCloseTo(1.5, 1);
	});
});

describe('zoom', () => {
	it('maps the slider between fit and the closest zoom', () => {
		expect(zoomToPps(0, 20)).toBeCloseTo(20);
		expect(zoomToPps(1, 20)).toBeCloseTo(400);
		expect(ppsToZoom(zoomToPps(0.37, 20), 20)).toBeCloseTo(0.37);
	});
	it('ruler labels never crowd', () => {
		const m = timeMap([4, 0.2, 0.2, 0.2, 4], 20);
		const xs = mapTicks(m, 8.6).map(m.x);
		for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(64 * 0.8);
	});
});
