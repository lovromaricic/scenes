/** The three ways to save a video, in friendly terms. */
export type PresetId = 'best' | 'balanced' | 'small';

export interface ExportPreset {
	id: PresetId;
	label: string;
	description: string;
	/** Scale the short side down to this many pixels when the project is bigger (Small file). */
	maxShortSide?: number;
	/** Video bits per pixel per frame; sets the bitrate for any size. */
	bitsPerPixel: number;
	audioBitrate: number;
}

export const PRESETS: ExportPreset[] = [
	{
		id: 'best',
		label: 'Best quality',
		description: 'Your video’s full size, with the most detail. Best for keeping and big screens.',
		bitsPerPixel: 0.19,
		audioBitrate: 192_000
	},
	{
		id: 'balanced',
		label: 'Balanced',
		description:
			'Your video’s full size in about half the space. Great for YouTube, Instagram or TikTok.',
		bitsPerPixel: 0.09,
		audioBitrate: 128_000
	},
	{
		id: 'small',
		label: 'Small file',
		description: 'Up to 720p and a light file. Quick to send in messages and email.',
		maxShortSide: 720,
		bitsPerPixel: 0.08,
		audioBitrate: 96_000
	}
];

/** The frame rate bitrates are tuned for; higher rates need proportionally a little less per frame. */
const BASE_FPS = 30;

export function presetById(id: PresetId): ExportPreset {
	return PRESETS.find((p) => p.id === id)!;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Output size for a preset: the project's own size, except "Small file", which scales the short
 * side down to the preset's size if the project is bigger (never up).
 */
export function outputSize(
	format: { width: number; height: number },
	preset: Pick<ExportPreset, 'maxShortSide'>
): { width: number; height: number } {
	const short = Math.min(format.width, format.height);
	const scale = preset.maxShortSide ? Math.min(1, preset.maxShortSide / short) : 1;
	return { width: even(format.width * scale), height: even(format.height * scale) };
}

export function videoBitrate(
	preset: ExportPreset,
	width: number,
	height: number,
	fps = BASE_FPS
): number {
	// Consecutive frames are more alike at higher frame rates, so bitrate grows less than linearly.
	return Math.round(
		preset.bitsPerPixel * width * height * BASE_FPS * Math.pow(fps / BASE_FPS, 0.7)
	);
}

/** Rough file size in bytes (encoders vary; shown as "about"). */
export function estimateBytes(
	preset: ExportPreset,
	format: { width: number; height: number; fps: number },
	seconds: number
): number {
	const { width, height } = outputSize(format, preset);
	return ((videoBitrate(preset, width, height, format.fps) + preset.audioBitrate) * seconds) / 8;
}

export function formatBytes(bytes: number): string {
	const mb = bytes / 1_000_000;
	if (mb < 1) return 'under 1 MB';
	if (mb < 10) return `${mb.toFixed(1)} MB`;
	if (mb < 1000) return `${Math.round(mb)} MB`;
	return `${(mb / 1000).toFixed(1)} GB`;
}

/** Friendly time left, from progress (0–1) and seconds elapsed so far. */
export function formatTimeLeft(progress: number, elapsed: number): string {
	if (progress < 0.03 || elapsed < 1.5) return 'Working out how long this takes…';
	const left = (elapsed / progress) * (1 - progress);
	if (left < 10) return progress > 0.85 ? 'Almost done' : 'A few seconds left';
	if (left < 60) return `About ${Math.max(10, Math.round(left / 5) * 5)} seconds left`;
	const minutes = Math.round(left / 60);
	return minutes <= 1 ? 'About a minute left' : `About ${minutes} minutes left`;
}

/** A safe file name from the video title. */
export function exportFileName(title: string, extension: 'mp4' | 'webm'): string {
	const clean = Array.from(title)
		.filter((ch) => ch.charCodeAt(0) >= 32)
		.join('')
		.replace(/[\\/:*?"<>|]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80);
	return `${clean || 'My video'}.${extension}`;
}
