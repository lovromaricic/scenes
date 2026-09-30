import { describe, expect, it } from 'vitest';
import { placeScenes, sceneAtTime, sceneDuration, totalDuration } from './timeline';
import type { Scene } from './types';

function scene(id: string, length: number, extra: Partial<Scene> = {}): Scene {
	return {
		id,
		mediaId: `m-${id}`,
		kind: 'video',
		name: id,
		sourceStart: 0,
		sourceEnd: length,
		speed: 1,
		volume: 1,
		mood: null,
		transition: { kind: 'cut', duration: 0 },
		...extra
	};
}

describe('sceneDuration', () => {
	it('divides the source length by speed', () => {
		expect(sceneDuration(scene('a', 10))).toBe(10);
		expect(sceneDuration(scene('a', 10, { speed: 2 }))).toBe(5);
		expect(sceneDuration(scene('a', 10, { speed: 0.5 }))).toBe(20);
	});
	it('uses only the trimmed part', () => {
		expect(sceneDuration(scene('a', 10, { sourceStart: 2, sourceEnd: 7 }))).toBe(5);
	});
	it('ignores speed for photos', () => {
		expect(sceneDuration(scene('p', 3, { kind: 'photo', speed: 2 }))).toBe(3);
	});
});

describe('placeScenes / totalDuration', () => {
	const scenes = [scene('a', 12), scene('b', 9), scene('c', 10)];
	it('places scenes back to back', () => {
		const placed = placeScenes(scenes);
		expect(placed.map((p) => [p.start, p.end])).toEqual([
			[0, 12],
			[12, 21],
			[21, 31]
		]);
	});
	it('sums the lengths', () => {
		expect(totalDuration(scenes)).toBe(31);
		expect(totalDuration([])).toBe(0);
	});
});

describe('sceneAtTime', () => {
	const scenes = [scene('a', 12), scene('b', 9), scene('c', 10)];
	it('finds the scene under the playhead', () => {
		expect(sceneAtTime(scenes, 0)?.scene.id).toBe('a');
		expect(sceneAtTime(scenes, 11.99)?.scene.id).toBe('a');
		expect(sceneAtTime(scenes, 12)?.scene.id).toBe('b');
		expect(sceneAtTime(scenes, 31)?.scene.id).toBe('c');
	});
	it('returns null for an empty project', () => {
		expect(sceneAtTime([], 0)).toBeNull();
	});
});
