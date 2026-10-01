import type { TextItem, TextStyleId } from './types';

/**
 * How text looks: the six styles as starting points, and the per-item overrides (colours,
 * opacity, outline, size, font) layered on top. Pure data and functions; the canvas renderer and
 * the CSS used while typing both read the resolved result, so they always agree.
 */

/** A colour with its own opacity (0–1). */
export interface Paint {
	color: string;
	opacity: number;
}

export interface TextColors {
	fill?: Paint;
	/** The box (Bold box) or the highlighter band (Highlighter). */
	box?: Paint;
	/** Outlined only: colour and thickness (fraction of the font size). */
	outline?: { color: string; width: number };
}

export type FontSource = 'builtin' | 'local' | 'upload';

export interface TextFont {
	/** The family name as people know it ("Lora", "Helvetica Neue", "My Font"). */
	family: string;
	source: FontSource;
	weight: number;
	italic: boolean;
	/** Built-in fonts: the catalogue id. Local and uploaded fonts: the stored face's id. */
	id: string;
}

// ─── Built-in fonts (bundled in static/fonts, SIL Open Font License) ─────────────────────

export interface BuiltinFont {
	id: string;
	family: string;
	/** What it's good for, in a few words. */
	hint: string;
	faces: { weight: number; italic: boolean }[];
}

const f = (weight: number, italic = false) => ({ weight, italic });

export const BUILTIN_FONTS: BuiltinFont[] = [
	{ id: 'geist', family: 'Geist', hint: 'Clean sans', faces: [f(400), f(600), f(700)] },
	{
		id: 'instrument-serif',
		family: 'Instrument Serif',
		hint: 'Elegant serif',
		faces: [f(400), f(400, true)]
	},
	{ id: 'oswald', family: 'Oswald', hint: 'Bold condensed', faces: [f(500), f(700)] },
	{
		id: 'nunito',
		family: 'Nunito',
		hint: 'Rounded, friendly',
		faces: [f(400), f(700), f(800), f(400, true), f(700, true)]
	},
	{
		id: 'lora',
		family: 'Lora',
		hint: 'Classic serif',
		faces: [f(400), f(700), f(400, true), f(700, true)]
	},
	{
		id: 'playfair-display',
		family: 'Playfair Display',
		hint: 'High-contrast serif',
		faces: [f(400), f(700), f(400, true), f(700, true)]
	},
	{ id: 'space-grotesk', family: 'Space Grotesk', hint: 'Quirky sans', faces: [f(400), f(700)] },
	{
		id: 'jetbrains-mono',
		family: 'JetBrains Mono',
		hint: 'Monospace',
		faces: [f(400), f(700), f(400, true)]
	},
	{ id: 'caveat', family: 'Caveat', hint: 'Handwritten', faces: [f(400), f(700)] },
	{ id: 'anton', family: 'Anton', hint: 'Heavy poster', faces: [f(400)] }
];

export function builtinFont(id: string): BuiltinFont | undefined {
	return BUILTIN_FONTS.find((b) => b.id === id);
}

// ─── Face names ──────────────────────────────────────────────────────────────────────────

const WEIGHT_NAMES: [number, string][] = [
	[100, 'Thin'],
	[200, 'Extra Light'],
	[300, 'Light'],
	[400, 'Regular'],
	[500, 'Medium'],
	[600, 'Semibold'],
	[700, 'Bold'],
	[800, 'Extra Bold'],
	[900, 'Black']
];

/** "Regular", "Bold Italic", "Light", … */
export function faceLabel(weight: number, italic: boolean): string {
	const name = WEIGHT_NAMES.reduce((best, w) =>
		Math.abs(w[0] - weight) < Math.abs(best[0] - weight) ? w : best
	)[1];
	if (italic) return name === 'Regular' ? 'Italic' : `${name} Italic`;
	return name;
}

/** Weight and italic from a style name like "Bold Italic", "SemiBold", "Black Oblique". */
export function parseStyleName(style: string): { weight: number; italic: boolean } {
	const s = style.toLowerCase().replace(/[\s_-]+/g, '');
	const italic = /italic|oblique/.test(s);
	const table: [RegExp, number][] = [
		[/thin|hairline/, 100],
		[/extralight|ultralight/, 200],
		[/light/, 300],
		[/medium/, 500],
		[/semibold|demibold/, 600],
		[/extrabold|ultrabold/, 800],
		[/bold/, 700],
		[/black|heavy/, 900]
	];
	const weight = table.find(([re]) => re.test(s))?.[1] ?? 400;
	return { weight, italic };
}

/** The face closest to the wanted weight and italic (italic matters more than weight). */
export function closestFace<T extends { weight: number; italic: boolean }>(
	faces: T[],
	weight: number,
	italic: boolean
): T | undefined {
	return [...faces].sort(
		(a, b) =>
			Number(a.italic !== italic) - Number(b.italic !== italic) ||
			Math.abs(a.weight - weight) - Math.abs(b.weight - weight)
	)[0];
}

// ─── Styles ──────────────────────────────────────────────────────────────────────────────

export interface StyleSpec {
	font: { id: string; family: string; weight: number; italic: boolean };
	/** Font size as a fraction of the frame's short side. */
	size: number;
	lineHeight: number;
	uppercase?: boolean;
	letterSpacing?: number;
	fill: Paint;
	stroke?: { color: string; width: number };
	box?: Paint & { padX: number; padY: number; radius: number };
	band?: Paint & { padX: number };
	shadow?: { color: string; blur: number; offsetY: number };
}

