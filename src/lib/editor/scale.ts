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

// ─── Zoom and minimum widths ──────────────────────────────────────────────────────────────

/** Every item on every track is at least this wide, so short ones stay easy to click. */
export const MIN_ITEM_PX = 48;
/** The closest zoom: one second takes this many pixels (about 13 px per frame at 30 fps). */
export const MAX_ZOOM_PX_PER_SEC = 400;

/**
 * Where times sit on the storyboard. Each scene takes `max(MIN_ITEM_PX, duration × pps)` pixels,
 * and time runs evenly inside it, so a short scene gets a little extra room while everything
 * (ruler, playhead, words, sound, layers) stays lined up with the scenes. After the last scene,
 * time runs at `pps`.
 */
export interface TimeMap {
	pps: number;
	/** Scene boundaries: times and matching pixel positions (same length, starting at 0). */
	times: number[];
	xs: number[];
	x(t: number): number;
	t(x: number): number;
	/** Pixel width of an item from `start` for `duration`, at least MIN_ITEM_PX. */
	width(start: number, duration: number): number;
}

export function timeMap(durations: number[], pps: number, minWidth = MIN_ITEM_PX): TimeMap {
	const times = [0];
	const xs = [0];
	for (const d of durations) {
		times.push(times[times.length - 1] + d);
		xs.push(xs[xs.length - 1] + Math.max(minWidth, d * pps));
	}
	const last = times.length - 1;
	const segment = (values: number[], v: number) => {
		// Index i with values[i] <= v < values[i+1] (clamped to the scene range).
		let lo = 0;
		let hi = last;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (values[mid] <= v) lo = mid;
			else hi = mid;
		}
		return lo;
	};
	const x = (t: number) => {
		if (last === 0 || t <= 0) return t * pps;
		if (t >= times[last]) return xs[last] + (t - times[last]) * pps;
		const i = segment(times, t);
		const span = times[i + 1] - times[i];
		return xs[i] + (span > 0 ? ((t - times[i]) / span) * (xs[i + 1] - xs[i]) : 0);
	};
	const t = (px: number) => {
		if (last === 0 || px <= 0) return px / pps;
		if (px >= xs[last]) return times[last] + (px - xs[last]) / pps;
		const i = segment(xs, px);
		return times[i] + ((px - xs[i]) / (xs[i + 1] - xs[i])) * (times[i + 1] - times[i]);
	};
	return {
		pps,
		times,
		xs,
		x,
		t,
		width: (start, duration) => Math.max(minWidth, x(start + duration) - x(start))
	};
}

/**
 * The zoom that shows the whole video in `available` pixels, taking the minimum widths into
 * account. (Very long videos may still need a little scrolling if their scenes are all tiny.)
 */
export function fitTimeline(durations: number[], available: number, minWidth = MIN_ITEM_PX): number {
	const total = durations.reduce((a, b) => a + b, 0);
	if (total <= 0 || available <= 0) return 40;
	const widthAt = (pps: number) => durations.reduce((w, d) => w + Math.max(minWidth, d * pps), 0);
	if (widthAt(MAX_PX_PER_SEC) <= available) return MAX_PX_PER_SEC;
	let lo = 0.5;
	let hi = MAX_PX_PER_SEC;
	if (widthAt(lo) > available) return lo;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (widthAt(mid) <= available) lo = mid;
		else hi = mid;
	}
	return lo;
}

/** Ruler ticks that fit the map: every `step` seconds, skipping labels that would crowd. */
export function mapTicks(map: TimeMap, duration: number, minGap = 64): number[] {
	const step = tickStep(map.pps, minGap);
	const out: number[] = [];
	let lastX = -Infinity;
	for (let t = 0; t <= duration + 1e-6; t += step) {
		const x = map.x(t);
		if (x - lastX < minGap * 0.8) continue;
		out.push(t);
		lastX = x;
	}
	return out;
}

/** Zoom slider position (0–1, logarithmic) ↔ pixels per second, from "fit" to the closest zoom. */
export function zoomToPps(value: number, fitPps: number): number {
	const max = Math.max(fitPps, MAX_ZOOM_PX_PER_SEC);
	return fitPps * Math.pow(max / fitPps, Math.min(1, Math.max(0, value)));
}
export function ppsToZoom(pps: number, fitPps: number): number {
	const max = Math.max(fitPps, MAX_ZOOM_PX_PER_SEC);
	if (max <= fitPps) return 0;
	return Math.min(1, Math.max(0, Math.log(pps / fitPps) / Math.log(max / fitPps)));
}
