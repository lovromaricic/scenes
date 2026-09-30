import { describe, expect, it } from 'vitest';
import { quantize, sampleTimes } from './filmstrip';

describe('sampleTimes', () => {
	it('samples the middle of each tile across the visible range', () => {
		expect(sampleTimes(0, 10, 5)).toEqual([1, 3, 5, 7, 9]);
	});
	it('follows trimming', () => {
		expect(sampleTimes(2, 4, 2)).toEqual([2.5, 3.5]);
	});
	it('always gives at least one frame', () => {
		expect(sampleTimes(0, 6, 0)).toEqual([3]);
	});
});

describe('quantize', () => {
	it('rounds to a tenth of a second', () => {
		expect(quantize(1.234)).toBe(1.2);
		expect(quantize(1.26)).toBe(1.3);
	});
});
