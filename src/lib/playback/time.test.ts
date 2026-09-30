import { describe, expect, it } from 'vitest';
import { placeScenes } from '$lib/model/timeline';
import type { Scene } from '$lib/model/types';
import { sourceTimeAt } from './time';

const scene = (extra: Partial<Scene>): Scene => ({
	id: 'a',
	mediaId: 'm',
	kind: 'video',
	name: 'a',
	sourceStart: 2,
	sourceEnd: 10,
	speed: 1,
	volume: 1,
	mood: null,
	transition: { kind: 'cut', duration: 0 },
	...extra
});

describe('sourceTimeAt', () => {
	it('offsets by the trim start and applies speed', () => {
		const [p] = placeScenes([scene({ speed: 2 })]);
		expect(sourceTimeAt(p, 0)).toBe(2);
		expect(sourceTimeAt(p, 1.5)).toBe(5);
	});
	it('clamps to the scene', () => {
		const [p] = placeScenes([scene({})]);
		expect(sourceTimeAt(p, -1)).toBe(2);
		expect(sourceTimeAt(p, 100)).toBeCloseTo(9.999);
	});
	it('is always 0 for photos', () => {
		const [p] = placeScenes([scene({ kind: 'photo', sourceStart: 0, sourceEnd: 3 })]);
		expect(sourceTimeAt(p, 2)).toBe(0);
	});
});
