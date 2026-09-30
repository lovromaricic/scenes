/**
 * Overlays: videos, photos and cards on overlay tracks, drawn on top of the scenes at any size
 * and position. Each has a fixed start on the timeline and lives on a track (`trackId`); higher
 * tracks are drawn on top of lower ones (see tracks.ts). Pure data and maths, no DOM.
 */

import type { CardContent } from './card';
import type { Crop } from './crop';
import type { TextAnimation } from './types';

export type OverlayKind = 'video' | 'photo' | 'card';
export type OverlayShadow = 'off' | 'soft' | 'strong';

/** Where an overlay sits, as fractions of the frame (top-left corner and size). */
export interface OverlayBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface OverlayStyle {
	/** Corner radius as a fraction of half the overlay's shorter side (0 = square, 1 = pill). */
	radius: number;
	borderColor: string;
	/** Border thickness in project pixels (0 = none). */
	borderWidth: number;
	shadow: OverlayShadow;
	/** 0–1. */
	opacity: number;
}

export interface Overlay {
	id: string;
	kind: OverlayKind;
	/** The source file (videos and photos); '' for cards. */
	mediaId: string;
	name: string;
	/** The overlay track it's on. */
	trackId: string;
	/** When it starts on the timeline, in seconds. */
	start: number;
	/** How long it shows, in seconds. */
	duration: number;
	/** Videos: where in the clip it starts (source seconds). */
	sourceStart: number;
	box: OverlayBox;
	/** Part of the source kept, in source pixels (missing = whole picture). */
	crop?: Crop;
	/** Cards: background and rectangle, drawn inside the box. */
	card?: CardContent;
	style: OverlayStyle;
	enter: TextAnimation;
	exit: TextAnimation;
	/** Videos: the clip's own sound (off by default). */
	sound: { on: boolean; volume: number };
}


export const OVERLAY_SECONDS = 5;
/** New overlays are this wide, as a fraction of the frame. */
export const OVERLAY_WIDTH = 0.4;
export const MIN_OVERLAY_SECONDS = 0.5;
/** At most this many video overlays may play at the same moment (decoding cost). */
export const MAX_VIDEO_OVERLAYS = 4;
/** Margin for the quick placement buttons, as a fraction of the frame's shorter side. */
export const PLACEMENT_MARGIN = 0.04;

export const DEFAULT_OVERLAY_STYLE: OverlayStyle = {
	radius: 0,
	borderColor: '#ffffff',
	borderWidth: 0,
	shadow: 'off',
	opacity: 1
};

/** A box `OVERLAY_WIDTH` wide, centred, with the picture's own proportions. */
export function defaultBox(
	picture: { width: number; height: number },
	frame: { width: number; height: number }
): OverlayBox {
	const w = OVERLAY_WIDTH;
	const h = Math.min(0.9, (w * frame.width * picture.height) / picture.width / frame.height);
	const fitW = (h * frame.height * picture.width) / picture.height / frame.width;
	return { x: (1 - fitW) / 2, y: (1 - h) / 2, w: fitW, h };
}

/**
 * The same box with a picture's proportions: it keeps its centre and width, unless that would be
 * taller than 90% of the frame, then it's narrower instead.
 */
