/**
 * Sizes of the storyboard and how the window is shared between the preview and the storyboard.
 * Pure numbers and functions, no DOM.
 */

import { TEXT_TRACK_NAME, type Track } from '$lib/model/tracks';

/** The time ruler (matches --ruler-h). */
export const RULER_H = 26;
/** The Scenes track (matches --scenes-h, plus its 2 px padding above and below). */
export const SCENES_H = 104;
export const SCENES_ROW_H = SCENES_H + 4;
/** Overlay tracks with pictures: about 60% of the Scenes track, room for thumbnails. */
export const VISUAL_H = 62;
/** Text and audio tracks. */
export const SLIM_H = 40;
/** A collapsed track: a thin strip with bars where its items are. */
export const COLLAPSED_H = 20;
/** Space between tracks (matches --row-gap). */
export const ROW_GAP = 6;
/** The "+ Audio track" row under the tracks. */
export const ADD_ROW_H = 22;
/** The storyboard's own padding above and below its tracks. */
export const STORYBOARD_PAD = 12 + 16;
/** The divider between the preview and the storyboard. */
export const DIVIDER_H = 8;
/** The preview's area never gets smaller than this share of the window's height. */
export const MIN_PREVIEW_SHARE = 0.4;

/** Whether an overlay track holds words only (or is the empty "Text" track): drawn slim. */
export function isTextTrack(track: Track, items: { trackId: string; kind: 'overlay' | 'text' | 'sound' }[]): boolean {
	if (track.kind !== 'overlay') return false;
	const mine = items.filter((i) => i.trackId === track.id);
	return mine.length ? mine.every((i) => i.kind === 'text') : track.name === TEXT_TRACK_NAME;
}

/** A track's lane height. */
export function trackHeight(track: Track, items: { trackId: string; kind: 'overlay' | 'text' | 'sound' }[]): number {
	if (track.kind === 'main') return SCENES_ROW_H;
	if (track.collapsed) return COLLAPSED_H;
	if (track.kind === 'audio' || isTextTrack(track, items)) return SLIM_H;
	return VISUAL_H;
}

/** The storyboard's smallest height: the ruler and the Scenes track. */
export const MIN_STORYBOARD_H = STORYBOARD_PAD + RULER_H + ROW_GAP + SCENES_ROW_H + 8;

/**
 * The default height: the ruler and about four tracks (Scenes, a picture track, two slim ones)
 * with the "+ Audio track" row.
 */
export const DEFAULT_STORYBOARD_H =
	STORYBOARD_PAD + RULER_H + SCENES_ROW_H + VISUAL_H + 2 * SLIM_H + ADD_ROW_H + 5 * ROW_GAP + 8;

/** How tall the storyboard may be in a window `windowH` tall under a top bar `topbarH` tall. */
export function storyboardLimits(windowH: number, topbarH: number): { min: number; max: number } {
	const max = Math.floor(windowH - topbarH - DIVIDER_H - windowH * MIN_PREVIEW_SHARE);
	return { min: MIN_STORYBOARD_H, max: Math.max(MIN_STORYBOARD_H, max) };
}

/** The storyboard's height: the one chosen (or the default), within the limits. */
export function storyboardHeight(chosen: number | null, windowH: number, topbarH: number): number {
	const { min, max } = storyboardLimits(windowH, topbarH);
	return Math.round(Math.min(max, Math.max(min, chosen ?? DEFAULT_STORYBOARD_H)));
}

const KEY = 'scenes.storyboardHeight';

/** The height chosen with the divider on this device, or null for the default. */
export function readStoryboardHeight(): number | null {
	try {
		const v = Number(localStorage.getItem(KEY));
		return v > 0 ? v : null;
	} catch {
		return null;
	}
}

export function writeStoryboardHeight(h: number | null): void {
	try {
		if (h === null) localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, String(Math.round(h)));
	} catch {
		// Storage blocked: it just isn't remembered.
	}
}

/** The top bar (matches --topbar-h). */
export const TOPBAR_H = 64;
