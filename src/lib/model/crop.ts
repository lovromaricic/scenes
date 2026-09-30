/**
 * Cropping a scene's source clip. A crop is a rectangle in the source's own (display) pixels;
 * it's applied before framing. Pure maths, shared by the crop tool and the renderers.
 */

export interface Crop {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Size {
	width: number;
	height: number;
}

export const MIN_CROP = 64;

/** Which part of the crop box is being dragged. */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

export function fullCrop(src: Size): Crop {
	return { x: 0, y: 0, w: src.width, h: src.height };
}

/** Whether a crop keeps the whole clip (so it can be stored as "no crop"). */
export function isFull(crop: Crop | undefined, src: Size): boolean {
	if (!crop) return true;
	return crop.x <= 0.5 && crop.y <= 0.5 && crop.w >= src.width - 1 && crop.h >= src.height - 1;
}

/** The size the rest of the pipeline sees: the crop, or the whole clip. */
export function croppedSize(crop: Crop | undefined, src: Size): Size {
	return crop ? { width: crop.w, height: crop.h } : src;
}

const round = (c: Crop): Crop => ({
	x: Math.round(c.x),
	y: Math.round(c.y),
	w: Math.round(c.w),
	h: Math.round(c.h)
});

/** Keep a crop inside the clip and at least MIN_CROP in each direction (whole pixels). */
export function clampCrop(crop: Crop, src: Size, min = MIN_CROP): Crop {
	const minW = Math.min(min, src.width);
	const minH = Math.min(min, src.height);
	const w = Math.min(src.width, Math.max(minW, crop.w));
	const h = Math.min(src.height, Math.max(minH, crop.h));
	const x = Math.min(src.width - w, Math.max(0, crop.x));
	const y = Math.min(src.height - h, Math.max(0, crop.y));
	return round({ x, y, w, h });
}

export interface Sides {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/** How much is cut from each side. */
export function sidesOf(crop: Crop, src: Size): Sides {
	return {
		left: crop.x,
		top: crop.y,
		right: src.width - (crop.x + crop.w),
		bottom: src.height - (crop.y + crop.h)
	};
}

/** Set how much is cut from one side, keeping the opposite side where it is. */
export function setSide(crop: Crop, side: keyof Sides, value: number, src: Size): Crop {
	const s = sidesOf(crop, src);
	const v = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
	if (side === 'left') {
		const right = crop.x + crop.w;
		const x = Math.min(v, right - Math.min(MIN_CROP, src.width));
		return clampCrop({ ...crop, x, w: right - x }, src);
	}
	if (side === 'top') {
		const bottom = crop.y + crop.h;
		const y = Math.min(v, bottom - Math.min(MIN_CROP, src.height));
		return clampCrop({ ...crop, y, h: bottom - y }, src);
	}
	if (side === 'right') {
		const w = Math.max(Math.min(MIN_CROP, src.width), src.width - v - s.left);
		return clampCrop({ ...crop, w }, src);
	}
	const h = Math.max(Math.min(MIN_CROP, src.height), src.height - v - s.top);
	return clampCrop({ ...crop, h }, src);
}

/** Snap a value to the nearest target within `threshold`. */
function snap(v: number, targets: number[], threshold: number): number {
	let best = v;
	let dist = threshold;
	for (const t of targets) {
		const d = Math.abs(v - t);
		if (d <= dist) {
			best = t;
			dist = d;
		}
	}
	return best;
}

export interface DragOptions {
	/** Keep the box's shape (Shift on a corner, or a locked ratio). */
	keepRatio?: number | null;
	/** Snap to the area's edges and centre lines within this many pixels (0 = off). */
	snapDistance?: number;
	/** Keep the box inside the area (true for crops; card rectangles may overhang the frame). */
	bounded?: boolean;
	/** Smallest width and height. */
	min?: number;
}

/**
 * The box after dragging `handle` by (dx, dy) pixels from `start`, inside an area of `area` size.
 * Edges move one side, corners two, and "move" slides the whole box. Used for crops and for the
 * rectangle on cards.
 */
export function dragBox(
	start: Crop,
	handle: CropHandle,
	dx: number,
	dy: number,
	area: Size,
	options: DragOptions = {}
): Crop {
	const bounded = options.bounded ?? true;
	const min = options.min ?? MIN_CROP;
	const minW = bounded ? Math.min(min, area.width) : min;
	const minH = bounded ? Math.min(min, area.height) : min;
	const snapX = [0, area.width / 2, area.width];
	const snapY = [0, area.height / 2, area.height];
	const t = options.snapDistance ?? 0;
	const lo = bounded ? 0 : -Infinity;
	const hiX = bounded ? area.width : Infinity;
	const hiY = bounded ? area.height : Infinity;
	const finish = (c: Crop) =>
		bounded
			? clampCrop(c, area, min)
			: round({ ...c, w: Math.max(minW, c.w), h: Math.max(minH, c.h) });

	if (handle === 'move') {
		let x = start.x + dx;
		let y = start.y + dy;
		if (bounded) {
			x = Math.min(area.width - start.w, Math.max(0, x));
			y = Math.min(area.height - start.h, Math.max(0, y));
		}
		if (t > 0) {
			x = snapSpan(x, start.w, snapX, t);
			y = snapSpan(y, start.h, snapY, t);
		}
		return finish({ ...start, x, y });
	}

	let left = start.x;
	let right = start.x + start.w;
	let top = start.y;
	let bottom = start.y + start.h;
	if (handle.includes('w'))
		left = Math.min(right - minW, Math.max(lo, snapIf(left + dx, snapX, t)));
	if (handle.includes('e'))
		right = Math.max(left + minW, Math.min(hiX, snapIf(right + dx, snapX, t)));
	if (handle.includes('n')) top = Math.min(bottom - minH, Math.max(lo, snapIf(top + dy, snapY, t)));
	if (handle.includes('s'))
		bottom = Math.max(top + minH, Math.min(hiY, snapIf(bottom + dy, snapY, t)));

	const ratio = options.keepRatio;
	if (ratio && handle.length === 2) {
		// Corner with a fixed shape: follow the larger movement, anchored at the opposite corner.
		let w = right - left;
		let h = bottom - top;
		if (Math.abs(w - start.w) / start.w >= Math.abs(h - start.h) / start.h) h = w / ratio;
		else w = h * ratio;
		const anchorX = handle.includes('w') ? start.x + start.w : start.x;
		const anchorY = handle.includes('n') ? start.y + start.h : start.y;
		if (bounded) {
			const maxW = handle.includes('w') ? anchorX : area.width - anchorX;
			const maxH = handle.includes('n') ? anchorY : area.height - anchorY;
			const scale = Math.min(1, maxW / w, maxH / h);
			w *= scale;
			h *= scale;
		}
		// Keep the shape at the minimum size too.
		const grow = Math.max(1, minW / w, minH / h);
		w *= grow;
		h *= grow;
		left = handle.includes('w') ? anchorX - w : anchorX;
		top = handle.includes('n') ? anchorY - h : anchorY;
		right = left + w;
		bottom = top + h;
	}
	return finish({ x: left, y: top, w: right - left, h: bottom - top });
}

/** Drag the crop box (kept inside the clip, at least MIN_CROP). */
export function dragCrop(
	start: Crop,
	handle: CropHandle,
	dx: number,
	dy: number,
	src: Size,
	options: DragOptions = {}
): Crop {
	return dragBox(start, handle, dx, dy, src, { ...options, bounded: true, min: MIN_CROP });
}

/**
 * Snap a span (a box's position along one axis) so its start, end or centre lands on a target,
 * whichever needs the smallest move within `threshold`. Compares distances rather than results,
 * so floating-point noise can't make an unsnapped edge look "snapped".
 */
function snapSpan(pos: number, size: number, targets: number[], threshold: number): number {
	let best = 0;
	let bestDist = threshold + 1e-9;
	for (const anchor of [0, size, size / 2]) {
		for (const t of targets) {
			const d = t - (pos + anchor);
			if (Math.abs(d) < bestDist) {
				best = d;
				bestDist = Math.abs(d);
			}
		}
	}
	return pos + best;
}

function snapIf(v: number, targets: number[], t: number): number {
	return t > 0 ? snap(v, targets, t) : v;
}

/** The largest box of `ratio` (width ÷ height) that fits in the clip, centred on `around`. */
export function cropToRatio(around: Crop, ratio: number, src: Size): Crop {
	let w = src.width;
	let h = w / ratio;
	if (h > src.height) {
		h = src.height;
		w = h * ratio;
	}
	const cx = around.x + around.w / 2;
	const cy = around.y + around.h / 2;
	return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h }, src);
}

