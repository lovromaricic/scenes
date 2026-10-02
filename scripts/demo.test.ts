import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Project } from '../src/lib/model/types';

/**
 * The demo project file that `node scripts/build-demo.ts` makes: it matches the spec (see
 * NOTES.md, "The Casa Rossa demo").
 */

const FILE = path.resolve(import.meta.dirname, '../static/demo/casa-rossa.scenes');
const read = (entry: string) => execFileSync('unzip', ['-p', FILE, entry], { maxBuffer: 1 << 26 });
const project = (): Project => JSON.parse(read('project.json').toString()).project;

describe('the Casa Rossa demo file', () => {
	it('exists, with its eleven files and a picture', () => {
		expect(existsSync(FILE)).toBe(true);
		const list = execFileSync('unzip', ['-Z1', FILE]).toString().split('\n');
		// The clips, the photo, the tomato, the music and six voice lines (not the full voiceover).
		expect(list.filter((f) => f.startsWith('media/'))).toHaveLength(11);
		expect(list).toContain('project.json');
		expect(list).toContain('thumbnail.jpg');
	});

	it('is a 22-second, 1920 × 1080, 24 fps ad with six scenes, changing where specified', () => {
		const p = project();
		expect(p.title).toBe('Casa Rossa ad');
		expect(p.format).toMatchObject({ width: 1920, height: 1080, fps: 24 });
		const kinds = p.scenes.map((s) => s.kind);
		expect(kinds).toEqual(['card', 'video', 'photo', 'card', 'video', 'card']);
		const lengths = p.scenes.map((s) => (s.sourceEnd - s.sourceStart) / (s.kind === 'video' ? s.speed : 1));
		const ends = lengths.map((_, i) => lengths.slice(0, i + 1).reduce((a, b) => a + b, 0));
		expect(ends.map((t) => Math.round(t * 1000) / 1000)).toEqual([3.8, 8.9, 13.4, 16.8, 18.8, 22]);
		expect(p.scenes.map((s) => s.card?.background ?? null)).toEqual(['#d63f1f', null, null, '#141417', null, '#ffffff']);
		expect(p.scenes.slice(0, 5).map((s) => [s.transition.kind, s.transition.duration])).toEqual([
			['slide', 0.4],
			['crossfade', 0.5],
			['cut', 0],
			['zoom', 0.4],
			['crossfade', 0.5]
		]);
	});

	it('the clips: muted, framed and animated as specified', () => {
		const [, kitchen, terrace, , hands] = project().scenes;
		expect(kitchen).toMatchObject({ sourceStart: 0, volume: 0, frame: { mode: 'custom' } });
		expect(kitchen.keyframes?.map((k) => k.values.zoom)).toEqual([1, 1.15]);
		expect(terrace.frame).toMatchObject({ mode: 'custom', zoom: 1.12 });
		const pan = terrace.keyframes!.map((k) => k.values.x);
		expect(pan[0]).toBeGreaterThan(0);
		expect(pan[1]).toBeLessThan(0);
		expect(hands).toMatchObject({ sourceStart: 4, speed: 2, volume: 0, mood: 'golden' });
	});

	it('named tracks, layers, words in the right fonts, and the music', () => {
		const p = project();
		const names = p.tracks.map((t) => t.name);
		for (const name of ['Headlines', 'Captions', 'Picture-in-picture', 'Badge', 'Shapes', 'Tomato · large', 'Tomato · medium', 'Tomato · small', 'Voiceover', 'Music'])
			expect(names).toContain(name);
		expect(p.overlays).toHaveLength(7);
		// Every video layer muted.
		expect(p.overlays.filter((o) => o.kind === 'video').every((o) => !o.sound.on)).toBe(true);
		// Each tomato on its own track.
		const tomatoes = p.overlays.filter((o) => o.kind === 'photo');
		expect(new Set(tomatoes.map((o) => o.trackId)).size).toBe(3);
		const words = Object.fromEntries(p.texts.map((t) => [t.text.replaceAll(' ', ''), t]));
		expect(words['Fresh.'].font?.id).toBe('anton');
		expect(words['From our garden to your table.'].font).toMatchObject({ id: 'instrument-serif', italic: true });
		expect(words['SINCE 1962'].font).toMatchObject({ id: 'geist', weight: 600 });
		expect(words['Sun-ripened tomatoes'].style).toBe('highlight');
		expect(words['100%'].style).toBe('outline');
		expect(words['Ready in'].style).toBe('boxed');
		expect(Object.keys(words)).toHaveLength(17);
		const [music, ...voice] = p.sounds;
		expect(music).toMatchObject({ kind: 'music', start: 0, sourceStart: 0, duration: 22, volume: 1 });
		expect(p.tracks.find((t) => t.id === music.trackId)?.name).toBe('Music');
		// 100%, down to 35% under the voice by 0.2 s, until 21 s, then out by 22 s.
		expect(music.volumePoints?.map((k) => [k.time, Math.round(k.values.gain * 100) / 100])).toEqual([
			[0, 1],
			[0.2, 0.35],
			[21, 0.35],
			[22, 0]
		]);
		expect(voice.map((v) => [v.kind, v.start, v.volume])).toEqual([0.2, 3.9, 9, 13.5, 16.9, 18.85].map((t) => ['voice', t, 1]));
		expect(new Set(voice.map((v) => p.tracks.find((t) => t.id === v.trackId)?.name))).toEqual(new Set(['Voiceover']));
	});
});
