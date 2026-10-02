/**
 * Items on tracks (overlays, text, sound clips) handled the same way, whatever they are: listing
 * them, placing one on a track without overlapping, moving several together, and managing the
 * tracks themselves. Pure functions over a project (they return a new one), no DOM.
 */

import type { Overlay } from './overlay';
import {
	accepts,
	fits,
	indexAbove,
	insertTrack,
	newTrack,
	nextTrackName,
	orderTracks,
	type ItemKind,
	type TimedItem,
	type Track
} from './tracks';
import type { Project, SoundItem, TextItem } from './types';

export type AnyItem = Overlay | TextItem | SoundItem;
export type KindedItem = TimedItem & { kind: ItemKind };

type WithItems = Pick<Project, 'tracks' | 'overlays' | 'texts' | 'sounds'>;

const lists = { overlay: 'overlays', text: 'texts', sound: 'sounds' } as const;

/** What something is called before it's renamed: the file's name, "Card", or a text's words. */
export function defaultName(x: { name: string } | { text: string }): string {
	return 'text' in x ? x.text : x.name;
}

/** What a scene or item is called: the name given in this project, else its default. */
export function displayName(x: ({ name: string } | { text: string }) & { label?: string }): string {
	return x.label?.trim() || defaultName(x);
}

/**
 * The label for a new name: none when it's empty or the default (so the default shows, and
 * follows a text's words as they change), else the name as typed (trimmed).
 */
export function labelFor(x: { name: string } | { text: string }, name: string): string | undefined {
	const n = name.trim();
	return n && n !== defaultName(x) ? n : undefined;
}

/** Every item on every track. */
export function allItems(p: WithItems): KindedItem[] {
	return [
		...p.overlays.map((o) => ({ id: o.id, trackId: o.trackId, start: o.start, duration: o.duration, kind: 'overlay' as const })),
		...p.texts.map((t) => ({ id: t.id, trackId: t.trackId, start: t.start, duration: t.duration, kind: 'text' as const })),
		...p.sounds.map((s) => ({ id: s.id, trackId: s.trackId, start: s.start, duration: s.duration, kind: 'sound' as const }))
	];
}

export function itemKind(p: WithItems, id: string): ItemKind | null {
	if (p.overlays.some((o) => o.id === id)) return 'overlay';
	if (p.texts.some((t) => t.id === id)) return 'text';
	if (p.sounds.some((s) => s.id === id)) return 'sound';
	return null;
}

export function getItem(p: WithItems, id: string): AnyItem | undefined {
	return p.overlays.find((o) => o.id === id) ?? p.texts.find((t) => t.id === id) ?? p.sounds.find((s) => s.id === id);
}

/** Change one item, whatever its kind. */
export function updateItem<P extends WithItems>(p: P, id: string, fn: (item: AnyItem) => AnyItem): P {
	const kind = itemKind(p, id);
	if (!kind) return p;
	const key = lists[kind];
	return { ...p, [key]: (p[key] as AnyItem[]).map((i) => (i.id === id ? fn(i) : i)) };
}

/** Remove items (by id), whatever their kind. */
export function removeItems<P extends WithItems>(p: P, ids: Set<string>): P {
	return {
		...p,
		overlays: p.overlays.filter((o) => !ids.has(o.id)),
		texts: p.texts.filter((t) => !ids.has(t.id)),
		sounds: p.sounds.filter((s) => !ids.has(s.id))
	};
}

/** Add a track of `kind` at `index` in the list (the order is kept valid). */
export function addTrack<P extends WithItems>(p: P, kind: 'overlay' | 'audio', index: number, id: string, name?: string): P {
	return { ...p, tracks: insertTrack(p.tracks, newTrack(id, kind, name ?? nextTrackName(p.tracks, kind)), index) };
}

/**
 * Make sure item `id` doesn't overlap anything on its track: if it does, it moves to a new track
 * just above that one.
 */
