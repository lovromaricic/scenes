/**
 * Where the floating toolbar of a selected object goes: a fixed spot, centred at the bottom of
 * the video frame (the part in view), a small margin in. It doesn't follow the object. Only when
 * the object covers that spot does the toolbar use the same spot at the top of the frame instead.
 */

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export type ToolbarSide = 'bottom' | 'top';

/** Space between the toolbar and the frame's edge. */
export const TOOLBAR_MARGIN = 16;

/** The upright box around a w × h box centred at (cx, cy), turned by `deg` degrees. */
export function turnedBounds(cx: number, cy: number, w: number, h: number, deg = 0): Box {
	const r = (deg * Math.PI) / 180;
	const c = Math.abs(Math.cos(r));
	const s = Math.abs(Math.sin(r));
	const hw = (w * c + h * s) / 2;
	const hh = (w * s + h * c) / 2;
	return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
}

/** The toolbar's box at the bottom or the top of `frame`, centred (kept inside it). */
export function toolbarSpot(frame: Box, size: { width: number; height: number }, side: ToolbarSide, margin = TOOLBAR_MARGIN): Box {
	const left = Math.max(frame.left + margin, (frame.left + frame.right) / 2 - size.width / 2);
	const top =
		side === 'bottom'
			? Math.max(frame.top + margin, frame.bottom - margin - size.height)
			: frame.top + margin;
	return { left, top, right: left + size.width, bottom: top + size.height };
}

const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Which side the toolbar goes: the bottom, unless the object covers that spot. */
export function toolbarSide(object: Box, frame: Box, size: { width: number; height: number }, margin = TOOLBAR_MARGIN): ToolbarSide {
	return overlaps(object, toolbarSpot(frame, size, 'bottom', margin)) ? 'top' : 'bottom';
}
