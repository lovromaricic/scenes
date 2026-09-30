import type { TextStyleId } from '$lib/model/types';
import { fontFor, TEXT_STYLE_SPECS } from './text';

/**
 * CSS that approximates a text style, generated from the same spec the canvas renderer uses.
 * Used for typing on the preview and for the style picker's little previews.
 */
export function textCss(style: TextStyleId, fontPx: number): string {
	const s = TEXT_STYLE_SPECS[style];
	const rules = [
		`font: ${fontFor(style, fontPx)}`,
		`line-height: ${s.lineHeight}`,
		`color: ${s.fill}`,
		`letter-spacing: ${(s.letterSpacing ?? 0) * fontPx}px`,
		`text-transform: ${s.uppercase ? 'uppercase' : 'none'}`
	];
	if (s.shadow) {
		rules.push(
			`text-shadow: 0 ${s.shadow.offsetY * fontPx}px ${s.shadow.blur * fontPx}px ${s.shadow.color}`
		);
	}
	if (s.stroke) {
		rules.push(
			`-webkit-text-stroke: ${s.stroke.width * fontPx}px ${s.stroke.color}`,
			'paint-order: stroke fill'
		);
	}
	if (s.box) {
		rules.push(
			`background: ${s.box.color}`,
			`padding: ${s.box.padY * fontPx}px ${s.box.padX * fontPx}px`,
			`border-radius: ${s.box.radius * fontPx}px`
		);
	}
	if (s.band) {
		rules.push(
			`background: ${s.band.color}`,
			`padding: 0 ${s.band.padX * fontPx}px`,
			'box-decoration-break: clone',
			'-webkit-box-decoration-break: clone',
			`border-radius: ${fontPx * 0.12}px`
		);
	}
	return rules.join('; ');
}
