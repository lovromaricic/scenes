import { CanvasSink, type WrappedCanvas } from 'mediabunny';
import { FrameCache } from './frameCache';
import type { MediaHandle } from './handles';

/**
 * Frame providers hand the compositor a picture for any source time, instantly.
 *
 * Video: instead of seeking a <video> element, each provider keeps a small window of decoded
 * frames around the playhead (a little behind, more ahead while playing). Asking for a time
 * outside the window restarts decoding from the nearest keyframe; until the exact frame arrives,
 * the closest cached frame is shown so scrubbing never goes blank.
 */

export type FrameImage = HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

export interface FrameResult {
	image: FrameImage;
	width: number;
	height: number;
	exact: boolean;
}

export interface FrameSource {
	/** Tell the provider which source time we'll show next. Cheap; call every frame. */
	want(t: number, playing: boolean): void;
	/** The best frame available right now for source time `t`. */
	frameAt(t: number): FrameResult | null;
	/** Free decoded frames and the decoder while this source is far from the playhead. */
	idle(): void;
	dispose(): void;
}

/** Longest side of decoded preview frames. Export decodes at full size separately. */
export const PREVIEW_MAX_SIZE = 1280;

const MAX_CACHED_FRAMES = 90;
/** Jumping further ahead than this restarts decoding instead of decoding through. */
const MAX_DECODE_THROUGH = 1.0;

export class VideoFrameSource implements FrameSource {
	private readonly sink: CanvasSink;
	private readonly cache = new FrameCache<FrameImage>();
	private readonly start: number;
	private readonly end: number;

	private target: number | null = null;
	private playing = false;
	private iter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
	private iterFrom = 0;
	private lastTs: number | null = null;
	private iterDone = false;
	private disposed = false;
	private running = false;
	private wake: (() => void) | null = null;

	constructor(
		handle: MediaHandle,
		private readonly onFrame: () => void,
		maxSize = PREVIEW_MAX_SIZE
	) {
		const track = handle.video!;
		const { width: w, height: h } = handle.info;
		const scale = Math.min(1, maxSize / Math.max(w, h));
		this.sink = new CanvasSink(track, {
			width: Math.max(2, Math.round((w * scale) / 2) * 2),
			height: Math.max(2, Math.round((h * scale) / 2) * 2),
			fit: 'fill',
			poolSize: 0
		});
		this.start = handle.info.startTime;
		this.end = handle.info.duration;
	}

	private clamp(t: number): number {
		return Math.min(this.end - 1e-3, Math.max(this.start, t));
	}

	want(t: number, playing: boolean): void {
		const clamped = this.clamp(t);
		if (clamped === this.target && playing === this.playing) return;
		this.target = clamped;
		this.playing = playing;
		this.wake?.();
		if (!this.running) void this.run();
	}

	frameAt(t: number): FrameResult | null {
		const hit = this.cache.lookup(this.clamp(t));
		if (!hit) return null;
		const { image } = hit.frame;
		return { image, width: image.width, height: image.height, exact: hit.exact };
	}

	idle(): void {
		this.target = null;
		this.closeIterator();
		this.cache.clear();
	}

	dispose(): void {
		this.disposed = true;
		this.idle();
		this.wake?.();
	}

	private window(t: number): [number, number] {
		return this.playing ? [t - 0.1, t + 1.5] : [t - 0.6, t + 0.8];
	}

	private closeIterator() {
		const it = this.iter;
		this.iter = null;
		this.lastTs = null;
		this.iterDone = false;
		void it?.return(undefined).catch(() => {});
	}

	private restart(from: number) {
		this.closeIterator();
		this.iterFrom = Math.max(this.start, from);
		this.iter = this.sink.canvases(this.iterFrom);
	}

	private sleep(): Promise<void> {
		return new Promise((resolve) => (this.wake = resolve));
	}

	private async run() {
		this.running = true;
		try {
			while (!this.disposed) {
				const t = this.target;
				if (t === null) {
					await this.sleep();
					continue;
				}
				const [lo, hi] = this.window(t);
				const covered = this.cache.covers(t, Math.min(t + 0.02, this.end));
				const head = this.lastTs ?? this.iterFrom;
				const upcoming =
					this.iter !== null &&
					!this.iterDone &&
					t >= head - 1e-3 &&
					t <= head + MAX_DECODE_THROUGH;
				if (!covered && !upcoming) this.restart(t - (this.playing ? 0 : 0.5));

				const aheadTo = Math.min(hi, this.end - 1e-3);
				if (this.iter === null || this.iterDone || this.cache.covers(t, aheadTo)) {
					await this.sleep();
					continue;
				}

				const iter = this.iter;
				let result: IteratorResult<WrappedCanvas, void>;
				try {
					result = await iter.next();
				} catch (error) {
					if (this.iter === iter) {
						console.warn('Decoding stopped', error);
						this.iterDone = true;
					}
					continue;
				}
				// The iterator may have been replaced while we waited; drop stale results.
				if (this.iter !== iter || this.disposed) continue;
				if (result.done) {
					this.iterDone = true;
					continue;
				}
				const { canvas, timestamp, duration } = result.value;
				this.cache.insert({ timestamp, duration: duration || 1 / 30, image: canvas });
				this.lastTs = timestamp;
				const now = this.target ?? t;
				const [wlo, whi] = this.window(now);
				this.cache.evictOutside(Math.min(wlo, lo) - 0.2, Math.max(whi, hi) + 0.2);
				this.cache.trimAround(now, MAX_CACHED_FRAMES);
				this.onFrame();
			}
		} finally {
			this.running = false;
		}
	}
}

/** Photos decode once into a bitmap and show the same picture at every time. */
export class PhotoFrameSource implements FrameSource {
	private bitmap: ImageBitmap | null = null;
	private loading: Promise<void> | null = null;
	private disposed = false;

	constructor(
		private readonly handle: MediaHandle,
		private readonly onFrame: () => void,
		private readonly maxSize = PREVIEW_MAX_SIZE
	) {}

	want(): void {
		if (this.bitmap || this.loading) return;
		this.loading = this.load();
	}

	private async load() {
		const { width, height } = this.handle.info;
		const scale = Math.min(1, this.maxSize / Math.max(width, height));
		const bitmap = await createImageBitmap(this.handle.blob, {
			imageOrientation: 'from-image',
			resizeWidth: Math.max(1, Math.round(width * scale)),
			resizeHeight: Math.max(1, Math.round(height * scale)),
			resizeQuality: 'high'
		});
		if (this.disposed) {
			bitmap.close();
			return;
		}
		this.bitmap = bitmap;
		this.onFrame();
	}

	frameAt(): FrameResult | null {
		const b = this.bitmap;
		return b ? { image: b, width: b.width, height: b.height, exact: true } : null;
	}

	idle(): void {
		// A single bitmap is cheap to keep; photos stay loaded.
	}

	dispose(): void {
		this.disposed = true;
		this.bitmap?.close();
		this.bitmap = null;
	}
}
