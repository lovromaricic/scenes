import {
	AudioBufferSource,
	BufferTarget,
	CanvasSource,
	canEncodeAudio,
	canEncodeVideo,
	Mp3OutputFormat,
	Mp4OutputFormat,
	Output,
	WavOutputFormat,
	StreamTarget,
	WebMOutputFormat,
	type Target
} from 'mediabunny';
import { mixdown } from '$lib/audio/mixdown';
import { projectAudioClips } from '$lib/audio/clips';
import type { SourceBounds } from '$lib/model/edits';
import { placeScenes } from '$lib/model/timeline';
import type { Project, Scene } from '$lib/model/types';
import { exportFileName, outputSize, videoBitrate, type ExportPreset } from './presets';
import { FrameRenderer } from './renderer';
import { GifWriter, gifSize, muxAnimatedWebp } from './gif';

/**
 * Saves the project as a video file, frame by frame through the same compositor as the preview.
 * Everything streams: frames are decoded, drawn, encoded and written one at a time, sound is mixed
 * in short chunks, and the file is written to the browser's private disk storage (OPFS) as it
 * grows, so long videos don't run out of memory.
 */

export class ExportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ExportError';
	}
}

export interface ExportFormat {
	container: 'mp4' | 'webm';
	videoCodec: 'avc' | 'vp9';
	audioCodec: 'aac' | 'opus';
	/** True when MP4/H.264 wasn't available and WebM is used instead. */
	fallback: boolean;
}

const SAMPLE_RATE = 48000;
const AUDIO_CHUNK = 2;

