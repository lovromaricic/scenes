/**
 * Where the floating toolbar of a selected object goes: always fully inside the video frame (the
 * part of it in view), never on the pasteboard or over the panels around the stage.
 *
 * 1. Above the object, centred on its visible part, if it fits there.
 * 2. Otherwise below it, if that fits.
 * 3. Otherwise (a large object) pinned at the top of the frame.
 * An object entirely outside the frame gets it at the frame's edge nearest to it. Across, it's
 * centred on the visible part of the object, then kept inside the frame on both sides.
 */

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export type ToolbarPlacement = 'above' | 'below' | 'pinned' | 'edge';

export interface PlaceOptions {
	/** Gap above the object (clear of its turn handle). */
	above?: number;
	/** Gap below the object. */
	below?: number;
	/** Space kept between the toolbar and the frame's edges. */
	margin?: number;
}

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));

/** The upright box around a w × h box centred at (cx, cy), turned by `deg` degrees. */
export function turnedBounds(cx: number, cy: number, w: number, h: number, deg = 0): Box {
	const r = (deg * Math.PI) / 180;
	const c = Math.abs(Math.cos(r));
	const s = Math.abs(Math.sin(r));
	const hw = (w * c + h * s) / 2;
	const hh = (w * s + h * c) / 2;
	return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
}

/**
 * The toolbar's top-left for an object with on-screen bounds `object`, inside `frame` (both in
 * the same pixels), for a toolbar of `size`.
 */
export function placeToolbar(
	object: Box,
	frame: Box,
	size: { width: number; height: number },
	options: PlaceOptions = {}
): { left: number; top: number; placement: ToolbarPlacement } {
	const { above = 40, below = 12, margin = 8 } = options;
	const minLeft = frame.left + margin;
	const maxLeft = frame.right - margin - size.width;
	const minTop = frame.top + margin;
	const maxTop = frame.bottom - margin - size.height;
	const visible: Box = {
		left: Math.max(object.left, frame.left),
		top: Math.max(object.top, frame.top),
		right: Math.min(object.right, frame.right),
		bottom: Math.min(object.bottom, frame.bottom)
	};
	if (visible.left >= visible.right || visible.top >= visible.bottom) {
		// Entirely outside: at the nearest edge, as close to it as the frame allows.
		const cx = clamp((object.left + object.right) / 2, frame.left, frame.right);
		const cy = clamp((object.top + object.bottom) / 2, frame.top, frame.bottom);
		return { left: clamp(cx - size.width / 2, minLeft, maxLeft), top: clamp(cy - size.height / 2, minTop, maxTop), placement: 'edge' };
	}
	const left = clamp((visible.left + visible.right) / 2 - size.width / 2, minLeft, maxLeft);
	const aboveTop = object.top - above - size.height;
	if (aboveTop >= minTop && aboveTop <= maxTop) return { left, top: aboveTop, placement: 'above' };
	const belowTop = object.bottom + below;
	if (belowTop <= maxTop && belowTop >= minTop) return { left, top: belowTop, placement: 'below' };
	return { left, top: clamp(minTop, minTop, maxTop), placement: 'pinned' };
}
