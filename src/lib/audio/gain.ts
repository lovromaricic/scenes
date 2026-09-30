import { clipGainAt, type AudioClip } from './clips';

export const EDGE_RAMP = 0.01;

/**
 * Schedule a clip's loudness on an AudioParam from timeline time `from` onwards: its volume with
 * fades and short click-free ramps at the edges. `ctxTime` maps timeline time to the audio
 * context's clock. Used by both live playback and the offline mix, so they sound the same.
 */
export function scheduleClipGain(
	param: AudioParam,
	clip: AudioClip,
	from: number,
	ctxTime: (t: number) => number
): void {
	const fadeIn = Math.max(EDGE_RAMP, clip.fadeIn);
	const fadeOut = Math.max(EDGE_RAMP, clip.fadeOut);
	const fadeInEnd = clip.start + fadeIn;
	const fadeOutStart = Math.max(fadeInEnd, clip.end - fadeOut);
	param.setValueAtTime(clipGainAt(clip, from, EDGE_RAMP), ctxTime(from));
	if (fadeInEnd > from)
		param.linearRampToValueAtTime(clipGainAt(clip, fadeInEnd, EDGE_RAMP), ctxTime(fadeInEnd));
	if (fadeOutStart > from)
		param.setValueAtTime(clipGainAt(clip, fadeOutStart, EDGE_RAMP), ctxTime(fadeOutStart));
	param.linearRampToValueAtTime(0, ctxTime(clip.end));
}
