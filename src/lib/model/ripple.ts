/**
 * What happens to items on the other tracks when the scenes change (trimmed, deleted, added,
 * moved, sped up). Pure functions, no DOM.
 *
 * - Ripple off (the default): items keep their times.
 * - Ripple on: items move with the part of the video they were over. An item over a scene that
 *   moved goes along with it; one over a part that was cut keeps its distance to the next scene
 *   (not going back past the cut). So items after a change shift by the same amount and stay
 *   lined up with the later scenes.
 * - Either way, an item that ended exactly at the video's end still ends there: it stretches or
 *   shrinks with the video (within what it can show, e.g. a video's own length).
 *
 * Only items the edit itself didn't place or change are adjusted.
 */

import { placeScenes, totalDuration, type PlacedScene } from './timeline';
import type { Project, Scene } from './types';

/** Shortest an item may become when it follows the video's end. */
export const MIN_ANCHORED = 0.3;
const EPS = 1e-3;

type Timed = { id: string; start: number; duration: number; trackId: string };
type WithTimeline = Pick<Project, 'scenes' | 'overlays' | 'texts' | 'sounds'>;

/** How fast a scene plays its source (seconds of source per second of video). */
const rate = (s: Scene) => (s.kind === 'video' ? s.speed : 1);

/** Whether the scenes play the same thing at the same times (nothing for ripple to do). */
function sameTimeline(a: PlacedScene[], b: PlacedScene[]): boolean {
	return (
		a.length === b.length &&
		a.every((p, i) => {
			const q = b[i];
			return (
				p.scene.id === q.scene.id &&
				Math.abs(p.start - q.start) < EPS &&
				Math.abs(p.end - q.end) < EPS &&
				Math.abs(p.scene.sourceStart - q.scene.sourceStart) < EPS &&
				rate(p.scene) === rate(q.scene)
			);
		})
	);
}

/**
 * Where time `t` of the old video is in the new one: the same moment of the same clip if it's
 * still there, otherwise the same distance before the next scene that's still there.
 */
export function mapTime(t: number, before: PlacedScene[], after: PlacedScene[]): number {
	const oldLength = before.at(-1)?.end ?? 0;
	const newLength = after.at(-1)?.end ?? 0;
	if (!before.length) return t;
	if (t >= oldLength) return Math.max(0, t + newLength - oldLength);
	const i = before.findIndex((p) => t >= p.start - EPS && t < p.end);
	const p = before[i];
	const oldIds = new Set(before.map((b) => b.scene.id));

	// The same moment of the same clip: the scene itself, or a piece split off it.
	const source = p.scene.sourceStart + (t - p.start) * rate(p.scene);
	const same = after.find(
		(q) =>
			(q.scene.id === p.scene.id || (!oldIds.has(q.scene.id) && !!p.scene.mediaId && q.scene.mediaId === p.scene.mediaId)) &&
			source >= q.scene.sourceStart - EPS &&
			source < q.scene.sourceEnd - EPS
	);
	if (same) return same.start + (source - same.scene.sourceStart) / rate(same.scene);

	// That part was cut: keep the distance to the next scene still there, but not before the cut.
	const newStartOf = new Map(after.map((q) => [q.scene.id, q]));
	const cut = (() => {
		for (let k = i - 1; k >= 0; k--) {
			const q = newStartOf.get(before[k].scene.id);
			if (q) return q.end;
		}
		return 0;
	})();
	for (let k = i + 1; k < before.length; k++) {
		const q = newStartOf.get(before[k].scene.id);
		if (q) return Math.max(cut, q.start - (before[k].start - t));
	}
	return Math.max(cut, t + newLength - oldLength);
}

/**
 * Adjust the items after an edit changed the scenes (see the top of this file). `maxDuration`
 * says how long an item may become (e.g. a video overlay can't outlast its clip).
 */
export function reconcileTimeline<P extends WithTimeline>(
	before: WithTimeline,
	after: P,
	ripple: boolean,
	maxDuration: (item: Timed, list: 'overlays' | 'texts' | 'sounds') => number = () => Infinity
): P {
	const oldPlaced = placeScenes(before.scenes);
	const newPlaced = placeScenes(after.scenes);
	if (sameTimeline(oldPlaced, newPlaced)) return after;
	const oldLength = totalDuration(before.scenes);
	const newLength = totalDuration(after.scenes);

	const adjust = <T extends Timed>(list: T[], previous: Timed[], key: 'overlays' | 'texts' | 'sounds'): T[] =>
		list.map((item) => {
			const was = previous.find((x) => x.id === item.id);
			// New, or placed by this very edit: leave it where it was put.
			if (
				!was ||
				Math.abs(was.start - item.start) > EPS ||
				Math.abs(was.duration - item.duration) > EPS ||
				was.trackId !== item.trackId
			)
				return item;
			const start = ripple ? mapTime(item.start, oldPlaced, newPlaced) : item.start;
			const endedWithVideo = oldLength > 0 && Math.abs(item.start + item.duration - oldLength) < EPS;
			let duration = item.duration;
			if (endedWithVideo && newLength > 0) {
				duration = Math.min(Math.max(MIN_ANCHORED, newLength - start), maxDuration(item, key));
			}
			if (Math.abs(start - item.start) < EPS && Math.abs(duration - item.duration) < EPS) return item;
			return { ...item, start, duration };
		});

	return {
		...after,
		overlays: adjust(after.overlays, before.overlays, 'overlays'),
		texts: adjust(after.texts, before.texts, 'texts'),
		sounds: adjust(after.sounds, before.sounds, 'sounds')
	};
}
