/**
 * How a scene's picture sits in the video frame when their shapes differ. Pure maths shared by
 * the preview compositor, the storyboard thumbnails and export, so all three match exactly.
 */

export type FrameMode = 'fill' | 'fit' | 'custom';
export type FrameBars = 'black' | 'white' | 'blur';

export interface SceneFrame {
	mode: FrameMode;
	/** What shows around the picture when it doesn't cover the frame (Fit, or zoomed-out Custom). */
	bars: FrameBars;
	/** Custom only: 1 = just covers the frame (like Fill). Smaller shows more, down to Fit. */
	zoom: number;
	/** Custom only: offset of the picture's centre, as a fraction of the frame's width/height. */
	x: number;
	y: number;
}

export const DEFAULT_FRAME: SceneFrame = { mode: 'fill', bars: 'black', zoom: 1, x: 0, y: 0 };
export const MAX_ZOOM = 4;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Smallest Custom zoom: the whole picture visible (the same size as Fit). */
export function minZoom(srcW: number, srcH: number, outW: number, outH: number): number {
	const fit = Math.min(outW / srcW, outH / srcH);
	const cover = Math.max(outW / srcW, outH / srcH);
	return fit / cover;
}

export function clampFrame(
	frame: SceneFrame,
	srcW: number,
	srcH: number,
	outW: number,
	outH: number
): SceneFrame {
	const zoom = Math.min(MAX_ZOOM, Math.max(minZoom(srcW, srcH, outW, outH), frame.zoom));
	// The picture's centre stays inside the frame, so it can't be dragged away entirely.
	const x = Math.min(0.5, Math.max(-0.5, frame.x));
	const y = Math.min(0.5, Math.max(-0.5, frame.y));
	return { ...frame, zoom, x, y };
}

/** Where the picture is drawn in an output frame of outW × outH pixels (top-left origin). */
export function frameRect(
	frame: SceneFrame | undefined,
	srcW: number,
	srcH: number,
	outW: number,
	outH: number
): Rect {
	const f = frame ?? DEFAULT_FRAME;
	const fit = Math.min(outW / srcW, outH / srcH);
	const cover = Math.max(outW / srcW, outH / srcH);
	let scale = cover;
	let cx = outW / 2;
	let cy = outH / 2;
	if (f.mode === 'fit') scale = fit;
	else if (f.mode === 'custom') {
		const c = clampFrame(f, srcW, srcH, outW, outH);
		scale = cover * c.zoom;
		cx += c.x * outW;
		cy += c.y * outH;
	}
	const w = srcW * scale;
	const h = srcH * scale;
	return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Whether the picture leaves part of the frame uncovered (so bars show). */
export function showsBars(rect: Rect, outW: number, outH: number): boolean {
	const e = 0.5;
	return rect.x > e || rect.y > e || rect.x + rect.w < outW - e || rect.y + rect.h < outH - e;
}
