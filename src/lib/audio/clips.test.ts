import { describe, expect, it } from 'vitest';
import {
	bufferPlacement,
	clipGainAt,
	projectAudioClips,
	sceneAudioClips,
	soundAudioClips,
	soundEnd,
	type AudioClip
} from './clips';
import type { Scene, SoundItem } from '$lib/model/types';

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

const music: SoundItem = {
	id: 'music',
	mediaId: 'song',
	name: 'Song',
	start: 0,
	sourceStart: 0,
	duration: 60,
	volume: 0.5,
	kind: 'music',
	fadeIn: 1.5,
	fadeOut: 3,
	row: 0
};

describe('soundAudioClips', () => {
	it('stops music at the end of the video', () => {
		expect(soundEnd(music, 20)).toBe(20);
		const [clip] = soundAudioClips([music], 20);
		expect(clip).toMatchObject({ start: 0, end: 20, volume: 0.5, fadeIn: 1.5, fadeOut: 3 });
	});
	it('uses the clip’s fade lengths, shortened together for short sounds', () => {
		expect(soundAudioClips([{ ...music, fadeIn: 0, fadeOut: 0 }], 20)[0]).toMatchObject({
			fadeIn: 0,
			fadeOut: 0
		});
		expect(soundAudioClips([{ ...music, fadeIn: 2, fadeOut: 4.5 }], 20)[0]).toMatchObject({ fadeIn: 2, fadeOut: 4.5 });
		// 1.5 + 3 s of fades in a 3 s clip: both shrink in proportion, to fill it.
		expect(soundAudioClips([music], 3)[0]).toMatchObject({ fadeIn: 1, fadeOut: 2 });
	});
	it('skips silent sounds and sounds after the end of the video', () => {
		expect(soundAudioClips([{ ...music, volume: 0 }], 20)).toEqual([]);
		expect(soundAudioClips([{ ...music, start: 25 }], 20)).toEqual([]);
	});
	it('places voiceovers where they were recorded', () => {
		const voice: SoundItem = {
			...music,
			id: 'v',
			kind: 'voice',
			start: 4,
			duration: 3,
			volume: 1,
			fadeIn: 0,
			fadeOut: 0
		};
		expect(soundAudioClips([voice], 20)[0]).toMatchObject({ start: 4, end: 7 });
	});
});

describe('projectAudioClips', () => {
	it('combines scene sound, music and voice', () => {
		const clips = projectAudioClips({ scenes: [base], sounds: [music] }, () => true);
		expect(clips.map((c) => c.id)).toEqual(['a', 'music']);
		expect(clips[1].end).toBe(10);
	});
});

describe('clipGainAt', () => {
	const clip = soundAudioClips([music], 20)[0];
	it('fades in, holds, and fades out', () => {
		expect(clipGainAt(clip, 0)).toBe(0);
		expect(clipGainAt(clip, 0.75)).toBeCloseTo(0.25);
		expect(clipGainAt(clip, 10)).toBe(0.5);
		expect(clipGainAt(clip, 18.5)).toBeCloseTo(0.25);
		expect(clipGainAt(clip, 20)).toBe(0);
		expect(clipGainAt(clip, 21)).toBe(0);
	});
});
