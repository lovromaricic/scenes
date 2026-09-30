/**
 * Storyboard geometry: how many pixels one second takes, and where the ruler ticks go.
 * Kept free of the DOM so it can be unit tested.
 */

export const MIN_PX_PER_SEC = 14;
export const MAX_PX_PER_SEC = 160;

/** Fit the whole video into `available` pixels, within sensible zoom limits. */
export function fitPxPerSec(available: number, duration: number): number {
	if (duration <= 0 || available <= 0) return 40;
	return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, available / duration));
}

const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Seconds between labelled ruler ticks so labels sit at least `minGap` pixels apart. */
export function tickStep(pxPerSec: number, minGap = 64): number {
	return TICK_STEPS.find((s) => s * pxPerSec >= minGap) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

export function ticks(duration: number, pxPerSec: number, minGap = 64): number[] {
	const step = tickStep(pxPerSec, minGap);
	const out: number[] = [];
	for (let t = 0; t <= duration + 1e-6; t += step) out.push(t);
	return out;
}
