import type { Scene } from './types';

/**
 * Timeline maths. Scenes play back to back, so the video's length is the sum of the scene
 * lengths. Transitions straddle the cut instead of overlapping scenes, which keeps every
 * card, caption and sound aligned to the same simple time scale.
 */

/** How long a scene lasts on the timeline, after speed is applied. */
export function sceneDuration(
	scene: Pick<Scene, 'sourceStart' | 'sourceEnd' | 'speed' | 'kind'>
): number {
	const sourceLength = Math.max(0, scene.sourceEnd - scene.sourceStart);
	return scene.kind !== 'video' ? sourceLength : sourceLength / scene.speed;
}

export interface PlacedScene {
	scene: Scene;
	index: number;
	start: number;
	end: number;
	duration: number;
}

/** Each scene with its start and end time on the timeline. */
export function placeScenes(scenes: Scene[]): PlacedScene[] {
	let t = 0;
	return scenes.map((scene, index) => {
		const duration = sceneDuration(scene);
		const placed = { scene, index, start: t, end: t + duration, duration };
		t += duration;
		return placed;
	});
}

/** How long the Scenes track is (the scenes back to back). See `videoLength` for the video's length. */
export function totalDuration(scenes: Scene[]): number {
	return scenes.reduce((sum, s) => sum + sceneDuration(s), 0);
}

/**
 * The video's length, everywhere (the clock, the top bar, the ruler, the range, looping, playback,
 * Fit, saving): where the last thing ends on the Scenes track or on any picture or words track,
 * hidden tracks included (hiding a track doesn't change the length). Sounds don't make the video
 * longer: a sound past the end is cut off there, with a short fade.
 */
export function videoLength(project: {
	scenes: Scene[];
	overlays?: { start: number; duration: number }[];
	texts?: { start: number; duration: number }[];
}): number {
	let end = totalDuration(project.scenes);
	for (const o of project.overlays ?? []) end = Math.max(end, o.start + o.duration);
	for (const t of project.texts ?? []) end = Math.max(end, t.start + t.duration);
	return end;
}

/**
 * The scene showing at `time`. A time exactly on a cut belongs to the next scene;
 * the very end of the video belongs to the last scene.
 */
export function sceneAtTime(scenes: Scene[], time: number): PlacedScene | null {
	const placed = placeScenes(scenes);
	if (placed.length === 0) return null;
	for (const p of placed) {
		if (time < p.end) return p;
	}
	return placed[placed.length - 1];
}
