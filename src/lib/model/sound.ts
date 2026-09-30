/**
 * Editing sound clips (music and voiceovers) on the Sound lane: trimming, moving, splitting,
 * rows and snapping. Pure functions, no DOM.
 *
 * A clip plays `duration` seconds of its file from `sourceStart`, starting at `start` on the
 * timeline. Trimming changes `sourceStart`/`duration` (never beyond the file); moving changes
 * `start`. `row` 0 is the first Sound row; overlapping clips go in different rows.
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

// ─── Rows ──────────────────────────────────────────────────────────────────────────────────

type Placed = Pick<SoundItem, 'id' | 'row' | 'start' | 'duration'>;

const overlaps = (a: Placed, b: Placed) =>
	a.start < b.start + b.duration - 1e-6 && b.start < a.start + a.duration - 1e-6;

/** The lowest row where a clip from `start` for `duration` fits without overlapping. */
export function freeRow(sounds: Placed[], start: number, duration: number, except?: string): number {
	const probe = { id: '', row: 0, start, duration };
	for (let row = 0; ; row++) {
		if (!sounds.some((s) => s.id !== except && s.row === row && overlaps(s, probe))) return row;
	}
}

/**
 * Put clip `id` in `row`. If it would overlap another clip there, a new row is made just below
 * `row` for it (rows further down shift down). Then empty rows are removed.
 */
export function assignSoundRow<T extends Placed>(sounds: T[], id: string, row: number): T[] {
	const me = sounds.find((s) => s.id === id);
	if (!me) return sounds;
	const moved = { ...me, row };
	const clash = sounds.some((s) => s.id !== id && s.row === row && overlaps(s, moved));
	const next = sounds.map((s) => {
		if (s.id === id) return { ...s, row: clash ? row + 1 : row };
		if (clash && s.row > row) return { ...s, row: s.row + 1 };
		return s;
	});
	return compactSoundRows(next);
}

/** Renumber rows 0, 1, 2… keeping their order (empty rows disappear). */
export function compactSoundRows<T extends Pick<SoundItem, 'row'>>(sounds: T[]): T[] {
	const used = [...new Set(sounds.map((s) => s.row))].sort((a, b) => a - b);
	if (used.every((r, i) => r === i)) return sounds;
	return sounds.map((s) => ({ ...s, row: used.indexOf(s.row) }));
}

/** How many Sound rows to show (at least one). */
export function soundRowCount(sounds: Pick<SoundItem, 'row'>[]): number {
	return Math.max(1, ...sounds.map((s) => s.row + 1));
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
export function migrateSounds(sounds: (SoundItem & { fade?: boolean })[]): SoundItem[] {
	const needsRows = sounds.some((s) => typeof s.row !== 'number');
	let out = sounds.map((s) => {
		const { fade, ...rest } = s;
		return {
			...rest,
			fadeIn: typeof s.fadeIn === 'number' ? s.fadeIn : fade ? MUSIC_FADE_IN : 0,
			fadeOut: typeof s.fadeOut === 'number' ? s.fadeOut : fade ? MUSIC_FADE_OUT : 0,
			row: typeof s.row === 'number' ? s.row : 0
		};
	});
	if (needsRows) {
		// Music on the first row, voiceovers where they fit below.
		const placed: SoundItem[] = [];
		const order = [...out].sort((a, b) => (a.kind === b.kind ? a.start - b.start : a.kind === 'music' ? -1 : 1));
		for (const s of order) placed.push({ ...s, row: freeRow(placed, s.start, s.duration) });
		out = out.map((s) => placed.find((p) => p.id === s.id)!);
	}
	return out;
}
