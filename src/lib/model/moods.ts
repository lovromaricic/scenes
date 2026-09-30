import type { MoodId } from './types';

/**
 * Colour moods as simple grade parameters, applied per pixel by the compositor shader:
 *   c = c * gain;  c = (c - 0.5) * contrast + 0.5;  c = mix(luma(c), c, saturation);
 *   c = lift + c * (1 - lift)
 */
export interface GradeParams {
	gain: [number, number, number];
	contrast: number;
	saturation: number;
	lift: [number, number, number];
}

export const MOOD_GRADES: Record<MoodId, GradeParams> = {
	natural: { gain: [1, 1, 1], contrast: 1, saturation: 1, lift: [0, 0, 0] },
	golden: { gain: [1.08, 1.0, 0.84], contrast: 1.04, saturation: 1.1, lift: [0.03, 0.015, 0] },
	faded: { gain: [1.0, 0.99, 0.95], contrast: 0.82, saturation: 0.72, lift: [0.09, 0.085, 0.08] },
	cool: { gain: [0.9, 0.99, 1.1], contrast: 1.03, saturation: 0.95, lift: [0, 0.015, 0.035] },
	punchy: { gain: [1.02, 1.02, 1.02], contrast: 1.22, saturation: 1.38, lift: [0, 0, 0] },
	mono: { gain: [1, 1, 1], contrast: 1.12, saturation: 0, lift: [0.02, 0.02, 0.02] }
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The same grade on the CPU (0–1 RGB). Used for tests; the shader mirrors this exactly. */
export function applyGrade(
	rgb: [number, number, number],
	g: GradeParams
): [number, number, number] {
	let c = rgb.map((v, i) => v * g.gain[i]);
	c = c.map((v) => (v - 0.5) * g.contrast + 0.5);
	const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
	c = c.map((v) => luma + (v - luma) * g.saturation);
	c = c.map((v, i) => g.lift[i] + v * (1 - g.lift[i]));
	return c.map(clamp01) as [number, number, number];
}
