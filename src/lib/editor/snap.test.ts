import { describe, expect, it } from 'vitest';
import { Snapper, formatTenths, toFrame } from './snap';

const px = (t: number) => t * 100; // 100 px a second

describe('snapping with hysteresis', () => {
	it('snaps within 8 px and lets go only past 12 px', () => {
		const s = new Snapper();
		expect(s.snap([1.0], [1.1], px).target).toBeNull(); // 10 px: not yet
		expect(s.snap([1.03], [1.1], px)).toMatchObject({ target: 1.1 }); // 7 px: snaps
		expect(s.snap([1.0], [1.1], px).target).toBe(1.1); // 10 px: still held
		expect(s.snap([0.985], [1.1], px).target).toBe(1.1); // 11.5 px: still held
		expect(s.snap([0.97], [1.1], px).target).toBeNull(); // 13 px: let go
	});

	it('one target at a time, the nearest; Alt turns it off', () => {
		const s = new Snapper();
		const r = s.snap([2.0, 3.0], [2.05, 2.97], px);
		expect(r.target).toBe(2.97);
		expect(r.shift).toBeCloseTo(-0.03);
		expect(s.snap([2.0, 3.0], [2.05, 2.97], px, true)).toEqual({ shift: 0, target: null });
	});

	it('rounds to whole frames, and shows tenths', () => {
		expect(toFrame(1.01, 30)).toBeCloseTo(1, 6);
		expect(toFrame(1.02, 30)).toBeCloseTo(31 / 30, 6);
		expect(formatTenths(3.44)).toBe('0:03.4');
		expect(formatTenths(75.06)).toBe('1:15.1');
	});
});
