/**
 * Keyframe animation. Pure data and maths, no DOM.
 *
 * - One keyframe stores every animatable value of its item at one moment:
 *   - overlays and words: position (centre), scale, rotation and opacity (`ItemValues`);
 *   - scenes with Custom framing: the framing's position and zoom (`FrameValues`).
 * - Times: on overlays and words, seconds from the item's start (so keyframes move with it); on
 *   scenes, the clip's own time (source seconds; for photos and cards, seconds into the scene),
 *   so they stay on the same moments of the video when the speed changes or the scene is trimmed.
 * - Between two keyframes the values follow the easing stored on the first of them. Before the
 *   first and after the last keyframe, the item holds that keyframe's values.
 * - `itemValuesAt` / `sceneFrameAt` are the one way to get an item's values at a time: the
 *   preview, Watch, thumbnails and export all use them.
 */

import type { SceneFrame } from './framing';

// ─── Easing ──────────────────────────────────────────────────────────────────────────────

export type Easing =
	| { kind: 'bezier'; x1: number; y1: number; x2: number; y2: number }
	| { kind: 'hold' }
	| { kind: 'overshoot' }
	| { kind: 'bounce' };

export type EasingPreset = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | 'overshoot' | 'bounce';

const bezier = (x1: number, y1: number, x2: number, y2: number): Easing => ({ kind: 'bezier', x1, y1, x2, y2 });

export const EASINGS: Record<EasingPreset, Easing> = {
	linear: bezier(0, 0, 1, 1),
	'ease-in': bezier(0.42, 0, 1, 1),
	'ease-out': bezier(0, 0, 0.58, 1),
	'ease-in-out': bezier(0.42, 0, 0.58, 1),
	hold: { kind: 'hold' },
	overshoot: { kind: 'overshoot' },
	bounce: { kind: 'bounce' }
};

export const EASING_LABELS: Record<EasingPreset, string> = {
	linear: 'Linear',
	'ease-in': 'Ease in',
	'ease-out': 'Ease out',
	'ease-in-out': 'Ease in and out',
	hold: 'Hold',
	overshoot: 'Overshoot',
	bounce: 'Bounce'
};

export const DEFAULT_EASING: EasingPreset = 'ease-in-out';

/** The preset an easing is, or 'custom' for a curve that matches none of them. */
export function easingPreset(e: Easing): EasingPreset | 'custom' {
	if (e.kind !== 'bezier') return e.kind;
	for (const name of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
		const p = EASINGS[name] as Extract<Easing, { kind: 'bezier' }>;
		if ([p.x1 - e.x1, p.y1 - e.y1, p.x2 - e.x2, p.y2 - e.y2].every((d) => Math.abs(d) < 0.005)) return name;
	}
	return 'custom';
}

/** A cubic-bezier timing curve (like CSS): progress `p` (0–1 in time) to 0–1 in value. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, p: number): number {
	if (p <= 0) return 0;
	if (p >= 1) return 1;
	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;
	const x = (s: number) => ((ax * s + bx) * s + cx) * s;
	const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
	// Newton's method, then bisection if it doesn't settle.
	let s = p;
	for (let i = 0; i < 8; i++) {
		const err = x(s) - p;
		if (Math.abs(err) < 1e-6) return ((ay * s + by) * s + cy) * s;
		const d = dx(s);
		if (Math.abs(d) < 1e-6) break;
		s -= err / d;
	}
	let lo = 0;
	let hi = 1;
	s = p;
	for (let i = 0; i < 40; i++) {
		const v = x(s);
		if (Math.abs(v - p) < 1e-7) break;
		if (v < p) lo = s;
		else hi = s;
		s = (lo + hi) / 2;
	}
	return ((ay * s + by) * s + cy) * s;
}

/** Overshoot: eases out past the target by about 10% and settles back. */
function overshoot(p: number): number {
	const c = 1.70158;
	const q = p - 1;
	return 1 + (c + 1) * q * q * q + c * q * q;
}

/** Bounce: arrives and bounces back up a few times, smaller each time (never past the target). */
function bounce(p: number): number {
	const n = 7.5625;
	const d = 2.75;
	if (p < 1 / d) return n * p * p;
	if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
	if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
	return n * (p -= 2.625 / d) * p + 0.984375;
}

