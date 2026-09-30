import type { Project } from '$lib/model/types';

/**
 * Static demo project used to lay out the editor before real media exists (Phase 1).
 * Thumbnails are drawn with mood gradients.
 */
export const placeholderProject: Project = {
	id: 'demo',
	title: 'Summer in Split',
	aspect: '16:9',
	mood: 'natural',
	createdAt: 0,
	updatedAt: 0,
	scenes: [
		{
			id: 's1',
			mediaId: 'beach',
			kind: 'video',
			name: 'Beach',
			sourceStart: 0,
			sourceEnd: 12,
			speed: 1,
			volume: 1,
			mood: 'cool',
			transition: { kind: 'crossfade', duration: 0.8 }
		},
		{
			id: 's2',
			mediaId: 'market',
			kind: 'video',
			name: 'Market',
			sourceStart: 0,
			sourceEnd: 9,
			speed: 1,
			volume: 1,
			mood: 'golden',
			transition: { kind: 'cut', duration: 0 }
		},
		{
			id: 's3',
			mediaId: 'sunset',
			kind: 'video',
			name: 'Sunset',
			sourceStart: 0,
			sourceEnd: 10,
			speed: 1,
			volume: 1,
			mood: 'punchy',
			transition: { kind: 'cut', duration: 0 }
		}
	],
	texts: [
		{
			id: 't1',
			text: 'Summer in Split',
			start: 0.5,
			duration: 4,
			x: 0.5,
			y: 0.5,
			style: 'title',
			animation: 'fade'
		},
		{
			id: 't2',
			text: 'The old market',
			start: 13,
			duration: 5,
			x: 0.5,
			y: 0.85,
			style: 'boxed',
			animation: 'slide-up'
		},
		{
			id: 't3',
			text: 'Golden hour',
			start: 23,
			duration: 4.5,
			x: 0.5,
			y: 0.85,
			style: 'serif',
			animation: 'pop'
		}
	],
	sounds: [
		{
			id: 'm1',
			mediaId: 'music',
			name: 'Easy afternoon',
			start: 0,
			sourceStart: 0,
			duration: 31,
			volume: 0.6,
			kind: 'music',
			fade: true
		}
	]
};

/** Deterministic pseudo-waveform for the placeholder sound lane. */
export function placeholderPeaks(count: number, seed = 7): number[] {
	let x = seed;
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		x = (x * 9301 + 49297) % 233280;
		const noise = x / 233280;
		const envelope = 0.55 + 0.35 * Math.sin(i / 9) * Math.sin(i / 23);
		out.push(Math.min(1, Math.max(0.08, envelope * (0.55 + noise * 0.6))));
	}
	return out;
}
