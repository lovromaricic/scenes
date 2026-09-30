import type { Project, Scene, SoundItem } from '$lib/model/types';
import { placeScenes, totalDuration } from '$lib/model/timeline';
import { placeOverlays, type Overlay } from '$lib/model/overlay';

/** Automatic music fades, in seconds (shortened for short songs). */
export const MUSIC_FADE_IN = 1.5;
export const MUSIC_FADE_OUT = 3;

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

/** When a sound stops: at its own end, or at the end of the video, whichever is first. */
export function soundEnd(sound: SoundItem, videoLength: number): number {
	return Math.min(sound.start + sound.duration, videoLength);
}

/** Music and voiceovers as timeline audio clips. Music fades in and out when `fade` is on. */
export function soundAudioClips(sounds: SoundItem[], videoLength: number): AudioClip[] {
	const clips: AudioClip[] = [];
	for (const sound of sounds) {
		const end = soundEnd(sound, videoLength);
		const length = end - sound.start;
		if (length <= 0.05 || sound.volume <= 0) continue;
		const fade = sound.fade;
		clips.push({
			id: sound.id,
			mediaId: sound.mediaId,
			start: sound.start,
			end,
			sourceStart: sound.sourceStart,
			speed: 1,
			volume: sound.volume,
			fadeIn: fade ? Math.min(MUSIC_FADE_IN, length / 4) : 0,
			fadeOut: fade ? Math.min(MUSIC_FADE_OUT, length / 3) : 0
		});
	}
	return clips;
}

/** The sound of video layers that have it turned on (off by default). */
export function overlayAudioClips(
	overlays: Overlay[],
	scenes: Scene[],
	hasAudio: (mediaId: string) => boolean
): AudioClip[] {
	const length = totalDuration(scenes);
	return placeOverlays(overlays, placeScenes(scenes))
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
			fadeOut: 0
		}));
}

/** Every piece of sound in the project: each scene's own sound, layers, music and voiceovers. */
export function projectAudioClips(
	project: Pick<Project, 'scenes' | 'sounds'> & { overlays?: Overlay[] },
	hasAudio: (mediaId: string) => boolean
): AudioClip[] {
	return [
		...sceneAudioClips(project.scenes, hasAudio),
		...overlayAudioClips(project.overlays ?? [], project.scenes, hasAudio),
		...soundAudioClips(project.sounds, totalDuration(project.scenes))
	];
}

/**
 * Loudness (0–1 multiplier) of a clip at timeline time `t`, including its fades and the short
 * ramps at its edges. Shared by live playback and the offline mix so they sound the same.
 */
export function clipGainAt(clip: AudioClip, t: number, edgeRamp = 0.01): number {
	if (t < clip.start || t > clip.end) return 0;
	const fadeIn = Math.max(edgeRamp, clip.fadeIn);
	const fadeOut = Math.max(edgeRamp, clip.fadeOut);
	const inF = Math.min(1, (t - clip.start) / fadeIn);
	const outF = Math.min(1, (clip.end - t) / fadeOut);
	return clip.volume * Math.max(0, Math.min(inF, outF));
}