/** Pick MP4 (H.264 + AAC) if this browser can encode it, else WebM (VP9 + Opus). */
export async function chooseFormat(
	width: number,
	height: number,
	bitrate: number
): Promise<ExportFormat> {
	const audioOptions = { numberOfChannels: 2, sampleRate: SAMPLE_RATE };
	// Debug/test switch to exercise the WebM fallback on browsers that do support MP4.
	const forceWebM = (() => {
		try {
			return localStorage.getItem('scenes:force-webm') === '1';
		} catch {
			return false;
		}
	})();
	const [avc, aac] = await Promise.all([
		canEncodeVideo('avc', { width, height, bitrate }),
		canEncodeAudio('aac', audioOptions)
	]);
	if (avc && aac && !forceWebM)
		return { container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', fallback: false };
	const [vp9, opus] = await Promise.all([
		canEncodeVideo('vp9', { width, height, bitrate }),
		canEncodeAudio('opus', audioOptions)
	]);
	if (vp9 && opus)
		return { container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', fallback: true };
	throw new ExportError(
		'This browser can’t make video files. Please use the latest Chrome or Edge.'
	);
}

export interface ExportProgress {
	/** 0–1 */
	progress: number;
	/** Seconds since the export started. */
	elapsed: number;
}

export interface ExportRequest {
	project: Project;
	preset: ExportPreset;
	bounds: (scene: Scene) => SourceBounds;
	/** A file's own picture size (crops are measured in it). */
	sourceSize: (mediaId: string) => { width: number; height: number } | null;
	hasAudio: (mediaId: string) => boolean;
	onProgress?: (p: ExportProgress) => void;
	signal?: AbortSignal;
	/** Force a format (tests); otherwise chosen automatically. */
	format?: ExportFormat;
	/** Only this part of the video (default: all of it). */
	range?: ExportRange | null;
}

export interface ExportResult {
	file: File;
	name: string;
	/** Video files: the container and codecs used. */
	format?: ExportFormat;
	width: number;
	height: number;
}

const EXPORT_PREFIX = 'scenes-export-';

/** Where the file is written: a file in OPFS when available (disk-backed), otherwise memory. */
async function openTarget(
	ext: string
): Promise<{ target: Target; finish: () => Promise<File>; discard: () => Promise<void> }> {
	try {
		const root = await navigator.storage.getDirectory();
		// Remove earlier exports; only the latest one is kept (so its download link keeps working).
		for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
			if (name.startsWith(EXPORT_PREFIX)) await root.removeEntry(name).catch(() => {});
		}
		const name = `${EXPORT_PREFIX}${Date.now()}.${ext}`;
		const handle = await root.getFileHandle(name, { create: true });
		const writable = await handle.createWritable();
		return {
			target: new StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
			finish: () => handle.getFile(),
			discard: async () => {
				await writable.abort().catch(() => {});
				await root.removeEntry(name).catch(() => {});
			}
		};
	} catch {
		const target = new BufferTarget();
		return {
			target,
			finish: async () => new File([target.buffer!], `export.${ext}`),
			discard: async () => {}
		};
	}
}

/** The part of the video to save, in timeline seconds (default: all of it). */
export interface ExportRange {
	start: number;
	end: number;
}

/** The range to save, kept within the video (the whole video when none is given). */
export function exportRange(duration: number, range?: ExportRange | null): ExportRange {
	if (!range) return { start: 0, end: duration };
	const start = Math.max(0, Math.min(duration, range.start));
	const end = Math.max(start, Math.min(duration, range.end));
	return { start, end };
}

export async function exportVideo(request: ExportRequest): Promise<ExportResult> {
	const { project, preset, signal } = request;
	const duration = placeScenes(project.scenes).at(-1)?.end ?? 0;
	if (duration <= 0) throw new ExportError('Add at least one photo or video before saving.');
	const range = exportRange(duration, request.range);
	const length = range.end - range.start;
	if (length <= 0) throw new ExportError('The range is empty. Set its start (I) before its end (O).');

	const { width, height } = outputSize(project.format, preset);
	const fps = project.format.fps;
	const bitrate = videoBitrate(preset, width, height, fps);
	const format = request.format ?? (await chooseFormat(width, height, bitrate));
	const started = performance.now();
	const elapsed = () => (performance.now() - started) / 1000;

	const renderer = new FrameRenderer({
		project,
		width,
		height,
		bounds: request.bounds,
		sourceSize: request.sourceSize
	});
	await renderer.ready();
	const { target, finish, discard } = await openTarget(format.container);
	const output = new Output({
		format:
			format.container === 'mp4'
				? new Mp4OutputFormat({ fastStart: false })
				: new WebMOutputFormat(),
		target
	});
	const videoSource = new CanvasSource(renderer.canvas, {
		codec: format.videoCodec,
		bitrate,
		keyFrameInterval: 2,
		latencyMode: 'quality'
	});
	const audioSource = new AudioBufferSource({
		codec: format.audioCodec,
		bitrate: preset.audioBitrate
	});
	output.addVideoTrack(videoSource, { frameRate: fps });
	output.addAudioTrack(audioSource);

	const clips = projectAudioClips(project, request.hasAudio);
	const totalFrames = Math.max(1, Math.round(length * fps));
	let audioUntil = range.start;

	const checkAbort = () => {
		if (signal?.aborted) throw new DOMException('Saving was cancelled', 'AbortError');
	};

	try {
		await output.start();
		for (let i = 0; i < totalFrames; i++) {
			checkAbort();
			// Timeline time of this frame; the file's own time starts at 0.
			const local = i / fps;
			const t = range.start + local;

			// Keep the soundtrack a little ahead of the picture, one short chunk at a time.
			while (audioUntil < Math.min(range.end, t + AUDIO_CHUNK)) {
				const to = Math.min(range.end, audioUntil + AUDIO_CHUNK);
				await audioSource.add(await mixdown(clips, audioUntil, to, SAMPLE_RATE));
				audioUntil = to;
			}

			await renderer.render(t);
			await videoSource.add(local, 1 / fps);
			if (i % 5 === 0) request.onProgress?.({ progress: i / totalFrames, elapsed: elapsed() });
		}
		checkAbort();
		await output.finalize();
		request.onProgress?.({ progress: 1, elapsed: elapsed() });
		const file = await finish();
		return { file, name: exportFileName(project.title, format.container), format, width, height };
	} catch (error) {
		await output.cancel().catch(() => {});
		await discard();
		throw error;
	} finally {
		renderer.dispose();
	}
}

// ─── Current frame ─────────────────────────────────────────────────────────────────────────

export type FrameFormat = 'png' | 'jpg';

export interface FrameRequest {
	project: Project;
	/** Timeline time of the frame. */
	time: number;
	format: FrameFormat;
	/** JPG quality, 0–1. */
	quality?: number;
	bounds: (scene: Scene) => SourceBounds;
	sourceSize: (mediaId: string) => { width: number; height: number } | null;
}

/**
 * One frame as a picture, at the project's own size, drawn exactly as the video export draws that
 * moment (the same renderer).
 */
export async function exportFrame(request: FrameRequest): Promise<ExportResult> {
	const { project } = request;
	const duration = placeScenes(project.scenes).at(-1)?.end ?? 0;
	if (duration <= 0) throw new ExportError('Add at least one photo or video before saving a frame.');
	const { width, height } = project.format;
	// The very end of the video shows its last frame.
	const t = Math.max(0, Math.min(request.time, duration - 1 / project.format.fps));
	const renderer = new FrameRenderer({ project, width, height, bounds: request.bounds, sourceSize: request.sourceSize });
	try {
		await renderer.ready();
		await renderer.render(t);
		const blob = await renderer.canvas.convertToBlob(
			request.format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: request.quality ?? 0.9 }
		);
		const name = frameFileName(project.title, t, request.format);
		return {
			file: new File([blob], name, { type: blob.type }),
			name,
			width,
			height
		};
	} finally {
		renderer.dispose();
	}
}

