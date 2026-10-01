import { paintCss, resolveTextStyle, shadowOffset } from '$lib/model/textStyle';
import type { TextItem } from '$lib/model/types';
import { fontString } from './fonts';

/**
 * CSS that approximates a text item's look, from the same resolved style the canvas renderer
 * uses. Used for typing on the preview and for the style picker's little previews.
 */
export function textCss(
	item: Pick<TextItem, 'style' | 'font' | 'size' | 'colors'> & Partial<Pick<TextItem, 'shadow'>>,
	fontPx: number
): string {
	const s = resolveTextStyle(item);
	const rules = [
		`font: ${fontString(s.font, fontPx)}`,
		`line-height: ${s.lineHeight}`,
		`color: ${paintCss(s.fill)}`,
		`letter-spacing: ${(s.letterSpacing ?? 0) * fontPx}px`,
		`text-transform: ${s.uppercase ? 'uppercase' : 'none'}`
	];
	if (s.shadow.on) {
		const o = shadowOffset(s.shadow, fontPx);
		rules.push(`text-shadow: ${o.x}px ${o.y}px ${s.shadow.blur * fontPx}px ${paintCss(s.shadow)}`);
	}
	if (s.stroke && s.stroke.width > 0) {
		rules.push(
			`-webkit-text-stroke: ${s.stroke.width * fontPx}px ${s.stroke.color}`,
			'paint-order: stroke fill'
		);
	}
	if (s.box) {
		rules.push(
			`background: ${paintCss(s.box)}`,
			`padding: ${s.box.padY * fontPx}px ${s.box.padX * fontPx}px`,
			`border-radius: ${s.box.radius * fontPx}px`
		);
	}
	if (s.band) {
		rules.push(
			`background: ${paintCss(s.band)}`,
			`padding: 0 ${s.band.padX * fontPx}px`,
			'box-decoration-break: clone',
			'-webkit-box-decoration-break: clone',
			`border-radius: ${fontPx * 0.12}px`
		);
	}
	return rules.join('; ');
}