// These colours are part of the rendered video (content), not the interface palette.
const WHITE: Paint = { color: '#ffffff', opacity: 1 };
const INK = '#141417';
const SOFT_SHADOW = { color: 'rgba(0,0,0,0.45)', blur: 0.25, offsetY: 0.04 };
const GEIST = { id: 'geist', family: 'Geist' };
const SERIF = { id: 'instrument-serif', family: 'Instrument Serif' };

export const TEXT_STYLE_SPECS: Record<TextStyleId, StyleSpec> = {
	clean: {
		font: { ...GEIST, weight: 600, italic: false },
		size: 0.062,
		lineHeight: 1.18,
		fill: WHITE,
		shadow: SOFT_SHADOW
	},
	boxed: {
		font: { ...GEIST, weight: 600, italic: false },
		size: 0.056,
		lineHeight: 1.22,
		fill: WHITE,
		box: { color: INK, opacity: 0.88, padX: 0.5, padY: 0.28, radius: 0.22 }
	},
	serif: {
		font: { ...SERIF, weight: 400, italic: true },
		size: 0.085,
		lineHeight: 1.08,
		fill: WHITE,
		shadow: SOFT_SHADOW
	},
	outline: {
		font: { ...GEIST, weight: 600, italic: false },
		size: 0.068,
		lineHeight: 1.12,
		uppercase: true,
		letterSpacing: 0.02,
		fill: WHITE,
		stroke: { color: INK, width: 0.16 }
	},
	highlight: {
		font: { ...GEIST, weight: 600, italic: false },
		size: 0.058,
		lineHeight: 1.3,
		fill: { color: INK, opacity: 1 },
		band: { color: '#ffe14d', opacity: 1, padX: 0.28 }
	},
	title: {
		font: { ...SERIF, weight: 400, italic: true },
		size: 0.15,
		lineHeight: 1.0,
		fill: WHITE,
		shadow: SOFT_SHADOW
	}
};

/** Whether a style has a box or highlighter band (so "Box colour" applies). */
export function styleHasBox(style: TextStyleId): boolean {
	return !!(TEXT_STYLE_SPECS[style].box || TEXT_STYLE_SPECS[style].band);
}

export function styleHasOutline(style: TextStyleId): boolean {
	return !!TEXT_STYLE_SPECS[style].stroke;
}

export interface ResolvedTextStyle extends Omit<StyleSpec, 'font'> {
	font: TextFont;
}

/** A text item's style with its own colours, size and font applied on top. */
export function resolveTextStyle(
	item: Pick<TextItem, 'style' | 'font' | 'size' | 'colors'>
): ResolvedTextStyle {
	const spec = TEXT_STYLE_SPECS[item.style];
	const c = item.colors ?? {};
	const font: TextFont = item.font ?? { ...spec.font, source: 'builtin' };
	return {
		...spec,
		font,
		size: item.size ?? spec.size,
		fill: c.fill ?? spec.fill,
		box: spec.box && c.box ? { ...spec.box, ...c.box } : spec.box,
		band: spec.band && c.box ? { ...spec.band, ...c.box } : spec.band,
		stroke: spec.stroke && c.outline ? { ...c.outline } : spec.stroke
	};
}

/** The style's own colours, for the colour controls' starting values. */
export function styleColors(style: TextStyleId): Required<Pick<TextColors, 'fill'>> & TextColors {
	const s = TEXT_STYLE_SPECS[style];
	const box = s.box ?? s.band;
	return {
		fill: s.fill,
		box: box ? { color: box.color, opacity: box.opacity } : undefined,
		outline: s.stroke
	};
}

/** "#rrggbb" + opacity → a CSS colour. */
export function paintCss(p: Paint): string {
	const n = parseInt(p.color.slice(1), 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, p.opacity))})`;
}

/** Colours offered for text: white, ink, the accent, and a few that suit the design. */
export const TEXT_COLORS: { value: string; label: string }[] = [
	{ value: '#ffffff', label: 'White' },
	{ value: '#141417', label: 'Ink' },
	{ value: '#d63f1f', label: 'Tomato' },
	{ value: '#ffe14d', label: 'Highlighter' },
	{ value: '#f4d9d2', label: 'Blush' },
	{ value: '#d6e4f2', label: 'Sky' },
	{ value: '#d9e4d0', label: 'Sage' },
	{ value: '#1f2a44', label: 'Navy' },
	{ value: '#25453b', label: 'Forest' }
];

/** Size limits for the Size control, in project pixels. */
export const MIN_TEXT_PX = 12;
export const MAX_TEXT_PX = 2000;

/**
 * The size slider's curve: position 0–1 to pixels and back. Not linear, so the sizes used most
 * (about 12–200 px) take up about two thirds of the slider and stay easy to set, while the far
 * end still reaches 2000 px. (A power of the logarithm: px = MIN × (MAX/MIN)^(p^1.6).)
 */
const SIZE_CURVE = 1.6;
export function sliderToTextPx(p: number): number {
	const q = Math.min(1, Math.max(0, p));
	return Math.round(MIN_TEXT_PX * Math.pow(MAX_TEXT_PX / MIN_TEXT_PX, Math.pow(q, SIZE_CURVE)));
}
export function textPxToSlider(px: number): number {
	const v = Math.min(MAX_TEXT_PX, Math.max(MIN_TEXT_PX, px));
	return Math.pow(Math.log(v / MIN_TEXT_PX) / Math.log(MAX_TEXT_PX / MIN_TEXT_PX), 1 / SIZE_CURVE);
}
