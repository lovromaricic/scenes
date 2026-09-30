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
export function clampCrop(crop: Crop, src: Size): Crop {
	const minW = Math.min(MIN_CROP, src.width);
	const minH = Math.min(MIN_CROP, src.height);
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
	/** Snap to the clip's edges and centre lines within this many source pixels (0 = off). */
	snapDistance?: number;
}

/**
 * The crop after dragging `handle` by (dx, dy) source pixels from `start`.
 * Edges move one side, corners two, and "move" slides the whole box.
 */
export function dragCrop(
	start: Crop,
	handle: CropHandle,
	dx: number,
	dy: number,
	src: Size,
	options: DragOptions = {}
): Crop {
	const minW = Math.min(MIN_CROP, src.width);
	const minH = Math.min(MIN_CROP, src.height);
	const snapX = [0, src.width / 2, src.width];
	const snapY = [0, src.height / 2, src.height];
	const t = options.snapDistance ?? 0;

	if (handle === 'move') {
		let x = Math.min(src.width - start.w, Math.max(0, start.x + dx));
		let y = Math.min(src.height - start.h, Math.max(0, start.y + dy));
		if (t > 0) {
			// Snap either edge or the centre of the box.
			const sx = snap(x, snapX, t);
			const sxr = snap(x + start.w, snapX, t) - start.w;
			const sxc = snap(x + start.w / 2, snapX, t) - start.w / 2;
			x = sx !== x ? sx : sxr !== x ? sxr : sxc;
			const sy = snap(y, snapY, t);
			const syb = snap(y + start.h, snapY, t) - start.h;
			const syc = snap(y + start.h / 2, snapY, t) - start.h / 2;
			y = sy !== y ? sy : syb !== y ? syb : syc;
		}
		return clampCrop({ ...start, x, y }, src);
	}

	let left = start.x;
	let right = start.x + start.w;
	let top = start.y;
	let bottom = start.y + start.h;
	if (handle.includes('w')) left = Math.min(right - minW, Math.max(0, snapIf(left + dx, snapX, t)));
	if (handle.includes('e'))
		right = Math.max(left + minW, Math.min(src.width, snapIf(right + dx, snapX, t)));
	if (handle.includes('n')) top = Math.min(bottom - minH, Math.max(0, snapIf(top + dy, snapY, t)));
	if (handle.includes('s'))
		bottom = Math.max(top + minH, Math.min(src.height, snapIf(bottom + dy, snapY, t)));

	const ratio = options.keepRatio;
	if (ratio && handle.length === 2) {
		// Corner with a fixed shape: follow the larger movement, anchored at the opposite corner.
		let w = right - left;
		let h = bottom - top;
		if (Math.abs(w - start.w) / start.w >= Math.abs(h - start.h) / start.h) h = w / ratio;
		else w = h * ratio;
		const anchorX = handle.includes('w') ? start.x + start.w : start.x;
		const anchorY = handle.includes('n') ? start.y + start.h : start.y;
		const maxW = handle.includes('w') ? anchorX : src.width - anchorX;
		const maxH = handle.includes('n') ? anchorY : src.height - anchorY;
		const scale = Math.min(1, maxW / w, maxH / h);
		w = Math.max(minW, w * scale);
		h = Math.max(minH, h * scale);
		left = handle.includes('w') ? anchorX - w : anchorX;
		top = handle.includes('n') ? anchorY - h : anchorY;
		right = left + w;
		bottom = top + h;
	}
	return clampCrop({ x: left, y: top, w: right - left, h: bottom - top }, src);
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
