/**
 * Overlays: videos, photos and cards on the Layers track, drawn on top of the scenes at any size
 * and position, and free to overlap in time. Pure data and maths, no DOM.
 *
 * Timing: an overlay is linked to the scene it starts over (`sceneId`), and `offset` is how far
 * into that scene (on the timeline) it starts. So moving, trimming or removing scenes before it
 * carries it along. With no scenes it's unlinked and `offset` is from the start of the video.
 *
 * Rows: `row` 0 is the lowest Layers row, drawn first; higher rows are drawn on top.
 */

import type { CardContent } from './card';
import type { Crop } from './crop';
import type { PlacedScene } from './timeline';
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
	/** The scene it starts over (null when there are no scenes). */
	sceneId: string | null;
	/** Seconds after the linked scene's start (or after 0 when unlinked). */
	offset: number;
	/** How long it shows, in seconds. */
	duration: number;
	/** Videos: where in the clip it starts (source seconds). */
	sourceStart: number;
	row: number;
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

/** When an overlay starts on the timeline. */
export function overlayStart(o: Pick<Overlay, 'sceneId' | 'offset'>, placed: PlacedScene[]): number {
	const scene = o.sceneId ? placed.find((p) => p.scene.id === o.sceneId) : undefined;
	return (scene?.start ?? 0) + o.offset;
}

export interface PlacedOverlay {
	overlay: Overlay;
	start: number;
	end: number;
}

/** Every overlay with its start and end, lowest row first (the order they're drawn in). */
export function placeOverlays(overlays: Overlay[], placed: PlacedScene[]): PlacedOverlay[] {
	return overlays
		.map((overlay) => {
			const start = overlayStart(overlay, placed);
			return { overlay, start, end: start + overlay.duration };
		})
		.sort((a, b) => a.overlay.row - b.overlay.row || a.start - b.start);
}

/** Link to the scene under `start` (or the last one, past the end). */
export function linkAt(start: number, placed: PlacedScene[]): Pick<Overlay, 'sceneId' | 'offset'> {
	const t = Math.max(0, start);
	const scene = placed.find((p) => t >= p.start && t < p.end) ?? placed.at(-1);
	return scene ? { sceneId: scene.scene.id, offset: t - scene.start } : { sceneId: null, offset: t };
}

/** The same overlay placed at `start` (linked to the scene there). */
export function moveOverlayTo(o: Overlay, start: number, placed: PlacedScene[]): Overlay {
	return { ...o, ...linkAt(start, placed) };
}

/** Longest an overlay may show: a video can't outlast its clip. */
export function maxOverlayDuration(o: Pick<Overlay, 'kind' | 'sourceStart'>, clipDuration?: number): number {
	if (o.kind !== 'video' || clipDuration === undefined) return Infinity;
	return Math.max(MIN_OVERLAY_SECONDS, clipDuration - o.sourceStart);
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
	a.start < b.end - 1e-6 && b.start < a.end - 1e-6;

/**
 * Put overlay `id` in `row`. If it would overlap another overlay there, a new row is made just
 * above `row` for it instead. Rows are then renumbered so there are no empty ones.
 */
export function assignRow(overlays: Overlay[], id: string, row: number, placed: PlacedScene[]): Overlay[] {
	const times = new Map(placeOverlays(overlays, placed).map((p) => [p.overlay.id, p]));
	const me = times.get(id);
	if (!me) return overlays;
	const clash = overlays.some((o) => o.id !== id && o.row === row && overlaps(times.get(o.id)!, me));
	const next = overlays.map((o) => {
		if (o.id === id) return { ...o, row: clash ? row + 1 : row };
		// Make room for the new row above `row`.
		if (clash && o.row > row) return { ...o, row: o.row + 1 };
		return o;
	});
	return compactRows(next);
}

/** Renumber rows 0, 1, 2… keeping their order (empty rows disappear). */
export function compactRows(overlays: Overlay[]): Overlay[] {
	const used = [...new Set(overlays.map((o) => o.row))].sort((a, b) => a - b);
	if (used.every((r, i) => r === i)) return overlays;
	return overlays.map((o) => ({ ...o, row: used.indexOf(o.row) }));
}

/** How many rows there are (at least one, so the Layers row always shows). */
export function rowCount(overlays: Overlay[]): number {
	return Math.max(1, ...overlays.map((o) => o.row + 1));
}

/**
 * After scenes change in a way that should keep overlays where they are in time (a split, or
 * removing a scene but keeping its overlays), link each overlay to the scene now at its time.
 */
export function relinkByTime(
	overlays: Overlay[],
	before: PlacedScene[],
	after: PlacedScene[],
	ids?: Set<string>
): Overlay[] {
	return overlays.map((o) =>
		!ids || ids.has(o.id) ? { ...o, ...linkAt(overlayStart(o, before), after) } : o
	);
}

/** Overlays linked to a scene. */
export function overlaysOf(overlays: Overlay[], sceneId: string): Overlay[] {
	return overlays.filter((o) => o.sceneId === sceneId);
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