/** "Summer trip 0-03.20.png": the title and the moment (no characters files can't have). */
export function frameFileName(title: string, t: number, format: FrameFormat): string {
	const base = exportFileName(title, 'mp4').replace(/\.mp4$/, '');
	const m = Math.floor(t / 60);
	const s = t - m * 60;
	const stamp = `${m}-${s.toFixed(2).padStart(5, '0')}`;
	return `${base} ${stamp}.${format}`;
}

// ─── Audio only ────────────────────────────────────────────────────────────────────────────

export type AudioFormat = 'wav' | 'm4a' | 'mp3';
export const AUDIO_BITRATES = [128_000, 192_000, 320_000] as const;

export interface AudioRequest {
	project: Project;
	format: AudioFormat;
	/** M4A and MP3 (bits per second). */
	bitrate?: number;
	range?: ExportRange | null;
	hasAudio: (mediaId: string) => boolean;
	onProgress?: (p: ExportProgress) => void;
	signal?: AbortSignal;
}

let mp3Registered: Promise<void> | null = null;
/** MP3: browsers don't encode it, so Mediabunny's LAME (WebAssembly) encoder is loaded once. */
function ensureMp3Encoder(): Promise<void> {
	mp3Registered ??= (async () => {
		if (await canEncodeAudio('mp3')) return;
		const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
		registerMp3Encoder();
	})();
	return mp3Registered;
}

/** Whether this browser can save audio in a format (WAV always; M4A needs an AAC encoder). */
export async function canSaveAudio(format: AudioFormat): Promise<boolean> {
	if (format === 'wav' || format === 'mp3') return true;
	return canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: SAMPLE_RATE, bitrate: 128_000 });
}

/** Rough size in bytes of audio saved for `seconds`. */
export function estimateAudioBytes(format: AudioFormat, seconds: number, bitrate = 192_000): number {
	return format === 'wav' ? seconds * SAMPLE_RATE * 2 * 2 : (bitrate * seconds) / 8;
}

/**
 * Just the sound, from the same mix as the video export (scene sound, layers with sound, music,
 * voiceovers, their volumes, fades and volume points), as WAV (16-bit), M4A (AAC) or MP3.
 */
export async function exportAudio(request: AudioRequest): Promise<ExportResult> {
	const { project, format, signal } = request;
	const duration = placeScenes(project.scenes).at(-1)?.end ?? 0;
	if (duration <= 0) throw new ExportError('Add at least one photo or video before saving.');
	const range = exportRange(duration, request.range);
	const length = range.end - range.start;
	if (length <= 0) throw new ExportError('The range is empty. Set its start (I) before its end (O).');
	if (format === 'm4a' && !(await canSaveAudio('m4a')))
		throw new ExportError('This browser can’t make M4A files. Try WAV or MP3.');
	if (format === 'mp3') await ensureMp3Encoder();

	const started = performance.now();
	const elapsed = () => (performance.now() - started) / 1000;
	const { target, finish, discard } = await openTarget(format);
	const output = new Output({
		format:
			format === 'wav'
				? new WavOutputFormat()
				: format === 'mp3'
					? new Mp3OutputFormat()
					: new Mp4OutputFormat({ fastStart: false }),
		target
	});
	const source = new AudioBufferSource(
		format === 'wav'
			? { codec: 'pcm-s16' }
			: { codec: format === 'mp3' ? 'mp3' : 'aac', bitrate: request.bitrate ?? 192_000 }
	);
	output.addAudioTrack(source);
	const clips = projectAudioClips(project, request.hasAudio);
	try {
		await output.start();
		for (let from = range.start; from < range.end - 1e-6; from += AUDIO_CHUNK) {
			if (signal?.aborted) throw new DOMException('Saving was cancelled', 'AbortError');
			const to = Math.min(range.end, from + AUDIO_CHUNK);
			await source.add(await mixdown(clips, from, to, SAMPLE_RATE));
			request.onProgress?.({ progress: (to - range.start) / length, elapsed: elapsed() });
		}
		await output.finalize();
		const file = await finish();
		const name = exportFileName(project.title, format);
		return { file: new File([file], name, { type: output.format.mimeType }), name, width: 0, height: 0 };
	} catch (error) {
		await output.cancel().catch(() => {});
		await discard();
		throw error;
	}
}

