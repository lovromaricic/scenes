import type { ItemKind } from '$lib/model/tracks';

/**
 * Where a dragged item would land on the storyboard:
 * - `track`: onto this track (same kind of track as the item);
 * - `gap`: into the gap before list position `index` (a new track is made there);
 * - `main`: onto the Scenes track, before scene `index` (pictures become scenes);
 * - `blocked`: over a track it can't go on (`trackId`, or 'main' for the Scenes track), with the
 *   friendly reason shown next to the pointer. Releasing there puts it back where it was.
 */
export type DropTarget =
	| { kind: 'track'; id: string }
	| { kind: 'gap'; index: number }
	| { kind: 'main'; index: number }
	| { kind: 'blocked'; trackId: string; reason: string };

/** What can be dragged onto tracks: their items, and scene cards. */
export type DragKind = ItemKind | 'scene';

/** Why something can't go on a track (the hint shown next to the pointer), in plain words. */
export const BLOCKED = {
	locked: 'This track is locked. Unlock it to put things on it.',
	soundOnVisual: 'Sounds go on the audio tracks below the scenes.',
	visualOnAudio: 'Pictures and words go on the tracks above the scenes.',
	wordsAsScene: 'Words can’t be a scene. Put them on a track above the scenes.',
	onlyScene: 'Your video needs at least one scene, so this stays a scene.',
	soundFile: 'To add a sound, use Sound in the Add panel.'
} as const;

/** What the storyboard provides to its track lanes. */
export interface LaneServices {
	/** The drop target under a pointer's y for an item of `kind` (null: stay where it is). */
	targetAt(clientY: number, kind: ItemKind, clientX?: number): DropTarget | null;
	/**
	 * Show (or clear) where a drag would land. `at` is the pointer (client pixels), for the hint
	 * next to it when the target is blocked.
	 */
	showTarget(target: DropTarget | null, fromTrack: string, at?: { x: number; y: number }): void;
	/** Times to snap to: the playhead, scene boundaries, the video's start and end, and every
	 * item edge (except the items being dragged). */
	snapTargets(except: string[]): number[];
	/** Show the snap line at content x (or hide it). */
	setSnap(x: number | null): void;
	/**
	 * While dragging: scroll the tracks up or down when the pointer is near the top or bottom edge
	 * (null: stop). `onscroll` runs after each scroll step, to update the drag for the new view.
	 */
	autoScroll(clientY: number | null, onscroll?: () => void): void;
	/** How far the tracks are scrolled down now (px). */
	scrollTop(): number;
}
