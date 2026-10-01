import { CanvasSink, type WrappedCanvas } from 'mediabunny';
import type { FrameResult } from '$lib/media/frames';
import type { MediaHandle } from '$lib/media/handles';

/**
 * Reads a scene's frames in order for export, at the resolution the output needs.
 * Export always moves forward in time, so a single decoder pass per scene is enough.
 */
export interface ExportFrameReader {
	frameAt(sourceTime: number): Promise<FrameResult | null>;
	/** Start decoding at `sourceTime` in the background, before it's needed. */
	prepare(sourceTime: number): void;
	dispose(): void;
}

/** Decode size that covers an output frame without upscaling the source. */
export function decodeSize(srcW: number, srcH: number, outW: number, outH: number) {
	const scale = Math.min(1, Math.max(outW / srcW, outH / srcH));
	const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
	return { width: even(srcW * scale), height: even(srcH * scale) };
}

export class VideoExportReader implements ExportFrameReader {
	private readonly sink: CanvasSink;
	private iter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
	private current: WrappedCanvas | null = null;
	private next: WrappedCanvas | null = null;
	private done = false;

	constructor(handle: MediaHandle, outW: number, outH: number) {
		const size = decodeSize(handle.info.width, handle.info.height, outW, outH);
		// No canvas pool: the sink decodes ahead, and pooled canvases could be overwritten while
		// we still hold the current frame.
		this.sink = new CanvasSink(handle.video!, { ...size, fit: 'fill', poolSize: 0 });
	}

	private async pull(): Promise<WrappedCanvas | null> {
		if (!this.iter || this.done) return null;
		const r = await this.iter.next();
		if (r.done) {
			this.done = true;
			return null;
		}
		return r.value;
	}

	/** Opening the decoder at a time, in the background (see `prepare`). */
	private opening: Promise<void> | null = null;

	private async open(t: number) {
		await this.iter?.return(undefined);
		this.iter = this.sink.canvases(t);
		this.done = false;
		this.current = await this.pull();
		this.next = await this.pull();
	}

	prepare(t: number): void {
		if (!this.iter && !this.opening) this.opening = this.open(t);
	}

	async frameAt(t: number): Promise<FrameResult | null> {
		if (this.opening) {
			await this.opening;
			this.opening = null;
		}
		if (!this.iter || (this.current && t < this.current.timestamp - 0.5)) await this.open(t);
		while (this.next && this.next.timestamp <= t + 1e-4) {
			this.current = this.next;
			this.next = await this.pull();
		}
		const c = this.current;
		return c
			? { image: c.canvas, width: c.canvas.width, height: c.canvas.height, exact: true }
			: null;
	}

	dispose(): void {
		void this.iter?.return(undefined).catch(() => {});
		this.iter = null;
	}
}

export class PhotoExportReader implements ExportFrameReader {
	private bitmap: Promise<ImageBitmap>;

	constructor(handle: MediaHandle, outW: number, outH: number) {
		const size = decodeSize(handle.info.width, handle.info.height, outW, outH);
		this.bitmap = createImageBitmap(handle.blob, {
			imageOrientation: 'from-image',
			resizeWidth: size.width,
			resizeHeight: size.height,
			resizeQuality: 'high'
		});
	}

	prepare(): void {
		void this.frameAt().catch(() => {});
	}

	async frameAt(): Promise<FrameResult> {
		const b = await this.bitmap;
		return { image: b, width: b.width, height: b.height, exact: true };
	}

	dispose(): void {
		void this.bitmap.then((b) => b.close()).catch(() => {});
	}
}
