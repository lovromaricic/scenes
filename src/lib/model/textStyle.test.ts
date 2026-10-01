import { describe, expect, it } from 'vitest';
import {
	closestFace,
	faceLabel,
	MAX_TEXT_PX,
	MIN_TEXT_PX,
	paintCss,
	parseStyleName,
	resolveTextStyle,
	sliderToTextPx,
	textPxToSlider
} from './textStyle';

describe('resolveTextStyle', () => {
	it('uses the style’s defaults', () => {
		const r = resolveTextStyle({ style: 'boxed' });
		expect(r.fill).toEqual({ color: '#ffffff', opacity: 1 });
		expect(r.box).toMatchObject({ color: '#141417', opacity: 0.88 });
		expect(r.font).toMatchObject({ family: 'Geist', weight: 600, source: 'builtin' });
	});
	it('overrides just the colours that were changed', () => {
		const r = resolveTextStyle({
			style: 'boxed',
			colors: { box: { color: '#336699', opacity: 0.5 } }
		});
		expect(r.box).toMatchObject({ color: '#336699', opacity: 0.5, padX: 0.5 });
		expect(r.fill.color).toBe('#ffffff');
	});
	it('uses the box colour for the highlighter band, and outline for Outlined', () => {
		expect(
			resolveTextStyle({ style: 'highlight', colors: { box: { color: '#00ff00', opacity: 1 } } })
				.band?.color
		).toBe('#00ff00');
		expect(
			resolveTextStyle({ style: 'outline', colors: { outline: { color: '#ff0000', width: 0.3 } } })
				.stroke
		).toEqual({
			color: '#ff0000',
			width: 0.3
		});
		// Styles without a box/outline ignore those colours.
		expect(
			resolveTextStyle({ style: 'clean', colors: { box: { color: '#000000', opacity: 1 } } }).box
		).toBeUndefined();
	});
	it('applies size and font overrides', () => {
		const r = resolveTextStyle({
			style: 'title',
			size: 0.1,
			font: { family: 'Lora', source: 'builtin', id: 'lora', weight: 700, italic: true }
		});
		expect(r.size).toBe(0.1);
		expect(r.font.family).toBe('Lora');
	});
});

describe('faces', () => {
	it('names faces', () => {
		expect(faceLabel(400, false)).toBe('Regular');
		expect(faceLabel(400, true)).toBe('Italic');
		expect(faceLabel(700, true)).toBe('Bold Italic');
		expect(faceLabel(650, false)).toBe('Semibold');
	});
	it('reads style names', () => {
		expect(parseStyleName('Bold Italic')).toEqual({ weight: 700, italic: true });
		expect(parseStyleName('SemiBold')).toEqual({ weight: 600, italic: false });
		expect(parseStyleName('Regular')).toEqual({ weight: 400, italic: false });
		expect(parseStyleName('ExtraBold Oblique')).toEqual({ weight: 800, italic: true });
		expect(parseStyleName('Light')).toEqual({ weight: 300, italic: false });
	});
	it('finds the closest face, preferring the same italic', () => {
		const faces = [
			{ weight: 400, italic: false },
			{ weight: 700, italic: false },
			{ weight: 400, italic: true }
		];
		expect(closestFace(faces, 600, false)).toEqual({ weight: 700, italic: false });
		expect(closestFace(faces, 700, true)).toEqual({ weight: 400, italic: true });
	});
	it('turns paint into CSS', () => {
		expect(paintCss({ color: '#336699', opacity: 0.5 })).toBe('rgba(51, 102, 153, 0.5)');
	});
});

describe('the text size slider (12–2000 px, curved)', () => {
	it('runs from 12 to 2000 px and back', () => {
		expect(MIN_TEXT_PX).toBe(12);
		expect(MAX_TEXT_PX).toBe(2000);
		expect(sliderToTextPx(0)).toBe(12);
		expect(sliderToTextPx(1)).toBe(2000);
		for (const px of [12, 20, 48, 120, 200, 640, 2000]) expect(sliderToTextPx(textPxToSlider(px))).toBe(px);
		expect(textPxToSlider(5000)).toBe(1);
		expect(textPxToSlider(1)).toBe(0);
	});

	it('gives the usual sizes most of the slider, in fine steps', () => {
		expect(textPxToSlider(200)).toBeGreaterThan(0.65);
		// Every step (of 1000) up to 200 px changes the size by at most 2 px.
		for (let i = 1; i <= Math.floor(textPxToSlider(200) * 1000); i++)
			expect(sliderToTextPx(i / 1000) - sliderToTextPx((i - 1) / 1000)).toBeLessThanOrEqual(2);
	});
});
