import { describe, expect, it } from 'vitest';
import { applyGrade, MOOD_GRADES } from './moods';

describe('mood grades', () => {
	it('Natural leaves colours unchanged', () => {
		expect(applyGrade([0.2, 0.5, 0.8], MOOD_GRADES.natural)).toEqual([0.2, 0.5, 0.8]);
	});
	it('B & W removes colour', () => {
		const [r, g, b] = applyGrade([0.9, 0.1, 0.1], MOOD_GRADES.mono);
		expect(r).toBeCloseTo(g, 5);
		expect(g).toBeCloseTo(b, 5);
	});
	it('Golden is warmer and Cool is cooler', () => {
		const grey: [number, number, number] = [0.5, 0.5, 0.5];
		const golden = applyGrade(grey, MOOD_GRADES.golden);
		const cool = applyGrade(grey, MOOD_GRADES.cool);
		expect(golden[0]).toBeGreaterThan(golden[2]);
		expect(cool[2]).toBeGreaterThan(cool[0]);
	});
	it('Faded lifts the blacks, Punchy deepens contrast', () => {
		expect(applyGrade([0, 0, 0], MOOD_GRADES.faded)[0]).toBeGreaterThan(0.05);
		const dark = applyGrade([0.2, 0.2, 0.2], MOOD_GRADES.punchy)[0];
		expect(dark).toBeLessThan(0.2);
	});
	it('keeps values in range', () => {
		for (const g of Object.values(MOOD_GRADES)) {
			for (const v of applyGrade([1, 0, 1], g)) {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(1);
			}
		}
	});
});
