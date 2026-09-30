/**
 * Editing sound clips (music and voiceovers) on the Sound lane: trimming, moving, splitting,
 * rows and snapping. Pure functions, no DOM.
 *
 * A clip plays `duration` seconds of its file from `sourceStart`, starting at `start` on the
 * timeline. Trimming changes `sourceStart`/`duration` (never beyond the file); moving changes
 * `start`. Clips live on audio tracks (see tracks.ts).
 */

import type { SoundItem } from './types';

/** Shortest clip a trim or split may leave. */
export const MIN_SOUND = 0.3;
/** Longest fade the handles allow. */
export const MAX_FADE = 5;
/** New songs fade in and out by this much (the "automatic" fade). */
export const MUSIC_FADE_IN = 1.5;
export const MUSIC_FADE_OUT = 3;

/** The part of the file a clip may use: from its first sample to its end, in source seconds. */
export interface SoundBounds {
	start: number;
	end: number;
}

/** Where a clip stops on the timeline (it also stops when the video ends). */
export function soundEnd(sound: Pick<SoundItem, 'start' | 'duration'>, videoLength: number): number {
	return Math.min(sound.start + sound.duration, videoLength);
}

/**
 * Trim a clip's start or end edge by `delta` timeline seconds (positive = to the right).
 * The start edge keeps the rest of the audio where it was (the start and the source offset move
 * together); neither edge goes beyond the file, below the timeline's start, or shorter than
 * MIN_SOUND. `visibleEnd` is where the end edge is drawn (the clip may run past the video's end).
 */
export function trimSound(
	s: SoundItem,
	edge: 'start' | 'end',
	delta: number,
	file: SoundBounds,
	visibleEnd = s.start + s.duration
): SoundItem {
	if (edge === 'end') {
		const end = Math.min(visibleEnd + delta, s.start + (file.end - s.sourceStart));
		return { ...s, duration: Math.max(MIN_SOUND, end - s.start) };
	}
	let d = Math.min(delta, s.duration - MIN_SOUND);
	d = Math.max(d, file.start - s.sourceStart, -s.start);
	return { ...s, start: s.start + d, sourceStart: s.sourceStart + d, duration: s.duration - d };
}

/**
 * Split a clip at timeline time `t` into two clips that play exactly as before. The first keeps
 * the fade in, the second the fade out. Returns null if `t` isn't inside it (with room for both).
 */
export function splitSound(s: SoundItem, t: number, newId: () => string): [SoundItem, SoundItem] | null {
	const at = t - s.start;
	if (at < MIN_SOUND || s.duration - at < MIN_SOUND) return null;
	return [
		{ ...s, duration: at, fadeOut: 0 },
		{ ...s, id: newId(), start: t, sourceStart: s.sourceStart + at, duration: s.duration - at, fadeIn: 0 }
	];
}

/** Fades as heard: at most MAX_FADE, and together no longer than the clip. */
export function effectiveFades(s: Pick<SoundItem, 'fadeIn' | 'fadeOut'>, length: number): { fadeIn: number; fadeOut: number } {
	const fadeIn = Math.max(0, Math.min(MAX_FADE, s.fadeIn));
	const fadeOut = Math.max(0, Math.min(MAX_FADE, s.fadeOut));
	const total = fadeIn + fadeOut;
	if (total <= length || total === 0) return { fadeIn, fadeOut };
	const k = length / total;
	return { fadeIn: fadeIn * k, fadeOut: fadeOut * k };
}

// ─── Older projects ───────────────────────────────────────────────────────────────────────

type Placed = { id: string; row: number; start: number; duration: number };

const overlapsRow = (a: Placed, b: Placed) =>
	a.start < b.start + b.duration - 1e-6 && b.start < a.start + a.duration - 1e-6;

/** The lowest row where a clip from `start` for `duration` fits (for migrating old projects). */
export function freeRow(sounds: Placed[], start: number, duration: number): number {
	const probe = { id: '', row: 0, start, duration };
	for (let row = 0; ; row++) if (!sounds.some((s) => s.row === row && overlapsRow(s, probe))) return row;
}

// ─── Snapping ──────────────────────────────────────────────────────────────────────────────

/**
 * Snap `times` (e.g. a clip's start and end, which move together) to the nearest target within
 * `within(t, target)`. Returns how far to shift them, and the target snapped to (or null).
 */
export function snapTimes(
	times: number[],
	targets: number[],
	within: (t: number, target: number) => boolean
): { shift: number; target: number | null } {
	let best: { shift: number; target: number } | null = null;
	for (const t of times) {
		for (const target of targets) {
			if (!within(t, target)) continue;
			const shift = target - t;
			if (!best || Math.abs(shift) < Math.abs(best.shift)) best = { shift, target };
		}
	}
	return best ?? { shift: 0, target: null };
}

/**
 * Migrate a sound saved before trimming and rows existed: `fade: true` becomes the automatic
 * fade lengths, voiceovers stack in rows under the music.
 */
export function migrateSounds<T extends Partial<SoundItem> & { id: string; fade?: boolean; row?: number }>(
	sounds: T[]
): (T & { fadeIn: number; fadeOut: number; row: number })[] {
	// Already on tracks: nothing to place.
	const needsRows = sounds.some((s) => typeof s.row !== 'number' && typeof s.trackId !== 'string');
	let out = sounds.map((s) => {
		const { fade, ...rest } = s;
		const fades = {
			fadeIn: typeof s.fadeIn === 'number' ? s.fadeIn : fade ? MUSIC_FADE_IN : 0,
			fadeOut: typeof s.fadeOut === 'number' ? s.fadeOut : fade ? MUSIC_FADE_OUT : 0
		};
		// On a track already: no row (tracks replaced rows).
		if (typeof s.trackId === 'string') return { ...rest, ...fades } as never;
		return { ...rest, ...fades, row: typeof s.row === 'number' ? s.row : 0 };
	});
	if (needsRows) {
		// Music on the first row, voiceovers where they fit below.
		const placed: typeof out = [];
		const order = [...out].sort((a, b) =>
			a.kind === b.kind ? (a.start ?? 0) - (b.start ?? 0) : a.kind === 'music' ? -1 : 1
		);
		for (const s of order)
			placed.push({ ...s, row: freeRow(placed as never, s.start ?? 0, s.duration ?? 0) });
		out = out.map((s) => placed.find((p) => p.id === s.id)!);
	}
	return out as never;
}