// ─── GIF and animated WebP ─────────────────────────────────────────────────────────────────

export interface GifRequest {
	project: Project;
	/** 'gif', or 'webp' for animated WebP. */
	format: 'gif' | 'webp';
	/** Width in pixels (the height keeps the video's shape). */
	width: number;
	fps: number;
	loop: boolean;
	/** GIF only: Floyd–Steinberg dithering. */
	dither: boolean;
	range?: ExportRange | null;
	bounds: (scene: Scene) => SourceBounds;
	sourceSize: (mediaId: string) => { width: number; height: number } | null;
	onProgress?: (p: ExportProgress) => void;
	signal?: AbortSignal;
}

/** An animated GIF (or WebP) of the video or its range, drawn like the video export. */
export async function exportGif(request: GifRequest): Promise<ExportResult> {
	const { project, signal } = request;
	const duration = placeScenes(project.scenes).at(-1)?.end ?? 0;
	if (duration <= 0) throw new ExportError('Add at least one photo or video before saving.');
	const range = exportRange(duration, request.range);
	const length = range.end - range.start;
	if (length <= 0) throw new ExportError('The range is empty. Set its start (I) before its end (O).');
	const { width, height } = gifSize(project.format, request.width);
	const renderer = new FrameRenderer({ project, width, height, bounds: request.bounds, sourceSize: request.sourceSize });
	// The WebGL picture is read back through a 2D canvas.
	const readback = new OffscreenCanvas(width, height);
	const ctx = readback.getContext('2d', { willReadFrequently: true })!;
	const frames = Math.max(1, Math.round(length * request.fps));
	const started = performance.now();
	const gif = request.format === 'gif' ? new GifWriter(width, height, request.fps, request.loop, request.dither) : null;
	const webp: Uint8Array[] = [];
	try {
		await renderer.ready();
		for (let i = 0; i < frames; i++) {
			if (signal?.aborted) throw new DOMException('Saving was cancelled', 'AbortError');
			await renderer.render(range.start + i / request.fps);
			if (gif) {
				ctx.drawImage(renderer.canvas, 0, 0);
				gif.add(ctx.getImageData(0, 0, width, height).data);
			} else {
				const blob = await renderer.canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
				webp.push(new Uint8Array(await blob.arrayBuffer()));
			}
			if (i % 3 === 0)
				request.onProgress?.({ progress: i / frames, elapsed: (performance.now() - started) / 1000 });
		}
		const bytes = gif ? gif.finish() : muxAnimatedWebp(webp, width, height, 1000 / request.fps, request.loop);
		const name = exportFileName(project.title, request.format);
		const type = request.format === 'gif' ? 'image/gif' : 'image/webp';
		request.onProgress?.({ progress: 1, elapsed: (performance.now() - started) / 1000 });
		return { file: new File([bytes as BlobPart], name, { type }), name, width, height };
	} finally {
		renderer.dispose();
	}
}

// ─── Overlays only (transparent) ───────────────────────────────────────────────────────────

export type OverlaysFormat = 'webm' | 'png-zip';

export interface OverlaysRequest {
	project: Project;
	format: OverlaysFormat;
	range?: ExportRange | null;
	bounds: (scene: Scene) => SourceBounds;
	sourceSize: (mediaId: string) => { width: number; height: number } | null;
	onProgress?: (p: ExportProgress) => void;
	signal?: AbortSignal;
}

/** Bitrate for transparent WebM: generous, since the overlays are what matters. */
const OVERLAY_BITS_PER_PIXEL = 0.12;

