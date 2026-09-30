/**
 * Tracks: the storyboard's rows. Pure data and helpers, no DOM.
 *
 * - The main track holds the scenes (exactly one; magnetic, no gaps).
 * - Overlay tracks (any number, above the main track) hold videos, photos, cards and text at
 *   fixed times; higher tracks are drawn on top.
 * - Audio tracks (any number, below the main track) hold music and voiceovers.
 *
 * `Project.tracks` is in storyboard order, top to bottom: overlay tracks (highest first), the
 * main track, then audio tracks. Items (`overlays`, `texts`, `sounds`) name their track by
 * `trackId` and have a fixed `start` on the timeline.
 */

export type TrackKind = 'main' | 'overlay' | 'audio';

export interface Track {
	id: string;
	kind: TrackKind;
	name: string;
	/** Visual tracks: left out of the preview and export. */
	hidden: boolean;
	/** Audio tracks: left out of the mix. */
	muted: boolean;
	/** Its items can't be selected, moved or changed. */
	locked: boolean;
	/** Shown as a thin strip in the storyboard (a view setting, saved with the project). */
	collapsed?: boolean;
}

export const MAIN_TRACK_ID = 'main';
export const TEXT_TRACK_NAME = 'Text';

export function newTrack(id: string, kind: TrackKind, name: string): Track {
	return { id, kind, name, hidden: false, muted: false, locked: false };
}

export const mainTrack = (): Track => newTrack(MAIN_TRACK_ID, 'main', 'Scenes');

/** Something placed on a track at a fixed time. */
export interface TimedItem {
	id: string;
	trackId: string;
	start: number;
	duration: number;
}

export type ItemKind = 'overlay' | 'text' | 'sound';

/** The default name for a new track of this kind: "Overlay 3", "Audio 2" (lowest free number). */
export function nextTrackName(tracks: Track[], kind: 'overlay' | 'audio'): string {
	const base = kind === 'overlay' ? 'Overlay' : 'Audio';
	const used = new Set(tracks.map((t) => t.name));
	for (let n = 1; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Overlay tracks first, then the main track, then audio tracks (each keeping its order). */
export function orderTracks(tracks: Track[]): Track[] {
	const main = tracks.find((t) => t.kind === 'main') ?? mainTrack();
	return [...tracks.filter((t) => t.kind === 'overlay'), main, ...tracks.filter((t) => t.kind === 'audio')];
}

/** Overlay tracks from the lowest (just above the main track) to the highest: drawing order. */
export function overlayTracksBottomUp(tracks: Track[]): Track[] {
	return tracks.filter((t) => t.kind === 'overlay').reverse();
}

/** Can an item of this kind go on this track? Visual items on overlay tracks, sound on audio. */
export function accepts(track: Track | undefined, kind: ItemKind): boolean {
	if (!track) return false;
	return kind === 'sound' ? track.kind === 'audio' : track.kind === 'overlay';
}

const overlaps = (a: { start: number; duration: number }, b: { start: number; duration: number }) =>
	a.start < b.start + b.duration - 1e-6 && b.start < a.start + a.duration - 1e-6;

/** Whether `span` fits on a track among `items` (ignoring those in `except`). */
export function fits(
	items: TimedItem[],
	trackId: string,
	span: { start: number; duration: number },
	except: Set<string> = new Set()
): boolean {
	return !items.some((i) => i.trackId === trackId && !except.has(i.id) && overlaps(i, span));
}

/** Insert a new track at `index` in the list (the order is then made valid). */
export function insertTrack(tracks: Track[], track: Track, index: number): Track[] {
	const next = tracks.slice();
	next.splice(Math.max(0, Math.min(index, next.length)), 0, track);
	return orderTracks(next);
}

/**
 * Where a new track goes "just above" `trackId`: for overlay tracks that's the position before it
 * in the list (drawn on top of it); for audio tracks too (shown above it).
 */
export function indexAbove(tracks: Track[], trackId: string): number {
	return Math.max(0, tracks.findIndex((t) => t.id === trackId));
}

/** The first track of a kind (top to bottom) where `span` fits, or null. */
export function freeTrack(
	tracks: Track[],
	items: TimedItem[],
	kind: 'overlay' | 'audio',
	span: { start: number; duration: number },
	fromTop = true
): Track | null {
	const list = tracks.filter((t) => t.kind === kind && !t.locked);
	const ordered = fromTop ? list : list.reverse();
	return ordered.find((t) => fits(items, t.id, span)) ?? null;
}

// ─── Migration from rows, the Words lane and scene links ───────────────────────────────────

interface LegacyOverlay {
	id: string;
	sceneId?: string | null;
	offset?: number;
	row?: number;
	start?: number;
	trackId?: string;
	[key: string]: unknown;
}
interface LegacySound {
	id: string;
	row?: number;
	trackId?: string;
	[key: string]: unknown;
}
interface LegacyText {
	id: string;
	trackId?: string;
	[key: string]: unknown;
}

/**
 * Turn a project from before tracks into one with tracks, losing nothing:
 * every Layers row → an overlay track (same stacking), the Words lane → an overlay track "Text"
 * above them all (text stayed on top), every Sound row → an audio track. Overlays linked to scenes
 * keep their timeline position. There's always at least one overlay and one audio track, as the
 * old storyboard always showed a Layers and a Sound row.
 */
export function migrateToTracks<
	P extends {
		tracks?: Track[];
		overlays?: LegacyOverlay[];
		texts?: LegacyText[];
		sounds?: LegacySound[];
	}
>(project: P, sceneStarts: Map<string, number>, newId: () => string): P & { tracks: Track[] } {
	if (Array.isArray(project.tracks) && project.tracks.some((t) => t.kind === 'main')) {
		return { ...project, tracks: orderTracks(project.tracks) };
	}
	const overlays = project.overlays ?? [];
	const texts = project.texts ?? [];
	const sounds = project.sounds ?? [];

	const tracks: Track[] = [];
	if (texts.length) tracks.push(newTrack(newId(), 'overlay', TEXT_TRACK_NAME));
	const textTrackId = tracks[0]?.id;
	// Layers rows: the highest row is the top track.
	const overlayRows = Math.max(1, ...overlays.map((o) => (o.row ?? 0) + 1));
	const overlayTrackIds: string[] = [];
	for (let row = overlayRows - 1; row >= 0; row--) {
		const t = newTrack(newId(), 'overlay', `Overlay ${row + 1}`);
		overlayTrackIds[row] = t.id;
		tracks.push(t);
	}
	tracks.push(mainTrack());
	const soundRows = Math.max(1, ...sounds.map((s) => (s.row ?? 0) + 1));
	const soundTrackIds: string[] = [];
	for (let row = 0; row < soundRows; row++) {
		const t = newTrack(newId(), 'audio', `Audio ${row + 1}`);
		soundTrackIds[row] = t.id;
		tracks.push(t);
	}

	return {
		...project,
		tracks,
		overlays: overlays.map((o) => {
			const { sceneId, offset, row, ...rest } = o;
			const start = o.start ?? (sceneId ? (sceneStarts.get(sceneId) ?? 0) : 0) + (offset ?? 0);
			return { ...rest, start, trackId: o.trackId ?? overlayTrackIds[row ?? 0] };
		}),
		texts: texts.map((t) => ({ ...t, trackId: t.trackId ?? textTrackId })),
		sounds: sounds.map((s) => {
			const { row, ...rest } = s;
			return { ...rest, trackId: s.trackId ?? soundTrackIds[row ?? 0] };
		})
	} as P & { tracks: Track[] };
}
