import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '$lib/media/db';
import { sceneDuration } from '$lib/model/timeline';
import { newProject, sceneFromMedia } from './project';

const info = (extra: Partial<MediaInfo>): MediaInfo => ({
	id: 'm1',
	name: 'beach_day.mp4',
	kind: 'video',
	mime: 'video/mp4',
	size: 1,
	duration: 12.5,
	startTime: 0,
	width: 1920,
	height: 1080,
	hasAudio: true,
	createdAt: 0,
	...extra
});

describe('sceneFromMedia', () => {
	it('uses the whole video', () => {
		const scene = sceneFromMedia(info({}));
		expect(scene).toMatchObject({
			kind: 'video',
			name: 'Beach day',
			sourceStart: 0,
			sourceEnd: 12.5
		});
		expect(sceneDuration(scene)).toBe(12.5);
	});
	it('gives photos 3 seconds', () => {
		const scene = sceneFromMedia(info({ kind: 'photo', name: 'IMG_1.jpg', duration: 0 }));
		expect(sceneDuration(scene)).toBe(3);
	});
	it('respects a non-zero first timestamp', () => {
		expect(sceneFromMedia(info({ startTime: 0.04 })).sourceStart).toBe(0.04);
	});
});

describe('newProject', () => {
	it('starts empty', () => {
		expect(newProject()).toMatchObject({ scenes: [], texts: [], sounds: [], aspect: '16:9' });
	});
});