export function fitShape(
	box: OverlayBox,
	picture: { width: number; height: number },
	frame: { width: number; height: number }
): OverlayBox {
	const ratio = (picture.width / picture.height) * (frame.height / frame.width); // w / h in fractions
	let w = box.w;
	let h = w / ratio;
	if (h > 0.9) {
		h = 0.9;
		w = h * ratio;
	}
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export interface PlacedOverlay {
	overlay: Overlay;
	start: number;
	end: number;
}

/**
 * Every overlay with its start and end, in drawing order: lowest track first (tracks listed top
 * to bottom in `trackOrder`), then by start time.
 */
export function placeOverlays(overlays: Overlay[], trackOrder: string[] = []): PlacedOverlay[] {
	const depth = (id: string) => {
		const i = trackOrder.indexOf(id);
		return i === -1 ? -Infinity : -i;
	};
	return overlays
		.map((overlay) => ({ overlay, start: overlay.start, end: overlay.start + overlay.duration }))
		.sort((a, b) => depth(a.overlay.trackId) - depth(b.overlay.trackId) || a.start - b.start);
}

/** Longest an overlay may show: a video can't outlast its clip. */
export function maxOverlayDuration(o: Pick<Overlay, 'kind' | 'sourceStart'>, clipDuration?: number): number {
	if (o.kind !== 'video' || clipDuration === undefined) return Infinity;
	return Math.max(MIN_OVERLAY_SECONDS, clipDuration - o.sourceStart);
}

/** Video overlays showing at `t`. */
export function videoOverlaysAt(placed: PlacedOverlay[], t: number): PlacedOverlay[] {
	return placed.filter((p) => p.overlay.kind === 'video' && t >= p.start && t < p.end);
}

/**
 * Whether one more video overlay from `start` for `duration` would make more than
 * MAX_VIDEO_OVERLAYS play at once.
 */
export function tooManyVideos(placed: PlacedOverlay[], start: number, duration: number, except?: string): boolean {
	const others = placed.filter((p) => p.overlay.kind === 'video' && p.overlay.id !== except);
	// The count only changes at starts, so checking every start inside the new span is enough.
	const moments = [start, ...others.map((p) => p.start).filter((t) => t > start && t < start + duration)];
	return moments.some(
		(t) => others.filter((p) => t >= p.start - 1e-6 && t < p.end - 1e-6).length >= MAX_VIDEO_OVERLAYS
	);
}

/** The most video overlays playing at the same moment. */
export function mostVideosAtOnce(placed: PlacedOverlay[]): number {
	const videos = placed.filter((p) => p.overlay.kind === 'video');
	// The count only goes up at starts.
	return Math.max(0, ...videos.map((v) => videos.filter((p) => v.start >= p.start - 1e-6 && v.start < p.end - 1e-6).length));
}

/** Quick placement: a corner or the centre, with a small margin. */
export type Placement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export function placeBox(box: OverlayBox, where: Placement, frame: { width: number; height: number }): OverlayBox {
	const short = Math.min(frame.width, frame.height);
	const mx = (PLACEMENT_MARGIN * short) / frame.width;
	const my = (PLACEMENT_MARGIN * short) / frame.height;
	const left = mx;
	const right = 1 - mx - box.w;
	const top = my;
	const bottom = 1 - my - box.h;
	switch (where) {
		case 'top-left':
			return { ...box, x: left, y: top };
		case 'top-right':
			return { ...box, x: right, y: top };
		case 'bottom-left':
			return { ...box, x: left, y: bottom };
		case 'bottom-right':
			return { ...box, x: right, y: bottom };
		case 'center':
			return { ...box, x: (1 - box.w) / 2, y: (1 - box.h) / 2 };
	}
}

/** Entrance and exit: how visible, how far moved (fraction of the box height) and how big. */
export interface OverlayAnimationState {
	alpha: number;
	dy: number;
	scale: number;
}

export const OVERLAY_ANIMATION_SECONDS = 0.4;

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const backOut = (x: number) => {
	const c = 1.70158;
	return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

function animationAt(kind: TextAnimation, p: number): OverlayAnimationState {
	// p: 0 = hidden, 1 = fully shown.
	const q = Math.min(1, Math.max(0, p));
	switch (kind) {
		case 'none':
			return { alpha: 1, dy: 0, scale: 1 };
		case 'fade':
			return { alpha: easeOut(q), dy: 0, scale: 1 };
		case 'slide-up':
			return { alpha: easeOut(q), dy: (1 - easeOut(q)) * 0.25, scale: 1 };
		case 'pop':
			return { alpha: Math.min(1, q * 2), dy: 0, scale: 0.6 + 0.4 * backOut(q) };
	}
}

/** The overlay's entrance or exit at `t` seconds into it (0 ≤ t ≤ duration). */
export function overlayAnimation(
	o: Pick<Overlay, 'enter' | 'exit' | 'duration'>,
	t: number
): OverlayAnimationState {
	const len = Math.min(OVERLAY_ANIMATION_SECONDS, o.duration / 2);
	if (len <= 0) return { alpha: 1, dy: 0, scale: 1 };
	if (t < len) return animationAt(o.enter, t / len);
	if (t > o.duration - len) {
		// Exits play the entrance backwards, except slide-up keeps going up as it leaves.
		const state = animationAt(o.exit, (o.duration - t) / len);
		return { ...state, dy: -state.dy };
	}
	return { alpha: 1, dy: 0, scale: 1 };
}
