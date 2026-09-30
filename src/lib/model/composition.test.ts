import { describe, expect, it } from 'vitest';
import { compose, transitionLength } from './composition';
import { placeScenes } from './timeline';
import type { Scene, TransitionKind } from './types';

const scene = (
	id: string,
	start: number,
	end: number,
	kind: TransitionKind = 'cut',
	extra: Partial<Scene> = {}
): Scene => ({
	id,
	mediaId: id,
	kind: 'video',
	name: id,
	sourceStart: start,
	sourceEnd: end,
	speed: 1,
	volume: 1,
	mood: null,
	transition: { kind, duration: kind === 'cut' ? 0 : 1 },
	...extra
});

// A: source 2–6 of a 10s clip (4s on the timeline), B: source 0–5 of a 5s clip.
const placed = placeScenes([scene('a', 2, 6, 'crossfade'), scene('b', 0, 5)]);
const bounds = (p: { scene: Scene }) =>
	p.scene.id === 'a' ? { start: 0, end: 10 } : { start: 0, end: 5 };

describe('compose', () => {
	it('shows one scene away from any transition', () => {
		const c = compose(placed, 1, bounds);
		expect(c.a?.placed.scene.id).toBe('a');
		expect(c.a?.sourceTime).toBe(3);
		expect(c.b).toBeNull();
		expect(c.transition).toBeNull();
	});

	it('runs the transition half before and half after the cut', () => {
		expect(compose(placed, 3.49, bounds).transition).toBeNull();
		const start = compose(placed, 3.5, bounds);
		expect(start.transition).toEqual({ kind: 'crossfade', progress: 0 });
		const mid = compose(placed, 4, bounds);
		expect(mid.transition?.progress).toBeCloseTo(0.5);
		expect(compose(placed, 4.49, bounds).transition?.progress).toBeCloseTo(0.99);
		expect(compose(placed, 4.5, bounds).transition).toBeNull();
		expect(compose(placed, 4.5, bounds).a?.placed.scene.id).toBe('b');
	});

	it('lets the outgoing scene run into spare footage after its trim point', () => {
		const c = compose(placed, 4.25, bounds);
		expect(c.a?.placed.scene.id).toBe('a');
		expect(c.a?.sourceTime).toBeCloseTo(6.25);
	});

	it('holds the first frame of the incoming scene when there is no earlier footage', () => {
		const c = compose(placed, 3.75, bounds);
		expect(c.b?.placed.scene.id).toBe('b');
		expect(c.b?.sourceTime).toBe(0);
	});

	it('holds the last frame when the clip has no spare footage', () => {
		const tight = placeScenes([scene('a', 0, 4, 'crossfade'), scene('b', 0, 5)]);
		const c = compose(tight, 4.4, () => ({ start: 0, end: 4 }));
		expect(c.a?.sourceTime).toBeCloseTo(4 - 1e-3);
	});

	it('shortens transitions to fit short scenes', () => {
		const short = placeScenes([scene('a', 0, 4, 'crossfade'), scene('b', 0, 0.5)]);
		expect(transitionLength(short[0], short[1])).toBe(0.5);
	});

	it('uses no transition for a cut or at the ends of the video', () => {
		const cuts = placeScenes([scene('a', 0, 4), scene('b', 0, 5)]);
		expect(compose(cuts, 4, bounds).transition).toBeNull();
		expect(compose(placed, 0, bounds).transition).toBeNull();
		expect(compose(placed, 9, bounds).a?.placed.scene.id).toBe('b');
		expect(compose([], 1, bounds).a).toBeNull();
	});
});
