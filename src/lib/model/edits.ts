import { placeScenes, sceneDuration } from './timeline';
import type { Scene, Speed } from './types';

/**
 * Pure scene-editing operations. Each takes plain data and returns new data (never mutates),
 * so they're easy to test and to record in the undo history.
 */

/** Shortest a scene can be, in timeline seconds. */
export const MIN_SCENE = 0.5;
/** Longest a photo scene can be. */
export const MAX_PHOTO = 60;

/** The usable part of a scene's source file (for photos: any length up to MAX_PHOTO). */
export interface SourceBounds {
	start: number;
	end: number;
}

export function moveScene(scenes: Scene[], from: number, to: number): Scene[] {
	if (from === to || from < 0 || from >= scenes.length) return scenes;
	const next = scenes.slice();
	const [moved] = next.splice(from, 1);
	next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
	return next;
}

export function removeScene(scenes: Scene[], id: string): Scene[] {
	return scenes.filter((s) => s.id !== id);
}

/** Longest this scene could be at its current speed. */
export function maxLength(scene: Scene, bounds: SourceBounds): number {
	if (scene.kind === 'photo') return MAX_PHOTO;
	return (bounds.end - bounds.start) / scene.speed;
}

/**
 * Set a scene's length (timeline seconds). Videos grow or shrink at the end; if the clip runs out
 * at the end, the extra is taken from the beginning instead.
 */
export function setLength(scene: Scene, length: number, bounds: SourceBounds): Scene {
	const len = clamp(
		length,
		Math.min(MIN_SCENE, maxLength(scene, bounds)),
		maxLength(scene, bounds)
	);
	if (scene.kind === 'photo') return { ...scene, sourceStart: 0, sourceEnd: len };
	const span = len * scene.speed;
	let start = scene.sourceStart;
	let end = start + span;
	if (end > bounds.end) {
		end = bounds.end;
		start = Math.max(bounds.start, end - span);
	}
	return { ...scene, sourceStart: start, sourceEnd: end };
}

/**
 * Move one edge of a scene by `delta` timeline seconds (positive = later).
 * Trimming the start changes which part of the clip plays first; the end changes where it stops.
 */
export function trimEdge(
	scene: Scene,
	edge: 'start' | 'end',
	delta: number,
	bounds: SourceBounds
): Scene {
	if (scene.kind === 'photo') {
		const length = sceneDuration(scene) + (edge === 'end' ? delta : -delta);
		return setLength(scene, length, bounds);
	}
	const minSpan = MIN_SCENE * scene.speed;
	const d = delta * scene.speed;
	if (edge === 'start') {
		const start = clamp(scene.sourceStart + d, bounds.start, scene.sourceEnd - minSpan);
		return { ...scene, sourceStart: start };
	}
	const end = clamp(scene.sourceEnd + d, scene.sourceStart + minSpan, bounds.end);
	return { ...scene, sourceEnd: end };
}

/**
 * Change speed, keeping the same part of the clip (so the scene gets longer or shorter).
 */
export function setSpeed(scene: Scene, speed: Speed): Scene {
	if (scene.kind === 'photo') return scene;
	const minSpan = MIN_SCENE * speed;
	const sourceEnd = Math.max(scene.sourceEnd, scene.sourceStart + minSpan);
	return { ...scene, speed, sourceEnd };
}

export interface SplitResult {
	scenes: Scene[];
	/** Id of the new second half. */
	secondId: string;
}

/**
 * Split the scene under timeline time `t` into two scenes. Returns null when `t` isn't at least
 * MIN_SCENE/2 inside a scene (nothing sensible to split).
 */
export function splitAt(scenes: Scene[], t: number, newId: () => string): SplitResult | null {
	const placed = placeScenes(scenes);
	const hit = placed.find((p) => t > p.start && t < p.end);
	if (!hit) return null;
	const minPiece = MIN_SCENE / 2;
	if (t - hit.start < minPiece || hit.end - t < minPiece) return null;
	const { scene } = hit;
	const local = t - hit.start;
	let first: Scene;
	let second: Scene;
	if (scene.kind === 'photo') {
		first = {
			...scene,
			sourceStart: 0,
			sourceEnd: local,
			transition: { kind: 'cut', duration: 0 }
		};
		second = { ...scene, id: newId(), sourceStart: 0, sourceEnd: hit.duration - local };
	} else {
		const cut = scene.sourceStart + local * scene.speed;
		first = { ...scene, sourceEnd: cut, transition: { kind: 'cut', duration: 0 } };
		second = { ...scene, id: newId(), sourceStart: cut };
	}
	const next = scenes.slice();
	next.splice(hit.index, 1, first, second);
	return { scenes: next, secondId: second.id };
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}
