import { describe, expect, it } from 'vitest';
import { EASINGS } from '$lib/model/keyframes';
import { easingPath } from './easingPath';

const points = (d: string) => d.replace(/^M/, '').split(' L').map((p) => p.split(' ').map(Number));

describe('the easing line between keyframes', () => {
	it('is straight for Linear, from low to high', () => {
		const pts = points(easingPath(EASINGS.linear, 0, 100, 10, 2));
		expect(pts[0]).toEqual([0, 10]);
		expect(pts.at(-1)).toEqual([100, 2]);
		for (const [x, y] of pts) expect(y).toBeCloseTo(10 - (8 * x) / 100, 1);
	});

	it('is a step for Hold, curved for eases, and goes past the end for Overshoot', () => {
		expect(easingPath(EASINGS.hold, 0, 50, 10, 2)).toBe('M0.0 10.0 L50.0 10.0 L50.0 2.0');
		const eased = points(easingPath(EASINGS['ease-in-out'], 0, 100, 10, 2));
		const mid = eased[Math.floor(eased.length / 4)];
		expect(mid[1]).toBeGreaterThan(10 - (8 * mid[0]) / 100 + 0.3); // slower than a straight line early on
		const over = points(easingPath(EASINGS.overshoot, 0, 100, 10, 2));
		expect(Math.min(...over.map((p) => p[1]))).toBeLessThan(2); // past the next value, then back
	});
});
