import { describe, expect, it } from 'vitest';
import { wrapRows } from './text';

/** Every character is 10 wide. */
const measure = (s: string) => s.length * 10;
const texts = (rows: { text: string }[]) => rows.map((r) => r.text);

describe('breaking words into lines (one layout for drawing and typing)', () => {
	it('wraps between words, spaces hanging at the end of a line', () => {
		const rows = wrapRows('one two three', 75, measure);
		expect(texts(rows)).toEqual(['one two ', 'three']);
		expect(rows.map((r) => [r.start, r.end])).toEqual([
			[0, 8],
			[8, 13]
		]);
	});

	it('keeps every character in place: spaces aren’t collapsed, indices match the typed text', () => {
		const text = '  a   b\n\nc  ';
		const rows = wrapRows(text, 1000, measure);
		expect(texts(rows)).toEqual(['  a   b', '', 'c  ']);
		for (const r of rows) expect(text.slice(r.start, r.end)).toBe(r.text);
	});

	it('breaks at Enter, also with empty lines and at the very end', () => {
		const rows = wrapRows('a\n\nb\n', 1000, measure);
		expect(texts(rows)).toEqual(['a', '', 'b', '']);
		expect(rows.at(-1)).toMatchObject({ start: 5, end: 5 });
	});

	it('a word longer than a line has a line to itself', () => {
		expect(texts(wrapRows('hi extraordinarily long', 60, measure))).toEqual(['hi ', 'extraordinarily ', 'long']);
	});

	it('measures a line without the spaces hanging at its end', () => {
		// "abcd " is 50 wide with its space, 40 without: it fits 45.
		expect(texts(wrapRows('abcd ef', 45, measure))).toEqual(['abcd ', 'ef']);
		expect(texts(wrapRows('ab cd', 45, measure))).toEqual(['ab ', 'cd']);
	});
});
