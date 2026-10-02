import type { Project, Scene, SoundItem } from '$lib/model/types';
import { placeScenes, videoLength } from '$lib/model/timeline';
import { placeOverlays, type Overlay } from '$lib/model/overlay';
import type { Track } from '$lib/model/tracks';

import { effectiveFades, soundEnd } from '$lib/model/sound';
import { volumeAt, volumeEnvelope, type VolumePoint } from '$lib/model/volume';
import { sceneKeyframeTimelineTime } from '$lib/model/keyframes';
export { MUSIC_FADE_IN, MUSIC_FADE_OUT, soundEnd } from '$lib/model/sound';

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
	/** Volume points on the timeline (times in timeline seconds), multiplying the rest. */
	envelope?: VolumePoint[];
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
			fadeOut: 0,
			envelope: volumeEnvelope(p.scene.volumePoints, (time) => sceneKeyframeTimelineTime(p, time))
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

/** The fade-out given to a sound that's cut off by the video's end. */
export const END_FADE = 0.5;

/**
 * Music and voiceovers as timeline audio clips: each clip's trimmed part of its file, where it's
 * placed, with its fades at its (trimmed) edges. A clip still playing when the video ends is cut
 * there, with a short fade-out (END_FADE, or its own if longer).
 */

export function soundAudioClips(sounds: SoundItem[], videoEnd: number): AudioClip[] {
	const clips: AudioClip[] = [];
	for (const sound of sounds) {
		const end = soundEnd(sound, videoEnd);
		const length = end - sound.start;
		if (length <= 0.05 || sound.volume <= 0) continue;
		const fades = effectiveFades(sound, length);
		// Cut off by the video's end: a short fade-out there (at least), so it doesn't stop dead.
		if (end < sound.start + sound.duration - 1e-3) fades.fadeOut = Math.min(length, Math.max(fades.fadeOut, END_FADE));
		clips.push({
			id: sound.id,
			mediaId: sound.mediaId,
			start: sound.start,
			end,
			sourceStart: sound.sourceStart,
			speed: 1,
			volume: sound.volume,
			fadeIn: fades.fadeIn,
			fadeOut: fades.fadeOut,
			envelope: volumeEnvelope(sound.volumePoints, (time) => sound.start + time)
		});
	}
	return clips;
}

/** The sound of video layers that have it turned on (off by default). */
export function overlayAudioClips(
	overlays: Overlay[],
	length: number,
	hasAudio: (mediaId: string) => boolean
): AudioClip[] {
	return placeOverlays(overlays)
		.filter(
			(p) =>
				p.overlay.kind === 'video' &&
				p.overlay.sound.on &&
				p.overlay.sound.volume > 0 &&
				p.start < length - 0.05 &&
				hasAudio(p.overlay.mediaId)
		)
		.map((p) => ({
			id: p.overlay.id,
			mediaId: p.overlay.mediaId,
			start: p.start,
			end: Math.min(p.end, length),
			sourceStart: p.overlay.sourceStart,
			speed: 1,
			volume: p.overlay.sound.volume,
			fadeIn: 0,
			fadeOut: 0,
			envelope: volumeEnvelope(p.overlay.volumePoints, (time) => p.start + time)
		}));
}

/**
 * Every piece of sound in the project: each scene's own sound, video overlays with their sound on,
 * music and voiceovers. Muted audio tracks and hidden overlay tracks are left out.
 */
export function projectAudioClips(
	project: Pick<Project, 'scenes' | 'sounds'> & { overlays?: Overlay[]; tracks?: Track[] },
	hasAudio: (mediaId: string) => boolean
): AudioClip[] {
	const tracks = project.tracks ?? [];
	const silent = new Set(tracks.filter((t) => (t.kind === 'audio' ? t.muted : t.hidden)).map((t) => t.id));
	// The video's length counts hidden layers and words too (hiding doesn't change it).
	const length = videoLength(project);
	return [
		...sceneAudioClips(project.scenes, hasAudio),
		...overlayAudioClips((project.overlays ?? []).filter((o) => !silent.has(o.trackId)), length, hasAudio),
		...soundAudioClips(project.sounds.filter((s) => !silent.has(s.trackId)), length)
	];
}

/**
 * Loudness (multiplier) of a clip at timeline time `t`, including its fades, its volume points and
 * the short ramps at its edges. Shared by live playback and the offline mix so they sound the same.
 */
export function clipGainAt(clip: AudioClip, t: number, edgeRamp = 0.01): number {
	if (t < clip.start || t > clip.end) return 0;
	const fadeIn = Math.max(edgeRamp, clip.fadeIn);
	const fadeOut = Math.max(edgeRamp, clip.fadeOut);
	const inF = Math.min(1, (t - clip.start) / fadeIn);
	const outF = Math.min(1, (clip.end - t) / fadeOut);
	return clip.volume * Math.max(0, Math.min(inF, outF)) * volumeAt(clip.envelope, t);
}
