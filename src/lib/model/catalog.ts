import type { AspectRatio, MoodId, TextAnimation, TextStyleId, TransitionKind } from './types';

export interface MoodInfo {
	id: MoodId;
	label: string;
	description: string;
	/** CSS token used to draw its swatch. */
	swatch: string;
}

export const MOODS: MoodInfo[] = [
	{
		id: 'natural',
		label: 'Natural',
		description: 'Colours as filmed',
		swatch: 'var(--mood-natural)'
	},
	{
		id: 'golden',
		label: 'Golden',
		description: 'Warm, late-afternoon light',
		swatch: 'var(--mood-golden)'
	},
	{
		id: 'faded',
		label: 'Faded',
		description: 'Soft and a little washed out',
		swatch: 'var(--mood-faded)'
	},
	{ id: 'cool', label: 'Cool', description: 'Calm blue tones', swatch: 'var(--mood-cool)' },
	{
		id: 'punchy',
		label: 'Punchy',
		description: 'Bold, saturated colour',
		swatch: 'var(--mood-punchy)'
	},
	{ id: 'mono', label: 'B & W', description: 'Black and white', swatch: 'var(--mood-mono)' }
];

export interface TransitionInfo {
	id: TransitionKind;
	label: string;
	description: string;
}

export const TRANSITIONS: TransitionInfo[] = [
	{ id: 'cut', label: 'Cut', description: 'Jump straight to the next scene' },
	{ id: 'crossfade', label: 'Crossfade', description: 'Blend smoothly into the next scene' },
	{ id: 'fade-black', label: 'Fade to black', description: 'Dip to black, then fade back in' },
	{ id: 'slide', label: 'Slide', description: 'The next scene slides in from the right' },
	{ id: 'zoom', label: 'Zoom', description: 'Zoom through into the next scene' }
];

export interface TextStyleInfo {
	id: TextStyleId;
	label: string;
}

export const TEXT_STYLES: TextStyleInfo[] = [
	{ id: 'clean', label: 'Clean white' },
	{ id: 'boxed', label: 'Bold box' },
	{ id: 'serif', label: 'Serif italic' },
	{ id: 'outline', label: 'Outlined' },
	{ id: 'highlight', label: 'Highlighter' },
	{ id: 'title', label: 'Big title' }
];

export interface TextAnimationInfo {
	id: TextAnimation;
	label: string;
}

export const TEXT_ANIMATIONS: TextAnimationInfo[] = [
	{ id: 'none', label: 'None' },
	{ id: 'fade', label: 'Fade' },
	{ id: 'slide-up', label: 'Slide up' },
	{ id: 'pop', label: 'Pop' }
];

export const ASPECTS: { id: AspectRatio; label: string; ratio: number }[] = [
	{ id: '16:9', label: '16:9', ratio: 16 / 9 },
	{ id: '9:16', label: '9:16', ratio: 9 / 16 },
	{ id: '1:1', label: '1:1', ratio: 1 }
];

export function aspectRatioValue(aspect: AspectRatio): number {
	return ASPECTS.find((a) => a.id === aspect)?.ratio ?? 16 / 9;
}

export const SPEEDS = [
	{ value: 0.5, label: '0.5×', description: 'Slow motion' },
	{ value: 1, label: '1×', description: 'Normal speed' },
	{ value: 2, label: '2×', description: 'Twice as fast' }
] as const;
