import { describe, expect, it } from 'vitest';
import type { SoundItem } from './types';
import {
	effectiveFades,
	freeRow,
	migrateSounds,
	snapTimes,
	splitSound,
	trimSound
} from './sound';

const song = (over: Partial<SoundItem> = {}): SoundItem => ({
	id: 's',
	mediaId: 'm',
	name: 'Song',
	start: 2,
	sourceStart: 0,
	duration: 10,
	volume: 1,
	kind: 'music',
	fadeIn: 1.5,
	fadeOut: 3,
	trackId: 'a1',
	...over
});
const file = { start: 0, end: 10 };

describe('trimming sound clips', () => {
	it('the start edge cuts the beginning, keeping the rest where it was', () => {
		expect(trimSound(song(), 'start', 3, file)).toMatchObject({ start: 5, sourceStart: 3, duration: 7 });
		// Back out again, but never before the file's start.
		expect(trimSound(song({ start: 5, sourceStart: 3, duration: 7 }), 'start', -5, file)).toMatchObject({
			start: 2,
			sourceStart: 0,
			duration: 10
		});
		// Nor before the start of the video.
		expect(trimSound(song({ start: 1, sourceStart: 3, duration: 7 }), 'start', -5, file)).toMatchObject({
			start: 0,
			sourceStart: 2
		});
	});
	it('the end edge cuts the end, and can restore it up to the file’s end', () => {
		expect(trimSound(song(), 'end', -4, file).duration).toBe(6);
		expect(trimSound(song({ duration: 6 }), 'end', 20, file).duration).toBe(10);
	});
	it('never leaves less than a moment', () => {
		expect(trimSound(song(), 'start', 20, file).duration).toBeCloseTo(0.3);
		expect(trimSound(song(), 'end', -20, file).duration).toBeCloseTo(0.3);
	});
	it('trims from where the end is drawn when the clip runs past the video', () => {
		// Drawn ending at 8 s (the video's end); dragging it 1 s left ends the clip at 7 s.
		expect(trimSound(song(), 'end', -1, file, 8).duration).toBe(5);
	});
});

describe('splitting sound clips', () => {
	it('makes two clips that play exactly as before', () => {
		const [a, b] = splitSound(song(), 6, () => 'new')!;
		expect(a).toMatchObject({ id: 's', start: 2, sourceStart: 0, duration: 4, fadeIn: 1.5, fadeOut: 0 });
		expect(b).toMatchObject({ id: 'new', start: 6, sourceStart: 4, duration: 6, fadeIn: 0, fadeOut: 3 });
	});
	it('only inside the clip', () => {
		expect(splitSound(song(), 1, () => 'x')).toBeNull();
		expect(splitSound(song(), 12.1, () => 'x')).toBeNull();
	});
});

describe('fades', () => {
	it('are at most 5 s, and shrink together to fit short clips', () => {
		expect(effectiveFades({ fadeIn: 9, fadeOut: 1 }, 20)).toEqual({ fadeIn: 5, fadeOut: 1 });
		expect(effectiveFades({ fadeIn: 2, fadeOut: 2 }, 2)).toEqual({ fadeIn: 1, fadeOut: 1 });
	});
});

describe('older projects’ rows', () => {
	it('finds the lowest free row', () => {
		const a = { id: 'a', row: 0, start: 0, duration: 5 };
		expect(freeRow([a], 1, 2)).toBe(1);
		expect(freeRow([a], 5, 2)).toBe(0);
	});
});

describe('snapping', () => {
	it('shifts to the nearest target within reach', () => {
		const near = (t: number, target: number) => Math.abs(t - target) < 0.2;
		const a = snapTimes([4.9, 9.9], [5, 10.05], near);
		expect(a.target).toBe(5);
		expect(a.shift).toBeCloseTo(0.1);
		const b = snapTimes([4.9, 9.95], [5, 10], near);
		expect(b.target).toBe(10);
		expect(b.shift).toBeCloseTo(0.05);
		expect(snapTimes([3], [5], near)).toEqual({ shift: 0, target: null });
	});
});

describe('older projects', () => {
	it('turn "fade" into fade lengths and stack voiceovers under the music', () => {
		const old = [
			{ ...song({ id: 'm', start: 0, duration: 20 }), fade: true, fadeIn: undefined, fadeOut: undefined, trackId: undefined },
			{ ...song({ id: 'v', kind: 'voice', start: 4, duration: 2 }), fade: false, fadeIn: undefined, fadeOut: undefined, trackId: undefined }
		] as unknown as (SoundItem & { fade?: boolean })[];
		const out = migrateSounds(old);
		expect(out[0]).toMatchObject({ fadeIn: 1.5, fadeOut: 3, row: 0 });
		expect(out[1]).toMatchObject({ fadeIn: 0, fadeOut: 0, row: 1 });
		expect('fade' in out[0]).toBe(false);
	});
});
