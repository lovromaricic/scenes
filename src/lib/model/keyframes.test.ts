import { describe, expect, it } from 'vitest';
import {
	EASINGS,
	cubicBezier,
	ease,
	easingPreset,
	interpolate,
	itemValuesAt,
	keyframeAt,
	maxItemScale,
	neighbourKeyframe,
	overlayBaseValues,
	sceneContentTime,
	sceneFrameAt,
	sceneKeyframeTimelineTime,
	shiftKeyframes,
	textBaseValues,
	upsertKeyframe,
	type ItemValues,
	type Keyframe
} from './keyframes';

const v = (x: number, extra: Partial<ItemValues> = {}): ItemValues => ({
	x,
	y: 0.5,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
	opacity: 1,
	...extra
});
const kf = (time: number, values: ItemValues, easing = EASINGS.linear): Keyframe<ItemValues> => ({
	id: `k${time}`,
	time,
	values,
	easing
});

describe('easing', () => {
	it('presets are cubic-bezier curves that start at 0 and end at 1', () => {
		for (const name of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
			expect(ease(EASINGS[name], 0)).toBeCloseTo(0);
			expect(ease(EASINGS[name], 1)).toBeCloseTo(1);
		}
		expect(ease(EASINGS.linear, 0.3)).toBeCloseTo(0.3, 4);
		// Ease in starts slowly, ease out quickly; ease in and out is symmetric.
		expect(ease(EASINGS['ease-in'], 0.25)).toBeLessThan(0.25);
		expect(ease(EASINGS['ease-out'], 0.25)).toBeGreaterThan(0.25);
		expect(ease(EASINGS['ease-in-out'], 0.5)).toBeCloseTo(0.5, 3);
		// Like CSS: cubic-bezier(0.25, 0.1, 0.25, 1) ("ease") at x = 0.5 is about 0.8024.
		expect(cubicBezier(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(0.8024, 3);
	});

	it('hold keeps the first value until the next keyframe', () => {
		expect(ease(EASINGS.hold, 0.999)).toBe(0);
		expect(ease(EASINGS.hold, 1)).toBe(1);
	});

	it('overshoot passes the target and settles; bounce never passes it', () => {
		const samples = Array.from({ length: 101 }, (_, i) => i / 100);
		expect(Math.max(...samples.map((p) => ease(EASINGS.overshoot, p)))).toBeGreaterThan(1.05);
		expect(ease(EASINGS.overshoot, 1)).toBeCloseTo(1);
		const b = samples.map((p) => ease(EASINGS.bounce, p));
		expect(Math.max(...b)).toBeLessThanOrEqual(1 + 1e-9);
		expect(b.at(-1)).toBeCloseTo(1);
		// It comes back down at least once (a bounce).
		expect(b.some((x, i) => i > 0 && x < b[i - 1] - 0.01)).toBe(true);
	});

	it('names a curve after its preset, or "custom"', () => {
		expect(easingPreset(EASINGS['ease-out'])).toBe('ease-out');
		expect(easingPreset({ kind: 'bezier', x1: 0.3, y1: 0.1, x2: 0.2, y2: 0.9 })).toBe('custom');
		expect(easingPreset(EASINGS.bounce)).toBe('bounce');
	});
});

describe('keyframes', () => {
	const list = [kf(1, v(0.2)), kf(3, v(0.8))];

	it('hold the first and last keyframe outside them, and move between them', () => {
		expect(interpolate(list, 0, v(0)).x).toBeCloseTo(0.2);
		expect(interpolate(list, 2, v(0)).x).toBeCloseTo(0.5);
		expect(interpolate(list, 9, v(0)).x).toBeCloseTo(0.8);
		// No keyframes: the item's own values.
		expect(interpolate([], 2, v(0.4)).x).toBe(0.4);
	});

	it('use the easing of the first keyframe of each stretch', () => {
		const eased = [kf(0, v(0), EASINGS['ease-in']), kf(1, v(1), EASINGS.linear), kf(2, v(0))];
		expect(interpolate(eased, 0.25, v(0)).x).toBeLessThan(0.2);
		expect(interpolate(eased, 1.5, v(0)).x).toBeCloseTo(0.5);
	});

	it('never push opacity outside 0–100% (overshoot, bounce) or the scale to 0', () => {
		const fade = [kf(0, v(0.5, { opacity: 0, scaleX: 0.02 }), EASINGS.overshoot), kf(1, v(0.5, { opacity: 1, scaleX: 1 }))];
		for (let t = 0; t <= 1; t += 0.05) {
			const at = itemValuesAt(v(0), fade, t);
			expect(at.opacity).toBeGreaterThanOrEqual(0);
			expect(at.opacity).toBeLessThanOrEqual(1);
			expect(at.scaleX).toBeGreaterThan(0);
		}
		// The scale may overshoot (that's the point), the opacity may not.
		expect(itemValuesAt(v(0), fade, 0.8).scaleX).toBeGreaterThan(1);
	});

	it('add or update a keyframe at a time; find neighbours; shift', () => {
		let k = upsertKeyframe(list, 2, v(0.6), () => 'new', EASINGS.linear);
		expect(k.map((x) => x.time)).toEqual([1, 2, 3]);
		k = upsertKeyframe(k, 2.001, v(0.65), () => 'other', EASINGS.linear);
		expect(k).toHaveLength(3);
		expect(keyframeAt(k, 2)!.values.x).toBe(0.65);
		expect(neighbourKeyframe(k, 2, 1)!.time).toBe(3);
		expect(neighbourKeyframe(k, 2, -1)!.time).toBe(1);
		expect(neighbourKeyframe(k, 3, 1)).toBeUndefined();
		expect(shiftKeyframes(k, -0.5)!.map((x) => x.time)).toEqual([0.5, 1.5, 2.5]);
	});

	it('base values come from the item (an overlay’s box centre, words’ position)', () => {
		const base = overlayBaseValues({ box: { x: 0.1, y: 0.2, w: 0.4, h: 0.2 }, style: { opacity: 0.7 }, rotation: 30 });
		expect(base).toEqual({ x: 0.30000000000000004, y: 0.30000000000000004, scaleX: 1, scaleY: 1, rotation: 30, opacity: 0.7 });
		expect(textBaseValues({ x: 0.5, y: 0.8 })).toMatchObject({ x: 0.5, y: 0.8, opacity: 1 });
		expect(maxItemScale(v(0), [kf(0, v(0, { scaleX: 2.5 }))])).toBe(2.5);
	});
});

describe('scene keyframes follow the clip', () => {
	const frame = { mode: 'custom' as const, bars: 'black' as const, zoom: 1, x: 0, y: 0 };
	const keyframes = [
		{ id: 'a', time: 4, values: { x: 0, y: 0, zoom: 1 }, easing: EASINGS.linear },
		{ id: 'b', time: 6, values: { x: 0.1, y: 0, zoom: 2 }, easing: EASINGS.linear }
	];

	it('animate Custom framing at the clip’s own time; other modes ignore them', () => {
		expect(sceneFrameAt(frame, keyframes, 5)!.zoom).toBeCloseTo(1.5);
		expect(sceneFrameAt({ ...frame, mode: 'fill' }, keyframes, 5)!.zoom).toBe(1);
	});

	it('changing the speed keeps keyframes on the same moments of the video', () => {
		// Source 2–10 s: at 1× the 6 s keyframe is 4 s in; at 2×, 2 s in.
		const at1 = { start: 10, scene: { kind: 'video', sourceStart: 2, speed: 1 } };
		const at2 = { start: 10, scene: { kind: 'video', sourceStart: 2, speed: 2 } };
		expect(sceneKeyframeTimelineTime(at1, 6)).toBe(14);
		expect(sceneKeyframeTimelineTime(at2, 6)).toBe(12);
		expect(sceneContentTime(at2, 12)).toBe(6);
		// Photos and cards: seconds into the scene.
		expect(sceneContentTime({ start: 10, scene: { kind: 'photo', sourceStart: 0, speed: 1 } }, 11.5)).toBe(1.5);
	});
});
