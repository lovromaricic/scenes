import { describe, expect, it } from 'vitest';
import {
	resolveTextStyle,
	SHADOW_PRESETS,
	shadowOffset,
	shadowPreset,
	shadowReach,
	STYLE_DEFAULTS,
	type TextShadow
} from './textStyle';
import { migrateProject } from './projects';
import { textCss } from '$lib/render/textCss';
import type { TextItem } from './types';

const words = (extra: Partial<TextItem> = {}): TextItem => ({
	id: 'w',
	trackId: 't',
	text: 'Hello',
	start: 0,
	duration: 3,
	x: 0.5,
	y: 0.5,
	style: 'title',
	animation: 'none',
	...extra
});

describe('text shadows', () => {
	it('each style has its own: Big title with one, Clean white without', () => {
		expect(resolveTextStyle(words({ style: 'title' })).shadow.on).toBe(true);
		expect(resolveTextStyle(words({ style: 'serif' })).shadow.on).toBe(true);
		for (const style of ['clean', 'boxed', 'outline', 'highlight'] as const)
			expect(resolveTextStyle(words({ style })).shadow.on).toBe(false);
		// Off, it still has values to start from when it's turned on (the soft preset).
		expect(shadowPreset(resolveTextStyle(words({ style: 'clean' })).shadow)).toBe('soft');
	});

	it('the words’ own shadow replaces the style’s', () => {
		const own: TextShadow = { on: true, color: '#ff0000', opacity: 0.5, blur: 0.1, distance: 0.2, angle: 180 };
		expect(resolveTextStyle(words({ style: 'clean', shadow: own })).shadow).toEqual(own);
		expect(resolveTextStyle(words({ shadow: { ...own, on: false } })).shadow.on).toBe(false);
	});

	it('offsets by distance in the angle’s direction, relative to the font size', () => {
		const s: TextShadow = { on: true, color: '#000000', opacity: 1, blur: 0, distance: 0.1, angle: 0 };
		expect(shadowOffset(s, 100)).toEqual({ x: 10, y: 0 });
		const down = shadowOffset({ ...s, angle: 90 }, 100);
		expect(down.x).toBeCloseTo(0);
		expect(down.y).toBeCloseTo(10);
		const up = shadowOffset({ ...s, angle: 270 }, 2000);
		expect(up.y).toBeCloseTo(-200); // the same look on 2000 px words
		// How far it reaches: blur (3σ) plus distance; nothing when off.
		expect(shadowReach({ ...s, blur: 0.2 }, 100)).toBeCloseTo(40);
		expect(shadowReach({ ...s, on: false }, 100)).toBe(0);
	});

	it('recognises the presets; Glow has no offset', () => {
		for (const id of ['soft', 'hard', 'long', 'glow'] as const)
			expect(shadowPreset({ on: true, ...SHADOW_PRESETS[id] })).toBe(id);
		expect(SHADOW_PRESETS.glow.distance).toBe(0);
		expect(SHADOW_PRESETS.glow.blur).toBeGreaterThan(SHADOW_PRESETS.soft.blur);
		expect(shadowPreset({ on: true, ...SHADOW_PRESETS.soft, blur: 0.3 })).toBeNull();
	});

	it('typing on the preview shows the same shadow (CSS)', () => {
		const css = textCss(words({ shadow: { on: true, color: '#336699', opacity: 0.5, blur: 0.2, distance: 0.1, angle: 0 } }), 100);
		expect(css).toContain('text-shadow: 10px 0px 20px rgba(51, 102, 153, 0.5)');
		expect(textCss(words({ style: 'clean' }), 100)).not.toContain('text-shadow');
	});

	it('older projects keep Clean white’s shadow; newer ones start without it', () => {
		const base = { id: 'p', title: 'p', scenes: [], sounds: [], library: [], createdAt: 1, updatedAt: 1 };
		const old = migrateProject({ ...base, texts: [words({ style: 'clean' }), words({ id: 'b', style: 'boxed' })] });
		expect(old.styleDefaults).toBe(STYLE_DEFAULTS);
		expect(old.texts[0].shadow).toEqual({ on: true, ...SHADOW_PRESETS.soft });
		expect(old.texts[1].shadow).toBeUndefined();
		const now = migrateProject({ ...base, styleDefaults: STYLE_DEFAULTS, texts: [words({ style: 'clean' })] });
		expect(now.texts[0].shadow).toBeUndefined();
		// Running it again changes nothing.
		expect(migrateProject(old)).toEqual(old);
	});
});
