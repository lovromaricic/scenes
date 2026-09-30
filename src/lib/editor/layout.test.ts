import { describe, expect, it } from 'vitest';
import { newTrack, mainTrack } from '$lib/model/tracks';
import {
	COLLAPSED_H,
	DEFAULT_STORYBOARD_H,
	MIN_STORYBOARD_H,
	SCENES_ROW_H,
	SLIM_H,
	VISUAL_H,
	isTextTrack,
	storyboardHeight,
	storyboardLimits,
	trackHeight
} from './layout';

describe('storyboard layout', () => {
	it('keeps at least 40% of the window for the preview, and the ruler plus Scenes for the storyboard', () => {
		const { min, max } = storyboardLimits(1000, 64);
		expect(min).toBe(MIN_STORYBOARD_H);
		expect(1000 - 64 - 8 - max).toBeGreaterThanOrEqual(400);
		expect(storyboardHeight(5000, 1000, 64)).toBe(max);
		expect(storyboardHeight(10, 1000, 64)).toBe(min);
		// A tiny window: never below the minimum.
		expect(storyboardLimits(300, 64).max).toBe(MIN_STORYBOARD_H);
	});

	it('defaults to the ruler and about four tracks, within the limits', () => {
		expect(storyboardHeight(null, 1200, 64)).toBe(DEFAULT_STORYBOARD_H);
		expect(storyboardHeight(null, 720, 64)).toBeLessThanOrEqual(storyboardLimits(720, 64).max);
	});

	it('sizes tracks: Scenes, pictures at 60%, words and sound slim, collapsed thin', () => {
		const o = newTrack('o', 'overlay', 'Overlay 1');
		const t = newTrack('t', 'overlay', 'Text');
		const a = newTrack('a', 'audio', 'Audio 1');
		const items = [
			{ trackId: 'o', kind: 'overlay' as const },
			{ trackId: 'o', kind: 'text' as const },
			{ trackId: 'w', kind: 'text' as const }
		];
		expect(trackHeight(mainTrack(), items)).toBe(SCENES_ROW_H);
		expect(trackHeight(o, items)).toBe(VISUAL_H);
		expect(VISUAL_H / (SCENES_ROW_H - 4)).toBeCloseTo(0.6, 1);
		expect(trackHeight(t, items)).toBe(SLIM_H); // the empty Text track
		expect(trackHeight(newTrack('w', 'overlay', 'Titles'), items)).toBe(SLIM_H); // words only
		expect(trackHeight(newTrack('e', 'overlay', 'Overlay 2'), items)).toBe(VISUAL_H); // empty
		expect(trackHeight(a, items)).toBe(SLIM_H);
		expect(trackHeight({ ...o, collapsed: true }, items)).toBe(COLLAPSED_H);
		expect(isTextTrack(o, items)).toBe(false);
	});
});
