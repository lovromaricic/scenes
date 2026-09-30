import { describe, expect, it } from 'vitest';
import { bufferPlacement, sceneAudioClips, type AudioClip } from './clips';
import type { Scene } from '$lib/model/types';

const base: Scene = {
	id: 'a',
	mediaId: 'm',
	kind: 'video',
	name: 'a',
	sourceStart: 0,
	sourceEnd: 10,
	speed: 1,
	volume: 1,
	mood: null,
	transition: { kind: 'cut', duration: 0 }
};

describe('sceneAudioClips', () => {
	it('places each video scene’s sound on the timeline', () => {
		const clips = sceneAudioClips(
			[base, { ...base, id: 'b', sourceStart: 2, sourceEnd: 6, speed: 2 }],
			() => true
		);
		expect(clips.map((c) => [c.start, c.end, c.sourceStart, c.speed])).toEqual([
			[0, 10, 0, 1],
			[10, 12, 2, 2]
		]);
	});
	it('skips photos, muted scenes and files without sound', () => {
		const clips = sceneAudioClips(
			[
				{ ...base, id: 'p', kind: 'photo' },
				{ ...base, id: 'm', volume: 0 },
				{ ...base, id: 's', mediaId: 'silent' }
			],
			(id) => id !== 'silent'
		);
		expect(clips).toEqual([]);
	});
});

describe('bufferPlacement', () => {
	const clip: AudioClip = {
		id: 'c',
		mediaId: 'm',
		start: 10,
		end: 14,
		sourceStart: 2,
		speed: 2,
		volume: 1,
		fadeIn: 0,
		fadeOut: 0
	};
	it('maps source time to timeline time using speed', () => {
		expect(bufferPlacement(clip, 4, 0)).toEqual({ timelineStart: 11, offset: 0 });
	});
	it('skips into a buffer that starts before the playhead', () => {
		// Buffer at source 2.0 → timeline 10; playhead at 10.5 → 0.5s timeline = 1.0s of source.
		expect(bufferPlacement(clip, 2, 10.5)).toEqual({ timelineStart: 10.5, offset: 1 });
	});
});