export function settle<P extends WithItems>(p: P, id: string, newId: () => string): P {
	const item = allItems(p).find((i) => i.id === id);
	if (!item) return p;
	if (fits(allItems(p), item.trackId, item, new Set([id]))) return p;
	const track = p.tracks.find((t) => t.id === item.trackId)!;
	const trackId = newId();
	const withTrack = addTrack(p, track.kind === 'audio' ? 'audio' : 'overlay', indexAbove(p.tracks, track.id), trackId);
	return updateItem(withTrack, id, (i) => ({ ...i, trackId }));
}

/**
 * Move items: shift their start by `delta` seconds (kept at 0 or later), and optionally put them on
 * another track. If one would then overlap, it goes on a new track just above (see `settle`).
 */
export function moveItems<P extends WithItems>(
	p: P,
	ids: string[],
	delta: number,
	newId: () => string,
	trackId?: string
): P {
	// The earliest item can't go before 0; the others keep their spacing.
	const moving = allItems(p).filter((i) => ids.includes(i.id));
	const earliest = Math.min(...moving.map((i) => i.start));
	const shift = Math.max(delta, -earliest);
	const target = trackId ? p.tracks.find((t) => t.id === trackId) : undefined;
	let next = p;
	for (const item of moving) {
		const onto = target && accepts(target, item.kind) ? target.id : item.trackId;
		next = updateItem(next, item.id, (i) => ({ ...i, start: item.start + shift, trackId: onto }));
	}
	// Placed one by one against what's already there (those not moving first).
	for (const item of [...moving].sort((a, b) => a.start - b.start)) next = settle(next, item.id, newId);
	return next;
}

// ─── Tracks ────────────────────────────────────────────────────────────────────────────────

export function renameTrack<P extends WithItems>(p: P, trackId: string, name: string): P {
	const clean = name.trim().slice(0, 40);
	return { ...p, tracks: p.tracks.map((t) => (t.id === trackId && t.kind !== 'main' && clean ? { ...t, name: clean } : t)) };
}

export function setTrackFlags<P extends WithItems>(p: P, trackId: string, flags: Partial<Pick<Track, 'hidden' | 'muted' | 'locked'>>): P {
	return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...flags } : t)) };
}

/** Delete a track and everything on it (never the main track). */
export function deleteTrack<P extends WithItems>(p: P, trackId: string): P {
	const track = p.tracks.find((t) => t.id === trackId);
	if (!track || track.kind === 'main') return p;
	const ids = new Set(allItems(p).filter((i) => i.trackId === trackId).map((i) => i.id));
	return { ...removeItems(p, ids), tracks: p.tracks.filter((t) => t.id !== trackId) };
}

/** A copy of a track and its items, just above it. */
export function duplicateTrack<P extends WithItems>(p: P, trackId: string, newId: () => string): P {
	const track = p.tracks.find((t) => t.id === trackId);
	if (!track || track.kind === 'main') return p;
	const copyId = newId();
	const copy: Track = { ...track, id: copyId, name: `${track.name} copy` };
	const tracks = insertTrack(p.tracks, copy, indexAbove(p.tracks, trackId));
	const clone = <T extends { id: string; trackId: string }>(list: T[]) =>
		list.filter((i) => i.trackId === trackId).map((i) => ({ ...structuredClone(i), id: newId(), trackId: copyId }));
	return {
		...p,
		tracks,
		overlays: [...p.overlays, ...clone(p.overlays)],
		texts: [...p.texts, ...clone(p.texts)],
		sounds: [...p.sounds, ...clone(p.sounds)]
	};
}

/**
 * Move a track to position `to` in the list. Overlay tracks stay above the main track and audio
 * tracks below it (a move across is limited to the nearest allowed place).
 */
export function moveTrack<P extends WithItems>(p: P, trackId: string, to: number): P {
	const track = p.tracks.find((t) => t.id === trackId);
	if (!track || track.kind === 'main') return p;
	const rest = p.tracks.filter((t) => t.id !== trackId);
	const main = rest.findIndex((t) => t.kind === 'main');
	const index = track.kind === 'overlay' ? Math.min(to, main) : Math.max(to, main + 1);
	const next = rest.slice();
	next.splice(Math.max(0, Math.min(index, next.length)), 0, track);
	return { ...p, tracks: orderTracks(next) };
}