/**
 * Whether this browser can encode VP9 with its transparency (WebM with alpha). Checked the way
 * WebCodecs asks for it: `VideoEncoder.isConfigSupported` with `alpha: 'keep'`.
 */
export async function canSaveTransparentWebm(width: number, height: number): Promise<boolean> {
	if (typeof VideoEncoder === 'undefined') return false;
	try {
		const { supported } = await VideoEncoder.isConfigSupported({
			codec: 'vp09.00.10.08',
			width,
			height,
			bitrate: Math.round(width * height * 30 * OVERLAY_BITS_PER_PIXEL),
			alpha: 'keep'
		});
		return !!supported;
	} catch {
		return false;
	}
}

/** Rough size in bytes of overlays saved for `seconds`. */
export function estimateOverlaysBytes(format: OverlaysFormat, width: number, height: number, fps: number, seconds: number): number {
	const frames = Math.max(1, Math.round(seconds * fps));
	return format === 'webm'
		? (width * height * fps * OVERLAY_BITS_PER_PIXEL * seconds) / 8
		: frames * width * height * 0.25;
}

/**
 * Only the overlay tracks and words, on a transparent background, at the project's size and frame
 * rate: a WebM (VP9 with alpha) to put over other footage, or a ZIP of PNG frames.
 */
export async function exportOverlays(request: OverlaysRequest): Promise<ExportResult> {
	const { project, format, signal } = request;
	const duration = placeScenes(project.scenes).at(-1)?.end ?? 0;
	if (duration <= 0) throw new ExportError('Add at least one photo or video before saving.');
	const range = exportRange(duration, request.range);
	const length = range.end - range.start;
	if (length <= 0) throw new ExportError('The range is empty. Set its start (I) before its end (O).');
	const { width, height, fps } = project.format;
	if (format === 'webm' && !(await canSaveTransparentWebm(width, height)))
		throw new ExportError('This browser can’t make transparent videos. Save PNG frames instead.');
	const renderer = new FrameRenderer({
		project,
		width,
		height,
		bounds: request.bounds,
		sourceSize: request.sourceSize,
		overlaysOnly: true
	});
	const frames = Math.max(1, Math.round(length * fps));
	const started = performance.now();
	const progress = (i: number) =>
		request.onProgress?.({ progress: i / frames, elapsed: (performance.now() - started) / 1000 });
	const abort = () => {
		if (signal?.aborted) throw new DOMException('Saving was cancelled', 'AbortError');
	};
	const base = exportFileName(project.title, 'x').replace(/\.x$/, '');
	try {
		await renderer.ready();
		if (format === 'png-zip') {
			const { ZipWriter, BlobWriter, BlobReader } = await import('@zip.js/zip.js');
			const zip = new ZipWriter(new BlobWriter('application/zip'));
			const digits = String(frames).length;
			for (let i = 0; i < frames; i++) {
				abort();
				await renderer.render(range.start + i / fps);
				const png = await renderer.canvas.convertToBlob({ type: 'image/png' });
				// PNGs are compressed already: stored, not deflated again.
				await zip.add(`frame_${String(i + 1).padStart(Math.max(5, digits), '0')}.png`, new BlobReader(png), { level: 0 });
				if (i % 3 === 0) progress(i);
			}
			const blob = await zip.close();
			const name = `${base} overlays.zip`;
			return { file: new File([blob], name, { type: 'application/zip' }), name, width, height };
		}
		const { target, finish, discard } = await openTarget('webm');
		const output = new Output({ format: new WebMOutputFormat(), target });
		const source = new CanvasSource(renderer.canvas, {
			codec: 'vp9',
			bitrate: Math.round(width * height * fps * OVERLAY_BITS_PER_PIXEL),
			keyFrameInterval: 2,
			alpha: 'keep'
		});
		output.addVideoTrack(source, { frameRate: fps });
		try {
			await output.start();
			for (let i = 0; i < frames; i++) {
				abort();
				await renderer.render(range.start + i / fps);
				await source.add(i / fps, 1 / fps);
				if (i % 5 === 0) progress(i);
			}
			await output.finalize();
		} catch (error) {
			await output.cancel().catch(() => {});
			await discard();
			throw error;
		}
		const file = await finish();
		const name = `${base} overlays.webm`;
		return { file: new File([file], name, { type: 'video/webm' }), name, width, height };
	} finally {
		renderer.dispose();
	}
}
