import type { AspectRatio } from '$lib/model/types';

/** The three ways to save a video, in friendly terms. */
export type PresetId = 'best' | 'social' | 'small';

export interface ExportPreset {
	id: PresetId;
	label: string;
	description: string;
	/** Pixels on the short side (1080 = "1080p"). */
	shortSide: number;
	/** Video bits per pixel per frame; sets the bitrate for any size. */
	bitsPerPixel: number;
	audioBitrate: number;
}

export const PRESETS: ExportPreset[] = [
	{
		id: 'best',
		label: 'Best quality',
		description: 'Full HD 1080p. Best for keeping and for big screens.',
		shortSide: 1080,
		bitsPerPixel: 0.19,
		audioBitrate: 192_000
	},
	{
		id: 'social',
		label: 'For social',
		description:
			'1080p in your video’s shape, with a smaller file. Ready for Instagram, TikTok or YouTube.',
		shortSide: 1080,
		bitsPerPixel: 0.09,
		audioBitrate: 128_000
	},
	{
		id: 'small',
		label: 'Small file',
		description: '720p. Quick to send in messages and email.',
		shortSide: 720,
		bitsPerPixel: 0.08,
		audioBitrate: 96_000
	}
];

export const EXPORT_FPS = 30;

export function presetById(id: PresetId): ExportPreset {
	return PRESETS.find((p) => p.id === id)!;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size for a video shape: e.g. 1080p is 1920×1080, 1080×1920 or 1080×1080. */
export function outputSize(
	aspect: AspectRatio,
	shortSide: number
): { width: number; height: number } {
	const [w, h] = aspect.split(':').map(Number);
	return w >= h
		? { width: even((shortSide * w) / h), height: even(shortSide) }
		: { width: even(shortSide), height: even((shortSide * h) / w) };
}

export function videoBitrate(
	preset: ExportPreset,
	width: number,
	height: number,
	fps = EXPORT_FPS
): number {
	return Math.round(preset.bitsPerPixel * width * height * fps);
}

/** Rough file size in bytes (encoders vary; shown as "about"). */
export function estimateBytes(preset: ExportPreset, aspect: AspectRatio, seconds: number): number {
	const { width, height } = outputSize(aspect, preset.shortSide);
	return ((videoBitrate(preset, width, height) + preset.audioBitrate) * seconds) / 8;
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
