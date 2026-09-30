import { describe, expect, it } from 'vitest';
import { coverScale } from './gl';

describe('coverScale', () => {
	it('crops the sides of a wide image in a tall frame', () => {
		const [x, y] = coverScale(16 / 9, 9 / 16);
		expect(y).toBe(1);
		expect(x).toBeCloseTo(256 / 81);
	});
	it('crops top and bottom of a tall image in a wide frame', () => {
		const [x, y] = coverScale(9 / 16, 16 / 9);
		expect(x).toBe(1);
		expect(y).toBeCloseTo(256 / 81);
	});
	it('is 1:1 when the aspects match', () => {
		expect(coverScale(1, 1)).toEqual([1, 1]);
	});
});
