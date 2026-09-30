/**
 * The project format: the video's shape, pixel size and frame rate. Pure functions only.
 */

export type FormatPresetId =
	'landscape' | 'vertical' | 'square' | 'portrait' | 'classic' | 'cinematic';
export type FrameRate = 24 | 25 | 30 | 60;

export interface ProjectFormat {
	preset: FormatPresetId | 'custom';
	width: number;
	height: number;
	fps: FrameRate;
}

export interface FormatPreset {
	id: FormatPresetId;
	label: string;
	ratio: [number, number];
	/** Where it's used, in plain words. */
	hint: string;
}

export const FORMAT_PRESETS: FormatPreset[] = [
	{ id: 'landscape', label: 'Landscape', ratio: [16, 9], hint: 'YouTube' },
	{ id: 'vertical', label: 'Vertical', ratio: [9, 16], hint: 'TikTok, Reels, Shorts' },
	{ id: 'square', label: 'Square', ratio: [1, 1], hint: 'Feeds' },
	{ id: 'portrait', label: 'Portrait', ratio: [4, 5], hint: 'Instagram post' },
	{ id: 'classic', label: 'Classic', ratio: [4, 3], hint: 'Old TV, slides' },
	{ id: 'cinematic', label: 'Cinematic', ratio: [21, 9], hint: 'Widescreen film' }
];

export const RESOLUTIONS = [
	{ shortSide: 720, label: '720p' },
	{ shortSide: 1080, label: '1080p' },
	{ shortSide: 2160, label: '4K' }
] as const;

export const FRAME_RATES: FrameRate[] = [24, 25, 30, 60];

export const MIN_SIDE = 240;
export const MAX_SIDE = 4096;

export const DEFAULT_FORMAT: ProjectFormat = {
	preset: 'landscape',
	width: 1920,
	height: 1080,
	fps: 30
};

const even = (n: number) => Math.round(n / 2) * 2;

export function presetById(id: FormatPresetId): FormatPreset {
	return FORMAT_PRESETS.find((p) => p.id === id)!;
}

/**
 * Pixel size for a preset at a short-side resolution. If the long side would pass MAX_SIDE
 * (e.g. 4K cinematic), both sides shrink together to keep the shape.
 */
export function sizeFor(id: FormatPresetId, shortSide: number): { width: number; height: number } {
	const [rw, rh] = presetById(id).ratio;
	let w = rw >= rh ? (shortSide * rw) / rh : shortSide;
	let h = rw >= rh ? shortSide : (shortSide * rh) / rw;
	const over = Math.max(w, h) / MAX_SIDE;
	if (over > 1) {
		w /= over;
		h /= over;
	}
	return { width: even(w), height: even(h) };
}

/** A custom size, rounded to even numbers and kept between MIN_SIDE and MAX_SIDE. */
export function clampCustom(width: number, height: number): { width: number; height: number } {
	const c = (n: number) =>
		Math.min(MAX_SIDE, Math.max(MIN_SIDE, even(Number.isFinite(n) ? n : MIN_SIDE)));
	return { width: c(width), height: c(height) };
}

export function shortSide(f: Pick<ProjectFormat, 'width' | 'height'>): number {
	return Math.min(f.width, f.height);
}

export function formatRatio(f: Pick<ProjectFormat, 'width' | 'height'>): number {
	return f.width / f.height;
}

/** Which of 720p / 1080p / 4K a preset format is at, if any. */
export function resolutionOf(f: ProjectFormat): number | null {
	if (f.preset === 'custom') return null;
	const preset = f.preset;
	return (
		RESOLUTIONS.find((r) => {
			const s = sizeFor(preset, r.shortSide);
			return s.width === f.width && s.height === f.height;
		})?.shortSide ?? null
	);
}

/** The preset whose shape matches this width and height (within 2%), if any. */
export function matchPreset(width: number, height: number): FormatPresetId | null {
	const r = width / height;
	return FORMAT_PRESETS.find((p) => Math.abs(p.ratio[0] / p.ratio[1] - r) / r < 0.02)?.id ?? null;
}

export function nearestFrameRate(fps: number): FrameRate {
	if (!(fps > 0)) return 30;
	return FRAME_RATES.reduce((best, r) => (Math.abs(r - fps) < Math.abs(best - fps) ? r : best), 30);
}

/**
 * A format that suits a clip: its shape (a preset when it matches one), a standard resolution
 * no bigger than the clip (720p / 1080p / 4K), and the nearest standard frame rate.
 */
export function formatFromClip(width: number, height: number, fps = 30): ProjectFormat {
	const short = Math.min(width, height);
	const target = short >= 2160 ? 2160 : short >= 1080 ? 1080 : 720;
	const rate = nearestFrameRate(fps);
	const preset = matchPreset(width, height);
	if (preset) return { preset, ...sizeFor(preset, target), fps: rate };
	const scale = target / short;
	return { preset: 'custom', ...clampCustom(width * scale, height * scale), fps: rate };
}

export function formatLabel(f: ProjectFormat): string {
	return `${f.width} × ${f.height} · ${f.fps} fps`;
}

/** Projects saved before formats existed only had a shape; give them 1080p at 30 fps. */
export function legacyFormat(aspect: string | undefined): ProjectFormat {
	const preset: FormatPresetId =
		aspect === '9:16' ? 'vertical' : aspect === '1:1' ? 'square' : 'landscape';
	return { preset, ...sizeFor(preset, 1080), fps: 30 };
}
