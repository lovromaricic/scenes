import { describe, expect, it } from 'vitest';
import { formatClock, formatLength, formatSeconds, formatShort, pluralize } from './time';

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