/** How far between two keyframes' values (0 = the first, 1 = the next; may pass 1 briefly). */
export function ease(e: Easing, p: number): number {
	const q = Math.min(1, Math.max(0, p));
	switch (e.kind) {
		case 'hold':
			return q < 1 ? 0 : 1;
		case 'overshoot':
			return overshoot(q);
		case 'bounce':
			return bounce(q);
		default:
			return cubicBezier(e.x1, e.y1, e.x2, e.y2, q);
	}
}

// ─── Keyframes ───────────────────────────────────────────────────────────────────────────

export interface Keyframe<V> {
	id: string;
	/** Seconds from the item's start (overlays, words) or source seconds (scenes). */
	time: number;
	values: V;
	/** How the values move from this keyframe to the next one. */
	easing: Easing;
}

/** What animates on overlays and words. */
export interface ItemValues {
	/** Centre, as a fraction of the frame. */
	x: number;
	y: number;
	/** 1 = the base size. */
	scaleX: number;
	scaleY: number;
	/** Degrees, clockwise. */
	rotation: number;
	/** 0–1. */
	opacity: number;
}

/** What animates on a scene with Custom framing (see SceneFrame). */
export interface FrameValues {
	x: number;
	y: number;
	zoom: number;
}

export const ITEM_KEYS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const;
export const FRAME_KEYS = ['x', 'y', 'zoom'] as const;

/** Keyframes closer together than this are the same moment. */
export const SAME_TIME = 1 / 120;

export function sortKeyframes<V>(list: Keyframe<V>[]): Keyframe<V>[] {
	return [...list].sort((a, b) => a.time - b.time);
}

/**
 * The values at `time`: holding the first or last keyframe outside them, eased in between.
 * `base` is used when there are no keyframes.
 */
export function interpolate<V extends object>(list: Keyframe<V>[] | undefined, time: number, base: V): V {
	if (!list?.length) return base;
	const kfs = list.length > 1 && list.some((k, i) => i > 0 && k.time < list[i - 1].time) ? sortKeyframes(list) : list;
	if (time <= kfs[0].time) return { ...base, ...kfs[0].values };
	const last = kfs[kfs.length - 1];
	if (time >= last.time) return { ...base, ...last.values };
	let i = 0;
	while (time >= kfs[i + 1].time) i++;
	const a = kfs[i];
	const b = kfs[i + 1];
	const k = ease(a.easing, (time - a.time) / (b.time - a.time));
	const out = { ...base } as Record<string, number>;
	const av = a.values as Record<string, number>;
	const bv = b.values as Record<string, number>;
	for (const key of Object.keys(av)) {
		if (typeof bv[key] === 'number') out[key] = av[key] + (bv[key] - av[key]) * k;
	}
	return out as V;
}

/** The keyframe at `time` (within SAME_TIME), if any. */
export function keyframeAt<V>(list: Keyframe<V>[] | undefined, time: number): Keyframe<V> | undefined {
	return list?.find((k) => Math.abs(k.time - time) < SAME_TIME);
}

/** Add a keyframe at `time` with `values`, or update the one already there. */
export function upsertKeyframe<V>(
	list: Keyframe<V>[] | undefined,
	time: number,
	values: V,
	newId: () => string,
	easing: Easing
): Keyframe<V>[] {
	const existing = keyframeAt(list, time);
	if (existing) return (list ?? []).map((k) => (k === existing ? { ...k, values: { ...k.values, ...values } } : k));
	return sortKeyframes([...(list ?? []), { id: newId(), time, values, easing }]);
}

/** The keyframe before or after `time` (strictly), for the previous / next arrows. */
export function neighbourKeyframe<V>(
	list: Keyframe<V>[] | undefined,
	time: number,
	direction: -1 | 1
): Keyframe<V> | undefined {
	const kfs = sortKeyframes(list ?? []);
	return direction > 0
		? kfs.find((k) => k.time > time + SAME_TIME / 2)
		: [...kfs].reverse().find((k) => k.time < time - SAME_TIME / 2);
}

