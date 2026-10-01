/**
 * Volume points: the "rubber band" across an audio item (music, voiceovers, and video layers or
 * scenes with sound). They're keyframes of one value, `gain` (a loudness multiplier: 1 = as it
 * is, 0 = silent, up to +6 dB), on the same times as the item's other keyframes. They multiply
 * with the item's own volume and fades. Pure maths, no DOM.
 */

import { EASINGS, interpolate, type EasingPreset, type Keyframe } from './keyframes';

export interface VolumeValues {
	gain: number;
}

export type VolumePoint = Keyframe<VolumeValues>;

/** The easings volume points offer. */
export const VOLUME_EASINGS: EasingPreset[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'];

export const MAX_DB = 6;
export const MIN_DB = -40;
export const MAX_GAIN = Math.pow(10, MAX_DB / 20);

export const gainToDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** How a gain is shown on the line: "+3.0 dB", "−12.5 dB", "−∞ dB". */
export function formatDb(g: number): string {
	const db = gainToDb(g);
	if (!Number.isFinite(db)) return '−∞ dB';
	const r = Math.round(db * 10) / 10;
	return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)} dB`;
}

/**
 * Height on the line (0 = bottom, 1 = top) for a gain: a dB scale from −40 dB to +6 dB, with the
 * very bottom silent.
 */
export function gainToLevel(g: number): number {
	if (g <= dbToGain(MIN_DB) * 1.0001) return g <= 0 ? 0 : 0.002;
	return Math.min(1, (gainToDb(g) - MIN_DB) / (MAX_DB - MIN_DB));
}

/** The gain at a height on the line (the inverse of gainToLevel). */
export function levelToGain(level: number): number {
	const f = Math.min(1, Math.max(0, level));
	if (f < 0.01) return 0;
	return Math.min(MAX_GAIN, dbToGain(MIN_DB + f * (MAX_DB - MIN_DB)));
}

/** The gain at item time `time` (1 with no points; held before the first and after the last). */
export function volumeAt(points: VolumePoint[] | undefined, time: number): number {
	if (!points?.length) return 1;
	return Math.min(MAX_GAIN, Math.max(0, interpolate(points, time, { gain: 1 }).gain));
}

/** A new point at `time` with `gain`. */
export function volumePoint(id: string, time: number, gain: number, preset: EasingPreset = 'linear'): VolumePoint {
	return { id, time, values: { gain }, easing: { ...EASINGS[VOLUME_EASINGS.includes(preset) ? preset : 'linear'] } };
}

/** An item's volume points on the timeline (for the mix): times converted with `toTimeline`. */
export function volumeEnvelope(points: VolumePoint[] | undefined, toTimeline: (time: number) => number): VolumePoint[] | undefined {
	if (!points?.length) return undefined;
	return points.map((p) => ({ ...p, time: toTimeline(p.time) })).sort((a, b) => a.time - b.time);
}
