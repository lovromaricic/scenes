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
	// With volume points, follow the whole curve (fades and points multiplied) closely.
	if (clip.envelope?.length) {
		scheduleSampled(param, clip, from, ctxTime);
		return;
	}
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

/** How often a volume curve is sampled for the audio clock (seconds). */
const STEP = 0.02;

/**
 * Schedule a clip's loudness as short straight ramps through samples of `clipGainAt`, plus its
 * exact corners (point times, fade ends, a Hold's jump), so any easing is followed closely.
 */
function scheduleSampled(param: AudioParam, clip: AudioClip, from: number, ctxTime: (t: number) => number) {
	const times = new Set<number>();
	for (let t = from; t < clip.end; t += STEP) times.add(t);
	times.add(clip.end);
	const corner = (t: number) => {
		if (t > from && t < clip.end) times.add(t);
	};
	corner(clip.start + Math.max(EDGE_RAMP, clip.fadeIn));
	corner(clip.end - Math.max(EDGE_RAMP, clip.fadeOut));
	for (const p of clip.envelope ?? []) {
		corner(p.time);
		// A Hold jumps at the next point: hold the value until just before it.
		corner(p.time - 1e-3);
	}
	const sorted = [...times].sort((a, b) => a - b);
	param.setValueAtTime(clipGainAt(clip, from, EDGE_RAMP), ctxTime(from));
	for (const t of sorted.slice(1)) param.linearRampToValueAtTime(clipGainAt(clip, t, EDGE_RAMP), ctxTime(t));
}
