import type { Scene } from '$lib/model/types';
import { placeScenes } from '$lib/model/timeline';

/** A piece of sound placed on the timeline: which part of which file, when, and how loud. */
export interface AudioClip {
	id: string;
	mediaId: string;
	/** Timeline seconds. */
	start: number;
	end: number;
	/** Source seconds at `start`. */
	sourceStart: number;
	speed: number;
	volume: number;
	/** Fade in/out lengths in seconds (0 = just a click-free 10ms ramp). */
	fadeIn: number;
	fadeOut: number;
}

/** The clip sound of every video scene, as timeline audio clips. */
export function sceneAudioClips(
	scenes: Scene[],
	hasAudio: (mediaId: string) => boolean
): AudioClip[] {
	return placeScenes(scenes)
		.filter((p) => p.scene.kind === 'video' && p.scene.volume > 0 && hasAudio(p.scene.mediaId))
		.map((p) => ({
			id: p.scene.id,
			mediaId: p.scene.mediaId,
			start: p.start,
			end: p.end,
			sourceStart: p.scene.sourceStart,
			speed: p.scene.speed,
			volume: p.scene.volume,
			fadeIn: 0,
			fadeOut: 0
		}));
}

/**
 * Where to start playing a buffer so the clip lines up with the timeline.
 * Given the buffer's source timestamp, returns the timeline time it would start at, and the
 * offset into the buffer (in buffer seconds) if the playhead is already past that point.
 */
export function bufferPlacement(
	clip: AudioClip,
	bufferTimestamp: number,
	playFrom: number
): { timelineStart: number; offset: number } {
	const natural = clip.start + (bufferTimestamp - clip.sourceStart) / clip.speed;
	const from = Math.max(playFrom, clip.start);
	if (natural >= from) return { timelineStart: natural, offset: 0 };
	return { timelineStart: from, offset: (from - natural) * clip.speed };
}
