import { describe, expect, it } from 'vitest';
import { detectBeats, snapToBeat } from './beats';

/** A click track: short bursts of noise every `period` seconds from `offset`. */
function clicks(bpm: number, offset: number, seconds: number, rate = 22050): Float32Array {
	const out = new Float32Array(Math.round(seconds * rate));
	let seed = 1;
	const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
	for (let t = offset; t < seconds; t += 60 / bpm) {
		const start = Math.round(t * rate);
		for (let i = 0; i < 400 && start + i < out.length; i++) out[start + i] = noise() * Math.exp(-i / 80);
	}
	return out;
}

describe('beats', () => {
	it('finds the tempo and the beats of a click track', () => {
		const { bpm, beats } = detectBeats(clicks(120, 0.25, 10), 22050);
		expect(bpm).toBeGreaterThan(117);
		expect(bpm).toBeLessThan(123);
		// Every beat within a frame or two of a click.
		for (const b of beats) {
			const nearest = Math.round((b - 0.25) / 0.5) * 0.5 + 0.25;
			expect(Math.abs(b - nearest)).toBeLessThan(0.03);
		}
		expect(beats.length).toBeGreaterThan(17);
	});

	it('snaps a time to the nearest beat only when it is close enough', () => {
		const beats = [0.5, 1.05, 1.6];
		expect(snapToBeat(1.0, beats)).toBe(1.05);
		expect(snapToBeat(1.3, beats)).toBe(1.3);
		expect(snapToBeat(0.4, beats, 0.05)).toBe(0.4);
	});
});
