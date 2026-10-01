import { describe, expect, it } from 'vitest';
import { MediaNoun, mediaNoun } from './labels';

describe('mediaNoun', () => {
	it('says "video" for video clips and "picture" for photos and cards', () => {
		expect(mediaNoun({ kind: 'video' })).toBe('video');
		expect(mediaNoun({ kind: 'photo' })).toBe('picture');
		expect(mediaNoun({ kind: 'card' })).toBe('picture');
		expect(MediaNoun({ kind: 'video' })).toBe('Video');
		expect(MediaNoun({ kind: 'photo' })).toBe('Picture');
	});
});
