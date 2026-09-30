import { describe, expect, it } from 'vitest';
import {
	clampTextTiming,
	maxLength,
	moveScene,
	removeScene,
	resizeText,
	setLength,
	setSpeed,
	splitAt,
	stackRows,
	trimEdge
} from './edits';
import { placeScenes, sceneDuration, totalDuration } from './timeline';
import type { Scene } from './types';

const video = (id: string, start = 0, end = 10, extra: Partial<Scene> = {}): Scene => ({
	id,
	mediaId: `m-${id}`,
	kind: 'video',
	name: id,
	sourceStart: start,
	sourceEnd: end,
	speed: 1,
	volume: 1,
	mood: null,
	transition: { kind: 'cut', duration: 0 },
	...extra
});
const photo = (id: string, length = 3): Scene => video(id, 0, length, { kind: 'photo' });
const bounds = { start: 0, end: 10 };

describe('moveScene', () => {
	const scenes = [video('a'), video('b'), video('c')];
	it('moves a scene to a new position', () => {
		expect(moveScene(scenes, 0, 2).map((s) => s.id)).toEqual(['b', 'c', 'a']);
		expect(moveScene(scenes, 2, 0).map((s) => s.id)).toEqual(['c', 'a', 'b']);
	});
	it('does nothing for the same position or a bad index', () => {
		expect(moveScene(scenes, 1, 1)).toBe(scenes);
		expect(moveScene(scenes, 5, 0)).toBe(scenes);
	});
	it('does not mutate the input', () => {
		moveScene(scenes, 0, 2);
		expect(scenes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
	});
});

describe('removeScene', () => {
	it('removes by id', () => {
		expect(removeScene([video('a'), video('b')], 'a').map((s) => s.id)).toEqual(['b']);
	});
});

describe('setLength', () => {
	it('grows or shrinks a video at the end', () => {
		expect(setLength(video('a', 2, 6), 3, bounds)).toMatchObject({ sourceStart: 2, sourceEnd: 5 });
		expect(setLength(video('a', 2, 6), 6, bounds)).toMatchObject({ sourceStart: 2, sourceEnd: 8 });
	});
	it('takes extra from the start when the clip runs out at the end', () => {
		expect(setLength(video('a', 6, 9), 6, bounds)).toMatchObject({ sourceStart: 4, sourceEnd: 10 });
	});
	it('clamps to the whole clip and a minimum length', () => {
		expect(sceneDuration(setLength(video('a', 2, 6), 99, bounds))).toBe(10);
		expect(sceneDuration(setLength(video('a', 2, 6), 0, bounds))).toBe(0.5);
	});
	it('accounts for speed', () => {
		const fast = video('a', 0, 4, { speed: 2 });
		expect(maxLength(fast, bounds)).toBe(5);
		expect(setLength(fast, 3, bounds)).toMatchObject({ sourceStart: 0, sourceEnd: 6 });
	});
	it('sets photo length directly', () => {
		expect(sceneDuration(setLength(photo('p'), 7, bounds))).toBe(7);
	});
});

describe('trimEdge', () => {
	it('trims the start later and the end earlier', () => {
		expect(trimEdge(video('a', 0, 10), 'start', 2, bounds)).toMatchObject({
			sourceStart: 2,
			sourceEnd: 10
		});
		expect(trimEdge(video('a', 0, 10), 'end', -3, bounds)).toMatchObject({
			sourceStart: 0,
			sourceEnd: 7
		});
	});
	it('can extend back out to the clip bounds, but no further', () => {
		expect(trimEdge(video('a', 2, 8), 'start', -5, bounds)).toMatchObject({ sourceStart: 0 });
		expect(trimEdge(video('a', 2, 8), 'end', 5, bounds)).toMatchObject({ sourceEnd: 10 });
	});
	it('never trims below the minimum length', () => {
		expect(sceneDuration(trimEdge(video('a', 0, 10), 'start', 20, bounds))).toBe(0.5);
		expect(sceneDuration(trimEdge(video('a', 0, 10), 'end', -20, bounds))).toBe(0.5);
	});
	it('converts timeline seconds to source seconds using speed', () => {
		expect(trimEdge(video('a', 0, 10, { speed: 2 }), 'end', -1, bounds)).toMatchObject({
			sourceEnd: 8
		});
	});
	it('changes photo length from either edge', () => {
		expect(sceneDuration(trimEdge(photo('p'), 'start', 1, bounds))).toBe(2);
		expect(sceneDuration(trimEdge(photo('p'), 'end', 1, bounds))).toBe(4);
	});
});

describe('setSpeed', () => {
	it('keeps the same part of the clip, changing the length', () => {
		const s = setSpeed(video('a', 2, 6), 2);
		expect(s).toMatchObject({ sourceStart: 2, sourceEnd: 6, speed: 2 });
		expect(sceneDuration(s)).toBe(2);
		expect(sceneDuration(setSpeed(video('a', 2, 6), 0.5))).toBe(8);
	});
	it('ignores photos', () => {
		const p = photo('p');
		expect(setSpeed(p, 2)).toBe(p);
	});
});

describe('splitAt', () => {
	let n = 0;
	const id = () => `new${++n}`;
	const scenes = [
		video('a', 0, 4),
		video('b', 1, 7, { transition: { kind: 'crossfade', duration: 0.8 } })
	];

	it('splits the scene under the playhead into two that play the same frames', () => {
		const result = splitAt(scenes, 6, id)!;
		expect(result.scenes.map((s) => s.id)).toEqual(['a', 'b', result.secondId]);
		expect(result.scenes[1]).toMatchObject({ sourceStart: 1, sourceEnd: 3 });
		expect(result.scenes[2]).toMatchObject({ sourceStart: 3, sourceEnd: 7, mediaId: 'm-b' });
		expect(totalDuration(result.scenes)).toBe(totalDuration(scenes));
	});
	it('keeps the outgoing transition on the second half and cuts between the halves', () => {
		const result = splitAt(scenes, 6, id)!;
		expect(result.scenes[1].transition.kind).toBe('cut');
		expect(result.scenes[2].transition.kind).toBe('crossfade');
	});
	it('respects speed', () => {
		const result = splitAt([video('a', 0, 10, { speed: 2 })], 2, id)!;
		expect(result.scenes[0].sourceEnd).toBe(4);
		expect(placeScenes(result.scenes).map((p) => p.duration)).toEqual([2, 3]);
	});
	it('splits photos by length', () => {
		const result = splitAt([photo('p', 3)], 1, id)!;
		expect(result.scenes.map(sceneDuration)).toEqual([1, 2]);
	});
	it('refuses to split at or very near a cut', () => {
		expect(splitAt(scenes, 4, id)).toBeNull();
		expect(splitAt(scenes, 4.1, id)).toBeNull();
		expect(splitAt(scenes, 0, id)).toBeNull();
		expect(splitAt([], 1, id)).toBeNull();
	});
});

describe('text timing', () => {
	it('keeps text inside the video', () => {
		expect(clampTextTiming({ start: 9, duration: 3 }, 10)).toEqual({ start: 7, duration: 3 });
		expect(clampTextTiming({ start: -2, duration: 3 }, 10)).toEqual({ start: 0, duration: 3 });
		expect(clampTextTiming({ start: 0, duration: 30 }, 10)).toEqual({ start: 0, duration: 10 });
		expect(clampTextTiming({ start: 1, duration: 0.1 }, 10)).toEqual({ start: 1, duration: 0.5 });
	});
	it('resizes from either edge', () => {
		expect(resizeText({ start: 2, duration: 3 }, 'end', 1, 10)).toEqual({ start: 2, duration: 4 });
		expect(resizeText({ start: 2, duration: 3 }, 'start', 1, 10)).toEqual({
			start: 3,
			duration: 2
		});
		expect(resizeText({ start: 2, duration: 3 }, 'start', -5, 10)).toEqual({
			start: 0,
			duration: 5
		});
	});
	it('never makes text shorter than the minimum or longer than the video', () => {
		expect(resizeText({ start: 2, duration: 3 }, 'end', -10, 10).duration).toBe(0.5);
		expect(resizeText({ start: 2, duration: 3 }, 'start', 10, 10)).toEqual({
			start: 4.5,
			duration: 0.5
		});
		expect(resizeText({ start: 2, duration: 3 }, 'end', 100, 10).duration).toBe(8);
	});
	it('stacks overlapping items into rows', () => {
		expect(
			stackRows([
				{ start: 0, duration: 3 },
				{ start: 1, duration: 3 },
				{ start: 3, duration: 1 },
				{ start: 2, duration: 5 }
			])
		).toEqual([0, 1, 0, 2]);
	});
});
