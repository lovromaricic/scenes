import type { Crop, Size } from './crop';

/**
 * Cards: scenes with no video, just a background colour and an optional rectangle. The rectangle
 * is stored as fractions of the frame, so changing the project's format keeps its relative place
 * and size; the UI shows it in project pixels.
 */

export interface CardRect {
	color: string;
	/** Top-left corner and size, as fractions of the frame (may go past 0–1: it can overhang). */
	x: number;
	y: number;
	w: number;
	h: number;
	/** Corner rounding: 0 = square, 1 = fully rounded (radius = half the shorter side). */
	radius: number;
}

export interface CardContent {
	background: string;
	rect: CardRect | null;
}

/** Colours offered on cards: the design's ink, white and accent, plus soft neutrals and colours. */
export const CARD_COLORS: { value: string; label: string }[] = [
	{ value: '#ffffff', label: 'White' },
	{ value: '#141417', label: 'Ink' },
	{ value: '#d63f1f', label: 'Tomato' },
	{ value: '#f2f2f4', label: 'Mist' },
	{ value: '#efe6d8', label: 'Sand' },
	{ value: '#d9e4d0', label: 'Sage' },
	{ value: '#d6e4f2', label: 'Sky' },
	{ value: '#f4d9d2', label: 'Blush' },
	{ value: '#1f2a44', label: 'Navy' },
	{ value: '#25453b', label: 'Forest' }
];

export const MIN_RECT = 8;
export const CARD_SECONDS = 3;

export function defaultCard(): CardContent {
	return { background: '#141417', rect: null };
}

/** A new rectangle: centred, 60% × 30% of the frame, softly rounded, in a colour that shows. */
export function defaultRect(background: string): CardRect {
	return {
		color: background.toLowerCase() === '#d63f1f' ? '#ffffff' : '#d63f1f',
		x: 0.2,
		y: 0.35,
		w: 0.6,
		h: 0.3,
		radius: 0.2
	};
}

export function isHexColor(value: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(value.trim());
}

/** "#AbC123", "abc123" or "#abc" → "#aabbcc", or null if it isn't a colour. */
export function normalizeHex(value: string): string | null {
	let v = value.trim().toLowerCase();
	if (!v.startsWith('#')) v = `#${v}`;
	if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
	return isHexColor(v) ? v : null;
}

/** The rectangle in project pixels. */
export function rectToPixels(rect: CardRect, frame: Size): Crop {
	return {
		x: Math.round(rect.x * frame.width),
		y: Math.round(rect.y * frame.height),
		w: Math.round(rect.w * frame.width),
		h: Math.round(rect.h * frame.height)
	};
}

/** Pixels back to fractions (at least MIN_RECT pixels in each direction). */
export function rectFromPixels(rect: CardRect, px: Crop, frame: Size): CardRect {
	return {
		...rect,
		x: px.x / frame.width,
		y: px.y / frame.height,
		w: Math.max(MIN_RECT, px.w) / frame.width,
		h: Math.max(MIN_RECT, px.h) / frame.height
	};
}

/** Corner radius in pixels for a rectangle of w × h pixels. */
export function radiusPixels(radius: number, w: number, h: number): number {
	return Math.max(0, Math.min(1, radius)) * (Math.min(Math.abs(w), Math.abs(h)) / 2);
}
