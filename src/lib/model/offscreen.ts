/**
 * Objects may sit anywhere, including completely outside the frame (to slide in from off-screen).
 * These helpers place an object just outside one of the frame's edges.
 */

export type OffscreenSide = 'left' | 'right' | 'top' | 'bottom';

export const OFFSCREEN_SIDES: OffscreenSide[] = ['left', 'right', 'top', 'bottom'];

/**
 * Half the width and height of the upright box around a w × h box turned by `deg` degrees (what
 * it covers on screen).
 */
export function turnedHalf(w: number, h: number, deg = 0): { hw: number; hh: number } {
	const r = (deg * Math.PI) / 180;
	const c = Math.abs(Math.cos(r));
	const s = Math.abs(Math.sin(r));
	return { hw: (w * c + h * s) / 2, hh: (w * s + h * c) / 2 };
}

/**
 * Where an object's centre goes so it sits just outside `side` of the frame, keeping the other
 * coordinate. `hw` and `hh` are half its on-screen width and height, as fractions of the frame's
 * width and height (include anything drawn around it, like a shadow, so nothing peeks in).
 */
export function offscreenCenter(side: OffscreenSide, hw: number, hh: number): { x: number } | { y: number } {
	switch (side) {
		case 'left':
			return { x: -hw };
		case 'right':
			return { x: 1 + hw };
		case 'top':
			return { y: -hh };
		case 'bottom':
			return { y: 1 + hh };
	}
}

/**
 * Where a box (centre `c`, half size `half`) snaps to sit just outside the frame's edges along one
 * axis (0 to `size`): its far edge on the frame's near edge. Returns the snapped centre, or null
 * when neither edge is within `threshold`.
 */
export function snapOutside(c: number, half: number, size: number, threshold: number): number | null {
	const targets = [-half, size + half];
	let best: number | null = null;
	let dist = threshold;
	for (const t of targets) {
		const d = Math.abs(c - t);
		if (d <= dist) {
			best = t;
			dist = d;
		}
	}
	return best;
}
