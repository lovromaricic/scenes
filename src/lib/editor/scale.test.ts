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
