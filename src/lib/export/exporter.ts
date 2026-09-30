import {
	AudioBufferSource,
	BufferTarget,
	CanvasSource,
	canEncodeAudio,
	canEncodeVideo,
	Mp4OutputFormat,
	Output,
	StreamTarget,
	WebMOutputFormat,
	type Target
} from 'mediabunny';
import { mixdown } from '$lib/audio/mixdown';
import { projectAudioClips } from '$lib/audio/clips';
import { getHandle } from '$lib/media/handles';
import { compose } from '$lib/model/composition';
import type { SourceBounds } from '$lib/model/edits';
import { placeScenes, type PlacedScene } from '$lib/model/timeline';
import type { Project, Scene } from '$lib/model/types';
import { Compositor, type CompositeFrame } from '$lib/render/compositor';
import { layerInput, textDrawsAt } from '$lib/render/frame';
import { loadTextFonts, TextSpriteCache } from '$lib/render/text';
import { EXPORT_FPS, exportFileName, outputSize, videoBitrate, type ExportPreset } from './presets';
import { PhotoExportReader, VideoExportReader, type ExportFrameReader } from './reader';

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
	hasAudio: (mediaId: string) => boolean;
	onProgress?: (p: ExportProgress) => void;
	signal?: AbortSignal;
	/** Force a format (tests); otherwise chosen automatically. */
	format?: ExportFormat;
}

export interface ExportResult {
	file: File;
	name: string;
	format: ExportFormat;
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

export async function exportVideo(request: ExportRequest): Promise<ExportResult> {
	const { project, preset, signal } = request;
	const placed = placeScenes(project.scenes);
	const duration = placed.at(-1)?.end ?? 0;
	if (duration <= 0) throw new ExportError('Add at least one photo or video before saving.');

	const { width, height } = outputSize(project.format, preset);
	const bitrate = videoBitrate(preset, width, height);
	const format = request.format ?? (await chooseFormat(width, height, bitrate));
	const started = performance.now();
	const elapsed = () => (performance.now() - started) / 1000;

	await loadTextFonts();
	const { target, finish, discard } = await openTarget(format.container);
	const output = new Output({
		format:
			format.container === 'mp4'
				? new Mp4OutputFormat({ fastStart: false })
				: new WebMOutputFormat(),
		target
	});

	const canvas = new OffscreenCanvas(width, height);
	const compositor = new Compositor(canvas);
	const sprites = new TextSpriteCache();
	const videoSource = new CanvasSource(canvas, {
		codec: format.videoCodec,
		bitrate,
		keyFrameInterval: 2,
		latencyMode: 'quality'
	});
	const audioSource = new AudioBufferSource({
		codec: format.audioCodec,
		bitrate: preset.audioBitrate
	});
	output.addVideoTrack(videoSource, { frameRate: EXPORT_FPS });
	output.addAudioTrack(audioSource);

	const readers = new Map<string, Promise<ExportFrameReader>>();
	const readerFor = (scene: Scene) => {
		let r = readers.get(scene.id);
		if (!r) {
			r = getHandle(scene.mediaId).then((h) =>
				h.info.kind === 'photo'
					? new PhotoExportReader(h, width, height)
					: new VideoExportReader(h, width, height)
			);
			readers.set(scene.id, r);
		}
		return r;
	};
	const layer = async (ref: { placed: PlacedScene; sourceTime: number } | null) => {
		if (!ref) return null;
		const frame = await (await readerFor(ref.placed.scene)).frameAt(ref.sourceTime);
		return frame ? layerInput(frame, ref.placed.scene, project.mood, width, height) : null;
	};

	const clips = projectAudioClips(project, request.hasAudio);
	const totalFrames = Math.max(1, Math.round(duration * EXPORT_FPS));
	let audioUntil = 0;

	const checkAbort = () => {
		if (signal?.aborted) throw new DOMException('Saving was cancelled', 'AbortError');
	};

	try {
		await output.start();
		for (let i = 0; i < totalFrames; i++) {
			checkAbort();
			const t = i / EXPORT_FPS;

			// Keep the soundtrack a little ahead of the picture, one short chunk at a time.
			while (audioUntil < Math.min(duration, t + AUDIO_CHUNK)) {
				const to = Math.min(duration, audioUntil + AUDIO_CHUNK);
				await audioSource.add(await mixdown(clips, audioUntil, to, SAMPLE_RATE));
				audioUntil = to;
			}

			const c = compose(placed, t, (p) => request.bounds(p.scene));
			const frame: CompositeFrame = {
				a: await layer(c.a),
				b: await layer(c.b),
				transition: c.transition,
				texts: textDrawsAt(project.texts, t, width, height, sprites)
			};
			compositor.render(frame);
			await videoSource.add(t, 1 / EXPORT_FPS);
			sprites.endFrame();

			// Scenes well behind the playhead won't be needed again: free their decoders.
			for (const p of placed) {
				if (p.end + 1.5 < t && readers.has(p.scene.id)) {
					void readers.get(p.scene.id)!.then((r) => r.dispose());
					readers.delete(p.scene.id);
				}
			}
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
		for (const r of readers.values()) void r.then((x) => x.dispose()).catch(() => {});
		compositor.dispose();
	}
}
