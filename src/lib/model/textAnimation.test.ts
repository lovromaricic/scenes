import { describe, expect, it } from 'vitest';
import { isTextVisible, textFrameState } from './textAnimation';
import type { TextItem } from './types';

const text = (animation: TextItem['animation']): TextItem => ({
	id: 't',
	trackId: 'o1',
	text: 'Hi',
	start: 2,
	duration: 3,
	x: 0.5,
	y: 0.5,
	style: 'clean',
	animation
});

describe('isTextVisible', () => {
	it('is visible from start (inclusive) to end (exclusive)', () => {
		expect(isTextVisible(text('none'), 1.99)).toBe(false);
		expect(isTextVisible(text('none'), 2)).toBe(true);
		expect(isTextVisible(text('none'), 4.99)).toBe(true);
		expect(isTextVisible(text('none'), 5)).toBe(false);
	});
});

describe('textFrameState', () => {
	it('shows "none" fully the whole time', () => {
		expect(textFrameState(text('none'), 2)).toMatchObject({ opacity: 1, scale: 1, dy: 0 });
		expect(textFrameState(text('none'), 4.99)).toMatchObject({ opacity: 1 });
	});
	it('fades in, holds, then fades out', () => {
		expect(textFrameState(text('fade'), 2).opacity).toBe(0);
		expect(textFrameState(text('fade'), 2.25).opacity).toBeGreaterThan(0.5);
		expect(textFrameState(text('fade'), 3.5).opacity).toBe(1);
		expect(textFrameState(text('fade'), 4.9).opacity).toBeLessThan(0.5);
	});
	it('slides up into place', () => {
		const early = textFrameState(text('slide-up'), 2.05);
		expect(early.dy).toBeGreaterThan(0);
		expect(textFrameState(text('slide-up'), 3).dy).toBe(0);
	});
	it('pops from small, overshoots, and settles at full size', () => {
		expect(textFrameState(text('pop'), 2).scale).toBeCloseTo(0.6);
		const scales = [2.1, 2.2, 2.3, 2.4].map((t) => textFrameState(text('pop'), t).scale);
		expect(Math.max(...scales)).toBeGreaterThan(1);
		expect(textFrameState(text('pop'), 3).scale).toBeCloseTo(1);
	});
	it('is hidden outside its time', () => {
		expect(textFrameState(text('fade'), 6)).toMatchObject({ visible: false, opacity: 0 });
	});
	it('shortens the animation for very short text', () => {
		const short = { ...text('fade'), duration: 0.4 };
		expect(textFrameState(short, 2.2).opacity).toBe(1);
	});
});
