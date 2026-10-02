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
	it('exists, with its twelve files and a picture', () => {
		expect(existsSync(FILE)).toBe(true);
		const list = execFileSync('unzip', ['-Z1', FILE]).toString().split('\n');
		// Three clips, the photo, the tomato, the music and six voice lines (not the full voiceover).
		expect(list.filter((f) => f.startsWith('media/'))).toHaveLength(12);
		expect(list).toContain('project.json');
		expect(list).toContain('thumbnail.jpg');
	});

	it('is a 23-second, 1920 × 1080, 24 fps ad with six scenes, changing where specified', () => {
		const p = project();
		expect(p.title).toBe('Casa Rossa ad');
		expect(p.format).toMatchObject({ width: 1920, height: 1080, fps: 24 });
		const kinds = p.scenes.map((s) => s.kind);
		expect(kinds).toEqual(['card', 'video', 'video', 'card', 'video', 'photo']);
		const lengths = p.scenes.map((s) => (s.sourceEnd - s.sourceStart) / (s.kind === 'video' ? s.speed : 1));
		const ends = lengths.map((_, i) => lengths.slice(0, i + 1).reduce((a, b) => a + b, 0));
		expect(ends.map((t) => Math.round(t * 1000) / 1000)).toEqual([3.8, 8.9, 13.4, 16.8, 19.8, 23]);
		expect(p.scenes.map((s) => s.card?.background ?? null)).toEqual(['#d63f1f', null, null, '#141417', null, null]);
		expect(p.scenes.slice(0, 5).map((s) => [s.transition.kind, s.transition.duration])).toEqual([
			['slide', 0.4],
			['crossfade', 0.5],
			['cut', 0],
			['zoom', 0.4],
			['crossfade', 0.5]
		]);
	});

	it('the clips: muted, framed and animated as specified', () => {
		const [, kitchen, field, , hands, terrace] = project().scenes;
		expect(kitchen).toMatchObject({ sourceStart: 0, volume: 0, frame: { mode: 'custom' } });
		expect(kitchen.keyframes?.map((k) => k.values.zoom)).toEqual([1, 1.15]);
		// The tomato field from 1.0 s, muted, zooming 100% → 110% (keyframes in its own seconds).
		expect(field).toMatchObject({ kind: 'video', sourceStart: 1, volume: 0, frame: { mode: 'custom' } });
		expect(field.keyframes?.map((k) => [k.time, k.values.zoom])).toEqual([
			[1, 1],
			[5.5, 1.1]
		]);
		// The outro: the terrace, 105% → 112%, eased out.
		expect(terrace).toMatchObject({ kind: 'photo', frame: { mode: 'custom' } });
		expect(terrace.keyframes?.map((k) => k.values.zoom)).toEqual([1.05, 1.12]);
		expect(terrace.keyframes?.[0].easing).toEqual({ kind: 'bezier', x1: 0, y1: 0, x2: 0.58, y2: 1 });
		expect(hands).toMatchObject({ sourceStart: 3.5, sourceEnd: 9.5, speed: 2, volume: 0, mood: 'golden' });
		// Framed into the right half of the split screen, still covering the whole frame.
		expect(hands.frame).toMatchObject({ mode: 'custom', zoom: 1.5, x: 0.25, y: 0 });
	});

	it('a true split screen: the kitchen fills the left half exactly, with a white line between', () => {
		const p = project();
		const track = (name: string) => p.tracks.find((t) => t.name === name)!.id;
		const [left] = p.overlays.filter((o) => o.trackId === track('Split screen'));
		expect(left).toMatchObject({ kind: 'video', start: 16.8, sourceStart: 3, sound: { on: false } });
		expect(left.box).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
		expect(left.style).toMatchObject({ radius: 0, borderWidth: 0 });
		// Slides in, 16.8 → 17.15 (then leaves with the crossfade, below).
		expect(left.keyframes!.slice(0, 2).map((k) => [Math.round((16.8 + k.time) * 100) / 100, k.values.x])).toEqual([
			[16.8, -0.25],
			[17.15, 0.25]
		]);
		const [line] = p.overlays.filter((o) => o.trackId === track('Divider'));
		expect(line).toMatchObject({ kind: 'card', start: 17, card: { background: '#ffffff' }, scaleLinked: false });
		expect(line.box.w * 1920).toBeCloseTo(6, 3);
		expect(line.box.h).toBe(1);
		expect(line.keyframes!.slice(0, 2).map((k) => [k.values.scaleX, k.values.scaleY])).toEqual([
			[1, 0.01],
			[1, 1]
		]);
		// The line is above the left half.
		expect(p.tracks.findIndex((t) => t.name === 'Divider')).toBeLessThan(p.tracks.findIndex((t) => t.name === 'Split screen'));
	});

	it('named tracks, layers, words in the right fonts, and the music', () => {
		const p = project();
		const names = p.tracks.map((t) => t.name);
		for (const name of ['Headlines', 'Captions', 'Shade', 'Badge', 'Shapes', 'Tomato · large', 'Tomato · medium', 'Tomato · small', 'Split screen', 'Divider', 'Voiceover', 'Music'])
			expect(names).toContain(name);
		expect(p.overlays).toHaveLength(8);
		// No picture-in-picture any more: the only video layer is the split screen's left half.
		expect(p.overlays.filter((o) => o.kind === 'video')).toHaveLength(1);
		// The outro's shade: black over the whole frame at 35%, under the words.
		const shade = p.overlays.find((o) => o.trackId === p.tracks.find((t) => t.name === 'Shade')!.id)!;
		expect(shade).toMatchObject({ kind: 'card', start: 19.55, card: { background: '#000000' }, box: { x: 0, y: 0, w: 1, h: 1 } });
		expect(shade.keyframes?.at(-1)?.values.opacity).toBeCloseTo(0.35, 6);
		expect(p.tracks.findIndex((t) => t.name === 'Shade')).toBeGreaterThan(p.tracks.findIndex((t) => t.name === 'Headlines'));
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
		// The outro over the photo: white words, the name with a soft shadow, the line under at 80%.
		expect(words['Casa Rossa'].colors?.fill).toEqual({ color: '#ffffff', opacity: 1 });
		expect(words['Casa Rossa'].shadow?.on).toBe(true);
		expect(words['Taste the sun.'].colors?.fill).toEqual({ color: '#ffffff', opacity: 1 });
		expect(words['Tomato sauce · Available now'].colors?.fill).toEqual({ color: '#ffffff', opacity: 0.8 });
		// The field's words high on the left, clear of the hands.
		expect([words['Sun-ripened tomatoes'].y, words['Hand-cut. Every time.'].y].map((y) => Math.round(y * 1080))).toEqual([290, 395]);
		expect(Object.keys(words)).toHaveLength(17);
		const [music, ...voice] = p.sounds;
		expect(music).toMatchObject({ kind: 'music', start: 0, sourceStart: 0, duration: 23, volume: 1 });
		expect(p.tracks.find((t) => t.id === music.trackId)?.name).toBe('Music');
		// 100%, down to 35% under the voice by 0.2 s, until 22 s, then out by 23 s.
		expect(music.volumePoints?.map((k) => [k.time, Math.round(k.values.gain * 100) / 100])).toEqual([
			[0, 1],
			[0.2, 0.35],
			[22, 0.35],
			[23, 0]
		]);
		expect(voice.map((v) => [v.kind, v.start, v.volume])).toEqual([0.2, 3.9, 9, 13.5, 16.9, 19.85].map((t) => ['voice', t, 1]));
		expect(new Set(voice.map((v) => p.tracks.find((t) => t.id === v.trackId)?.name))).toEqual(new Set(['Voiceover']));
	});

	it('whatever ends at a scene change leaves with it, through the transition (not cut half way)', () => {
		const p = project();
		const lengths = p.scenes.map((s) => (s.sourceEnd - s.sourceStart) / (s.kind === 'video' ? s.speed : 1));
		const cuts = lengths.slice(0, -1).map((_, i) => lengths.slice(0, i + 1).reduce((a, b) => a + b, 0));
		const items = [...p.overlays, ...p.texts];
		let checked = 0;
		p.scenes.slice(0, -1).forEach((scene, i) => {
			const { kind, duration: d } = scene.transition;
			if (kind === 'cut') return;
			const [from, to] = [cuts[i] - d / 2, cuts[i] + d / 2];
			// Nothing ends inside the transition or at the scene change itself.
			expect(items.filter((it) => it.start + it.duration > from + 1e-3 && it.start + it.duration < to - 1e-3)).toEqual([]);
			for (const it of items.filter((x) => Math.abs(x.start + x.duration - to) < 1e-3)) {
				const keys = it.keyframes!;
				const last = keys.at(-1)!;
				// Its last keyframe is at the transition's end: gone (faded out, or pushed off the left).
				expect(it.start + last.time).toBeCloseTo(to, 3);
				if (kind === 'slide') expect(last.values.x + (('box' in it ? it.box.w : 0) * last.values.scaleX) / 2).toBeLessThan(0.5);
				else expect(last.values.opacity).toBeCloseTo(0, 6);
				// Words don't fade on their own as well.
				if ('text' in it) expect(it.exitFade).toBe(false);
				checked++;
			}
		});
		// "Italian." and its bar; the kitchen's two lines; the tomato card's eight ("100%", three
		// tomatoes, "TOMATOES.", "Nothing else.", the badge and "NEW"); the split screen's five.
		expect(checked).toBe(17);
	});
});
