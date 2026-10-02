import { describe, expect, it } from 'vitest';
import { mapTime, reconcileTimeline } from './ripple';
import { placeScenes } from './timeline';
import type { Scene } from './types';

const scene = (id: string, length: number, extra: Partial<Scene> = {}): Scene => ({
	id,
	mediaId: id,
	kind: 'video',
	name: id,
	sourceStart: 0,
	sourceEnd: length,
	speed: 1,
	volume: 1,
	mood: null,
	transition: { kind: 'cut', duration: 0 },
	...extra
});
const text = (id: string, start: number, duration: number) =>
	({ id, trackId: 't', start, duration, text: id, x: 0.5, y: 0.5, style: 'title', animation: 'fade' }) as const;
const project = (scenes: Scene[], texts: ReturnType<typeof text>[]) => ({ scenes, overlays: [], texts: [...texts], sounds: [] });
const times = (p: { texts: { id: string; start: number; duration: number }[] }) =>
	Object.fromEntries(p.texts.map((t) => [t.id, [Math.round(t.start * 100) / 100, Math.round(t.duration * 100) / 100]]));

// Scenes A (0–4), B (4–7), C (7–10). Items: x over A at 1 s, y over B at 5 s, z over C at 8 s.
const A = scene('A', 4);
const B = scene('B', 3);
const C = scene('C', 3);
const items = [text('x', 1, 1), text('y', 5, 1), text('z', 8, 1)];

describe('ripple', () => {
	it('off: items keep their times whatever happens to the scenes', () => {
		const before = project([A, B, C], items);
		const after = reconcileTimeline(before, project([A, C], items), false);
		expect(times(after)).toEqual({ x: [1, 1], y: [5, 1], z: [8, 1] });
	});

	it('on: deleting a scene shifts the later items by its length; what was over it stays at the cut', () => {
		const before = project([A, B, C], items);
		const after = reconcileTimeline(before, project([A, C], items), true);
		expect(times(after)).toEqual({ x: [1, 1], y: [4, 1], z: [5, 1] });
	});

	it('on: trimming a scene’s end moves what comes after by the same amount', () => {
		const before = project([A, B, C], items);
		const after = reconcileTimeline(before, project([{ ...A, sourceEnd: 3 }, B, C], items), true);
		expect(times(after)).toEqual({ x: [1, 1], y: [4, 1], z: [7, 1] });
	});

	it('on: trimming a scene’s start keeps items on the same moment of the clip', () => {
		const before = project([A, B, C], items);
		const after = reconcileTimeline(before, project([{ ...A, sourceStart: 0.5 }, B, C], items), true);
		expect(times(after)).toEqual({ x: [0.5, 1], y: [4.5, 1], z: [7.5, 1] });
	});

	it('on: adding a scene before, or reordering, keeps items with their scenes', () => {
		const before = project([A, B, C], items);
		const D = scene('D', 2);
		expect(times(reconcileTimeline(before, project([D, A, B, C], items), true))).toEqual({ x: [3, 1], y: [7, 1], z: [10, 1] });
		expect(times(reconcileTimeline(before, project([C, A, B], items), true))).toEqual({ x: [4, 1], y: [8, 1], z: [1, 1] });
	});

	it('on: speeding a scene up keeps items on the same moment of it', () => {
		const before = project([A, B, C], items);
		const after = reconcileTimeline(before, project([{ ...A, speed: 2 }, B, C], items), true);
		expect(times(after)).toEqual({ x: [0.5, 1], y: [3, 1], z: [6, 1] });
	});

	it('splitting changes nothing', () => {
		const before = project([A, B, C], items);
		const split = [{ ...A, sourceEnd: 2 }, { ...A, id: 'A2', sourceStart: 2 }, B, C];
		expect(times(reconcileTimeline(before, project(split, items), true))).toEqual({ x: [1, 1], y: [5, 1], z: [8, 1] });
		expect(mapTime(3, placeScenes([A, B, C]), placeScenes(split))).toBe(3);
	});

	it('an item ending at the video’s end keeps its length when the video gets longer or shorter', () => {
		const logo = text('logo', 0, 10);
		const before = project([A, B, C], [logo]);
		const D = scene('D', 5);
		expect(times(reconcileTimeline(before, project([A, B, C, D], [logo]), false))).toEqual({ logo: [0, 10] });
		expect(times(reconcileTimeline(before, project([A, B, C, D], [logo]), true))).toEqual({ logo: [0, 10] });
		expect(times(reconcileTimeline(before, project([A, C], [logo]), false))).toEqual({ logo: [0, 10] });
	});

	it('items placed by the edit itself are left alone', () => {
		const before = project([A, B, C], items);
		const moved = items.map((t) => (t.id === 'z' ? { ...t, start: 9 } : t));
		expect(times(reconcileTimeline(before, project([A, C], moved), true)).z).toEqual([9, 1]);
	});
});