/** Move every keyframe by `delta` seconds (e.g. when an item is trimmed from the left). */
export function shiftKeyframes<V>(list: Keyframe<V>[] | undefined, delta: number): Keyframe<V>[] | undefined {
	return list?.map((k) => ({ ...k, time: k.time + delta }));
}

// ─── Overlays and words ──────────────────────────────────────────────────────────────────

/** What overlays and words keep when they aren't animated (missing = defaults). */
export interface Transformable {
	scaleX?: number;
	scaleY?: number;
	rotation?: number;
	keyframes?: Keyframe<ItemValues>[];
}

const clampOpacity = (v: number) => Math.min(1, Math.max(0, v));
/** Scale never reaches 0 (or flips), whatever the easing does. */
export const MIN_SCALE = 0.01;

/** Tidy values after easing: opacity within 0–100% (Overshoot and Bounce never push it past). */
export function tidyItemValues(v: ItemValues): ItemValues {
	return {
		...v,
		scaleX: Math.max(MIN_SCALE, v.scaleX),
		scaleY: Math.max(MIN_SCALE, v.scaleY),
		opacity: clampOpacity(v.opacity)
	};
}

/** An overlay's values when not animated: its box's centre, scale, rotation and opacity. */
export function overlayBaseValues(o: Transformable & { box: { x: number; y: number; w: number; h: number }; style: { opacity: number } }): ItemValues {
	return {
		x: o.box.x + o.box.w / 2,
		y: o.box.y + o.box.h / 2,
		scaleX: o.scaleX ?? 1,
		scaleY: o.scaleY ?? 1,
		rotation: o.rotation ?? 0,
		opacity: o.style.opacity
	};
}

/** Words' values when not animated. */
export function textBaseValues(t: Transformable & { x: number; y: number; opacity?: number }): ItemValues {
	return {
		x: t.x,
		y: t.y,
		scaleX: t.scaleX ?? 1,
		scaleY: t.scaleY ?? 1,
		rotation: t.rotation ?? 0,
		opacity: t.opacity ?? 1
	};
}

/** An overlay's or words' values `local` seconds after its start. */
export function itemValuesAt(base: ItemValues, keyframes: Keyframe<ItemValues>[] | undefined, local: number): ItemValues {
	return tidyItemValues(interpolate(keyframes, local, base));
}

/** The largest scale an item reaches (so words can be drawn sharp enough for it). */
export function maxItemScale(base: ItemValues, keyframes: Keyframe<ItemValues>[] | undefined): number {
	let m = Math.max(base.scaleX, base.scaleY);
	for (const k of keyframes ?? []) m = Math.max(m, k.values.scaleX, k.values.scaleY);
	// Overshoot can briefly pass the largest keyframe.
	if (keyframes?.some((k) => k.easing.kind === 'overshoot')) m *= 1.15;
	return m;
}

// ─── Scenes ──────────────────────────────────────────────────────────────────────────────

/** A scene's framing at content time `time` (source seconds): animated when it has keyframes. */
export function sceneFrameAt(
	frame: SceneFrame | undefined,
	keyframes: Keyframe<FrameValues>[] | undefined,
	time: number
): SceneFrame | undefined {
	if (!frame || frame.mode !== 'custom' || !keyframes?.length) return frame;
	const v = interpolate(keyframes, time, { x: frame.x, y: frame.y, zoom: frame.zoom });
	return { ...frame, x: v.x, y: v.y, zoom: Math.max(0.01, v.zoom) };
}

/**
 * Content time for a scene at timeline time `t`: source seconds for videos (the speed applies),
 * seconds into the scene for photos and cards. Not clamped, so a transition's borrowed time
 * before or after the scene follows the animation's held values.
 */
export function sceneContentTime(
	p: { start: number; scene: { kind: string; sourceStart: number; speed: number } },
	t: number
): number {
	const rate = p.scene.kind === 'video' ? p.scene.speed : 1;
	return p.scene.sourceStart + (t - p.start) * rate;
}

/** Timeline time of a scene's keyframe (the inverse of sceneContentTime). */
export function sceneKeyframeTimelineTime(
	p: { start: number; scene: { kind: string; sourceStart: number; speed: number } },
	time: number
): number {
	const rate = p.scene.kind === 'video' ? p.scene.speed : 1;
	return p.start + (time - p.scene.sourceStart) / rate;
}
