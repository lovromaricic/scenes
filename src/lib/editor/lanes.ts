import type { ItemKind } from '$lib/model/tracks';

/**
 * Where a dragged item would land on the storyboard:
 * - `track`: onto this track (same kind of track as the item);
 * - `gap`: into the gap before list position `index` (a new track is made there);
 * - `main`: onto the Scenes track, before scene `index` (pictures become scenes).
 */
export type DropTarget =
	| { kind: 'track'; id: string }
	| { kind: 'gap'; index: number }
	| { kind: 'main'; index: number };

/** What the storyboard provides to its track lanes. */
export interface LaneServices {
	/** The drop target under a pointer's y for an item of `kind` (null: stay where it is). */
	targetAt(clientY: number, kind: ItemKind, clientX?: number): DropTarget | null;
	/** Show (or clear) where a drag would land. */
	showTarget(target: DropTarget | null, fromTrack: string): void;
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