/** Texture coordinates of a crop (u, v from the bottom-left, width, height), for the shader. */
export function cropUv(crop: Crop | undefined, src: Size): [number, number, number, number] {
	if (!crop) return [0, 0, 1, 1];
	return [
		crop.x / src.width,
		1 - (crop.y + crop.h) / src.height,
		crop.w / src.width,
		crop.h / src.height
	];
}

/** Shapes the crop box can be locked to. */
export type CropRatio = 'free' | 'original' | 'project' | '16:9' | '9:16' | '1:1' | '4:5';

export const CROP_RATIOS: { id: CropRatio; label: string }[] = [
	{ id: 'free', label: 'Free' },
	{ id: 'original', label: 'Original' },
	{ id: 'project', label: 'Match project' },
	{ id: '16:9', label: '16:9' },
	{ id: '9:16', label: '9:16' },
	{ id: '1:1', label: '1:1' },
	{ id: '4:5', label: '4:5' }
];

/** Width ÷ height for a ratio choice, or null for Free. */
export function cropRatioValue(ratio: CropRatio, src: Size, project: Size): number | null {
	if (ratio === 'free') return null;
	if (ratio === 'original') return src.width / src.height;
	if (ratio === 'project') return project.width / project.height;
	const [w, h] = ratio.split(':').map(Number);
	return w / h;
}
