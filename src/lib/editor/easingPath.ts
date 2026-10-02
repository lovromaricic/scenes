import { ease, type Easing } from '$lib/model/keyframes';

/**
 * The faint line drawn between two keyframes on a selected item's strip: the easing from the
 * first to the second, rising from `low` (at x1) to `high` (at x2). So Linear is straight, the
 * eases gently curved, Hold a step at the end, Overshoot and Bounce wavy.
 */
export function easingPath(e: Easing, x1: number, x2: number, low: number, high: number, samples = 24): string {
	const pts: string[] = [];
	if (e.kind === 'hold') {
		// Flat, then straight up at the next keyframe.
		return `M${x1.toFixed(1)} ${low.toFixed(1)} L${x2.toFixed(1)} ${low.toFixed(1)} L${x2.toFixed(1)} ${high.toFixed(1)}`;
	}
	const n = Math.max(2, Math.min(samples, Math.ceil(Math.abs(x2 - x1) / 2)));
	for (let i = 0; i <= n; i++) {
		const p = i / n;
		const x = x1 + (x2 - x1) * p;
		const y = low + (high - low) * ease(e, p);
		pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
	}
	return `M${pts.join(' L')}`;
}
