/**
 * Snapping while dragging, steady: it snaps within ENTER pixels of a target and only lets go once
 * the pointer is RELEASE pixels away from it (a little further), so it doesn't flicker on and off
 * at the edge. One target at a time.
 */

export const SNAP_ENTER_PX = 8;
export const SNAP_RELEASE_PX = 12;

export class Snapper {
	/** The target snapped to (a time), or null. */
	target: number | null = null;

	constructor(
		private readonly enter = SNAP_ENTER_PX,
		private readonly release = SNAP_RELEASE_PX
	) {}

	/**
	 * Given the times that may snap (e.g. an item's start and end) and the targets, how far to
	 * shift them, and the target snapped to. `px` turns a time into pixels; `free` (Alt held) turns
	 * snapping off.
	 */
	snap(candidates: number[], targets: number[], px: (t: number) => number, free = false): { shift: number; target: number | null } {
		if (free || !candidates.length) {
			this.target = null;
			return { shift: 0, target: null };
		}
		// Held: stay on it until the closest candidate is clearly away.
		if (this.target !== null) {
			const t = this.target;
			const best = nearest(candidates, (c) => Math.abs(px(c) - px(t)));
			if (best.distance < this.release && targets.some((x) => Math.abs(x - t) < 1e-9)) {
				return { shift: t - best.value, target: t };
			}
			this.target = null;
		}
		let found: { shift: number; target: number; distance: number } | null = null;
		for (const c of candidates) {
			for (const t of targets) {
				const d = Math.abs(px(c) - px(t));
				if (d < this.enter && (!found || d < found.distance)) found = { shift: t - c, target: t, distance: d };
			}
		}
		if (!found) return { shift: 0, target: null };
		this.target = found.target;
		return { shift: found.shift, target: found.target };
	}

	reset(): void {
		this.target = null;
	}
}

function nearest(values: number[], distance: (v: number) => number): { value: number; distance: number } {
	let best = { value: values[0], distance: distance(values[0]) };
	for (const v of values.slice(1)) {
		const d = distance(v);
		if (d < best.distance) best = { value: v, distance: d };
	}
	return best;
}

/** A time rounded to whole frames of `fps`. */
export const toFrame = (t: number, fps: number) => Math.round(t * fps) / fps;
