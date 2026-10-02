import { describe, expect, it } from 'vitest';
import { formatClock, formatFrames, formatHundredths, formatLength, formatSeconds, formatShort, formatTime, pluralize } from './time';

describe('formatClock', () => {
	it('formats minutes and seconds', () => {
		expect(formatClock(0)).toBe('0:00');
		expect(formatClock(12)).toBe('0:12');
		expect(formatClock(65)).toBe('1:05');
	});
	it('rounds down so the clock never runs ahead of the frame', () => {
		expect(formatClock(12.99)).toBe('0:12');
	});
	it('handles hours and negative input', () => {
		expect(formatClock(3723)).toBe('1:02:03');
		expect(formatClock(-3)).toBe('0:00');
	});
});

describe('formatLength', () => {
	it('uses friendly words', () => {
		expect(formatLength(31)).toBe('31 sec');
		expect(formatLength(120)).toBe('2 min');
		expect(formatLength(125.4)).toBe('2 min 5 sec');
	});
});

describe('formatShort / formatSeconds', () => {
	it('shows one decimal only when needed', () => {
		expect(formatShort(12)).toBe('12s');
		expect(formatShort(4.52)).toBe('4.5s');
		expect(formatShort(75)).toBe('1:15');
	});
	it('always shows one decimal in steppers', () => {
		expect(formatSeconds(4)).toBe('4.0 sec');
		expect(formatSeconds(3.14)).toBe('3.1 sec');
	});
});

describe('pluralize', () => {
	it('picks the right form', () => {
		expect(pluralize(1, 'scene')).toBe('1 scene');
		expect(pluralize(3, 'scene')).toBe('3 scenes');
	});
});

describe('clock time with hundredths, or seconds and frames', () => {
	it('shows hundredths, rounding down', () => {
		expect(formatHundredths(0)).toBe('0:00.00');
		expect(formatHundredths(2.45)).toBe('0:02.45');
		expect(formatHundredths(2.459)).toBe('0:02.45');
		expect(formatHundredths(5)).toBe('0:05.00');
		expect(formatHundredths(0.3)).toBe('0:00.30'); // float error doesn't drop a hundredth
		expect(formatHundredths(65.07)).toBe('1:05.07');
	});

	it('includes hours from an hour on', () => {
		expect(formatHundredths(3723.45)).toBe('1:02:03.45');
		expect(formatFrames(3723.5, 30)).toBe('1:02:03:15');
	});

	it('shows seconds and frames at the frame rate', () => {
		expect(formatFrames(2 + 14 / 30, 30)).toBe('0:02:14');
		expect(formatFrames(1 / 30, 30)).toBe('0:00:01');
		expect(formatFrames(0.999, 30)).toBe('0:00:29');
		expect(formatFrames(10, 24)).toBe('0:10:00');
		expect(formatFrames(1 / 120, 120)).toBe('0:00:001');
		expect(formatTime(2.5, 'frames', 25)).toBe('0:02:12');
		expect(formatTime(2.5, 'seconds', 25)).toBe('0:02.50');
	});

	it('keeps the same width while time runs (for tabular digits)', () => {
		const widths = new Set<number>();
		for (let t = 0; t < 59; t += 0.37) widths.add(formatHundredths(t).length);
		expect(widths.size).toBe(1);
	});
});
