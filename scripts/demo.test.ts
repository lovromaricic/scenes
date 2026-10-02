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
	it('exists, with its five files and a picture', () => {
		expect(existsSync(FILE)).toBe(true);
		const list = execFileSync('unzip', ['-Z1', FILE]).toString().split('\n');
		expect(list.filter((f) => f.startsWith('media/'))).toHaveLength(5);
		expect(list).toContain('project.json');
		expect(list).toContain('thumbnail.jpg');
	});

	it('is a 15-second, 1920 × 1080, 24 fps ad with six scenes, on the beat', () => {
		const p = project();
		expect(p.title).toBe('Casa Rossa ad');
		expect(p.format).toMatchObject({ width: 1920, height: 1080, fps: 24 });
		const kinds = p.scenes.map((s) => s.kind);
		expect(kinds).toEqual(['card', 'video', 'photo', 'card', 'video', 'card']);
		const lengths = p.scenes.map((s) => (s.sourceEnd - s.sourceStart) / (s.kind === 'video' ? s.speed : 1));
		const ends = lengths.map((_, i) => lengths.slice(0, i + 1).reduce((a, b) => a + b, 0));
		expect(ends.at(-1)).toBeCloseTo(15, 3);
		// Scene changes at 2, 5, 8, 10.5 and 13 s, or on a beat within 0.15 s of them.
		[2, 5, 8, 10.5, 13].forEach((t, i) => expect(Math.abs(ends[i] - t)).toBeLessThanOrEqual(0.15 + 1e-6));
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
		for (const name of ['Headlines', 'Captions', 'Picture-in-picture', 'Badge', 'Shapes', 'Tomato · large', 'Tomato · medium', 'Tomato · small', 'Music'])
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
		const [music] = p.sounds;
		expect(music).toMatchObject({ start: 0, duration: 15, volume: 1, fadeOut: 1.5 });
		expect(p.tracks.find((t) => t.id === music.trackId)?.name).toBe('Music');
	});
});
