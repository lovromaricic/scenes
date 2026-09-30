import type { FrameImage, FrameResult } from '$lib/media/frames';
import { MOOD_GRADES, type GradeParams } from '$lib/model/moods';
import { croppedSize, cropUv, type Size } from '$lib/model/crop';
import type { Rect } from '$lib/model/framing';
import { overlayAnimation, type OverlayShadow, type PlacedOverlay } from '$lib/model/overlay';
import type { MoodId } from '$lib/model/types';

/**
 * How an overlay is drawn in an output frame, shared by the preview, Watch, thumbnails and
 * export so they all match. All sizes are in output pixels.
 */
export interface OverlayDraw {
	image: FrameImage;
	/** Part of the image to use, as u, v (bottom-left), width, height in 0–1. */
	uv: [number, number, number, number];
	/** The overlay's box after its animation, top-left origin. */
	rect: Rect;
	radius: number;
	borderWidth: number;
	/** 0–1 RGB. */
	borderColor: [number, number, number];
	shadow: ShadowParams | null;
	/** Overall opacity, including the entrance/exit animation. */
	opacity: number;
	grade: GradeParams;
}

export interface ShadowParams {
	blur: number;
	offsetX: number;
	offsetY: number;
	alpha: number;
}

/** Shadow sizes as fractions of the frame's shorter side, so they look the same at any size. */
const SHADOWS: Record<Exclude<OverlayShadow, 'off'>, { blur: number; offset: number; alpha: number }> = {
	soft: { blur: 0.03, offset: 0.008, alpha: 0.35 },
	strong: { blur: 0.05, offset: 0.018, alpha: 0.6 }
};

export function shadowParams(shadow: OverlayShadow, outW: number, outH: number): ShadowParams | null {
	if (shadow === 'off') return null;
	const s = SHADOWS[shadow];
	const short = Math.min(outW, outH);
	return { blur: s.blur * short, offsetX: 0, offsetY: s.offset * short, alpha: s.alpha };
}

export function hexToRgb(hex: string): [number, number, number] {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return [1, 1, 1];
	const n = parseInt(m[1], 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * The part of a picture of `aspect` (w/h) that covers a box of `boxAspect`, within `uv`: the
 * picture fills the box, trimming the sides or top and bottom rather than stretching.
 */
export function coverUv(
	uv: [number, number, number, number],
	aspect: number,
	boxAspect: number
): [number, number, number, number] {
	const [u, v, w, h] = uv;
	if (!(aspect > 0) || !(boxAspect > 0)) return uv;
	if (aspect > boxAspect) {
		const k = boxAspect / aspect;
		return [u + (w * (1 - k)) / 2, v, w * k, h];
	}
	const k = aspect / boxAspect;
	return [u, v + (h * (1 - k)) / 2, w, h * k];
}

/** Where an overlay's box is at time `t` (with its animation), in output pixels. */
export function overlayRect(p: PlacedOverlay, t: number, outW: number, outH: number) {
	const o = p.overlay;
	const anim = overlayAnimation(o, t - p.start);
	const w = o.box.w * outW * anim.scale;
	const h = o.box.h * outH * anim.scale;
	const cx = (o.box.x + o.box.w / 2) * outW;
	const cy = (o.box.y + o.box.h / 2) * outH + anim.dy * o.box.h * outH;
	return { rect: { x: cx - w / 2, y: cy - h / 2, w, h }, alpha: anim.alpha, scale: anim.scale };
}

/**
 * An overlay's draw for an output frame of outW × outH at time `t`. `frame` is its picture (a
 * video or photo frame, or the card drawn at the box's size); `source` is the file's own size
 * (crops are measured in it); `projectWidth` turns the border (in project pixels) into output
 * pixels.
 */
export function overlayDraw(
	frame: FrameResult,
	p: PlacedOverlay,
	t: number,
	mood: MoodId,
	outW: number,
	outH: number,
	projectWidth: number,
	source: Size = { width: frame.width, height: frame.height }
): OverlayDraw {
	const o = p.overlay;
	const { rect, alpha, scale } = overlayRect(p, t, outW, outH);
	const card = o.kind === 'card';
	const crop = card ? undefined : o.crop;
	const cropped = croppedSize(crop, source);
	const px = outW / projectWidth;
	const border = Math.min(o.style.borderWidth * px * scale, Math.min(rect.w, rect.h) / 2);
	// The picture fills the area inside the border.
	const innerAspect = Math.max(1, rect.w - 2 * border) / Math.max(1, rect.h - 2 * border);
	return {
		image: frame.image,
		uv: card ? [0, 0, 1, 1] : coverUv(cropUv(crop, source), cropped.width / cropped.height, innerAspect),
		rect,
		radius: (o.style.radius * Math.min(rect.w, rect.h)) / 2,
		borderWidth: border,
		borderColor: hexToRgb(o.style.borderColor),
		shadow: shadowParams(o.style.shadow, outW, outH),
		opacity: Math.max(0, Math.min(1, o.style.opacity * alpha)),
		// Cards keep their exact colours; pictures follow the video's look.
		grade: MOOD_GRADES[card ? 'natural' : mood]
	};
}

/** Pixel size to draw a card overlay's picture at (its box in the output). */
export function cardSize(p: PlacedOverlay, outW: number, outH: number): Size {
	return {
		width: Math.max(2, Math.round(p.overlay.box.w * outW)),
		height: Math.max(2, Math.round(p.overlay.box.h * outH))
	};
}
