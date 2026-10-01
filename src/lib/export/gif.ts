/**
 * GIF and animated WebP from the video's frames (drawn by the same renderer as the video export).
 *
 * GIF: each frame gets its own 256-colour palette (gifenc's quantizer), with optional
 * Floyd–Steinberg dithering so gradients don't band. Animated WebP: Chrome encodes each frame as
 * a WebP picture; `muxAnimatedWebp` packs them into one animated file (better quality and smaller,
 * but not every app shows it).
 */

import { GIFEncoder, applyPalette, nearestColorIndex, quantize, type Palette } from 'gifenc';

/** Widths offered for GIFs (and the project's own). */
export const GIF_WIDTHS = [320, 480, 640] as const;
export const GIF_RATES = [10, 15, 20] as const;
/** Over these, the dialog gently suggests a shorter range or smaller size. */
export const GIF_WARN_SECONDS = 15;
export const GIF_WARN_BYTES = 20_000_000;

/** A GIF's size for a project shape at `width` (height keeps the shape). */
export function gifSize(format: { width: number; height: number }, width: number): { width: number; height: number } {
	const w = Math.max(2, Math.round(Math.min(width, format.width)));
	return { width: w, height: Math.max(2, Math.round((w * format.height) / format.width)) };
}

/** Rough size in bytes (video content compresses to about a third of a byte a pixel). */
export function estimateGifBytes(width: number, height: number, fps: number, seconds: number, dither: boolean): number {
	const frames = Math.max(1, Math.round(seconds * fps));
	return frames * width * height * (dither ? 0.5 : 0.33);
}

/**
 * Map a frame's pixels onto its palette with Floyd–Steinberg dithering (the rounding error of each
 * pixel is spread to its neighbours), using a cache of nearest colours.
 */
export function ditherToPalette(rgba: Uint8ClampedArray, width: number, height: number, palette: Palette): Uint8Array {
	const out = new Uint8Array(width * height);
	const err = new Float32Array(width * height * 3);
	const cache = new Int16Array(1 << 15).fill(-1);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const r = Math.min(255, Math.max(0, rgba[i * 4] + err[i * 3]));
			const g = Math.min(255, Math.max(0, rgba[i * 4 + 1] + err[i * 3 + 1]));
			const b = Math.min(255, Math.max(0, rgba[i * 4 + 2] + err[i * 3 + 2]));
			const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
			let idx = cache[key];
			if (idx < 0) {
				idx = nearestColorIndex(palette, [r, g, b]);
				cache[key] = idx;
			}
			out[i] = idx;
			const c = palette[idx];
			const er = r - c[0];
			const eg = g - c[1];
			const eb = b - c[2];
			const spread = (j: number, k: number) => {
				err[j * 3] += er * k;
				err[j * 3 + 1] += eg * k;
				err[j * 3 + 2] += eb * k;
			};
			if (x + 1 < width) spread(i + 1, 7 / 16);
			if (y + 1 < height) {
				if (x > 0) spread(i + width - 1, 3 / 16);
				spread(i + width, 5 / 16);
				if (x + 1 < width) spread(i + width + 1, 1 / 16);
			}
		}
	}
	return out;
}

/** Builds a GIF one frame at a time. */
export class GifWriter {
	private readonly gif = GIFEncoder();
	private first = true;

	constructor(
		private readonly width: number,
		private readonly height: number,
		private readonly fps: number,
		private readonly loop: boolean,
		private readonly dither: boolean
	) {}

	add(rgba: Uint8ClampedArray): void {
		// Every frame gets its own palette: video changes too much for one to fit all.
		const palette = quantize(rgba, 256, { format: 'rgb565' });
		const index = this.dither ? ditherToPalette(rgba, this.width, this.height, palette) : applyPalette(rgba, palette, 'rgb565');
		this.gif.writeFrame(index, this.width, this.height, {
			palette,
			delay: 1000 / this.fps,
			// Repeat: 0 = forever, −1 = once (only the first frame's setting counts).
			repeat: this.first ? (this.loop ? 0 : -1) : undefined
		});
		this.first = false;
	}

	finish(): Uint8Array {
		this.gif.finish();
		return this.gif.bytes();
	}
}

// ─── Animated WebP ─────────────────────────────────────────────────────────────────────────

/** Whether this browser can encode WebP pictures (then animated WebP can be made). */
export async function canMakeWebp(): Promise<boolean> {
	try {
		const canvas = new OffscreenCanvas(2, 2);
		// It needs a context before it can be saved.
		canvas.getContext('2d')?.fillRect(0, 0, 1, 1);
		const blob = await canvas.convertToBlob({ type: 'image/webp' });
		return blob.type === 'image/webp';
	} catch {
		return false;
	}
}

const ascii = (s: string) => new TextEncoder().encode(s);
const u24 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

/** A RIFF chunk: its four-letter id, its size, its data, and a pad byte if the size is odd. */
function chunk(id: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(8 + data.length + (data.length & 1));
	out.set(ascii(id), 0);
	out.set(u32(data.length), 4);
	out.set(data, 8);
	return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** The image chunks (ALPH and VP8 or VP8L) inside a single-picture WebP file. */
export function webpImageChunks(file: Uint8Array): { chunks: Uint8Array; alpha: boolean } {
	const text = (at: number) => String.fromCharCode(file[at], file[at + 1], file[at + 2], file[at + 3]);
	if (text(0) !== 'RIFF' || text(8) !== 'WEBP') throw new Error('Not a WebP picture');
	const parts: Uint8Array[] = [];
	let alpha = false;
	for (let at = 12; at + 8 <= file.length; ) {
		const id = text(at);
		const size = file[at + 4] | (file[at + 5] << 8) | (file[at + 6] << 16) | (file[at + 7] << 24);
		const whole = 8 + size + (size & 1);
		if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') parts.push(file.subarray(at, at + whole));
		if (id === 'ALPH' || id === 'VP8L') alpha = true;
		at += whole;
	}
	return { chunks: concat(parts), alpha };
}

/** Pack single-picture WebP frames (all the same size) into one animated WebP. */
export function muxAnimatedWebp(frames: Uint8Array[], width: number, height: number, frameMs: number, loop: boolean): Uint8Array {
	const images = frames.map(webpImageChunks);
	const alpha = images.some((i) => i.alpha);
	const vp8x = chunk('VP8X', new Uint8Array([(alpha ? 0x10 : 0) | 0x02, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]));
	// Background colour (ignored by browsers) and loop count (0 = forever).
	const anim = chunk('ANIM', new Uint8Array([0, 0, 0, 0, loop ? 0 : 1, 0]));
	const anmf = images.map((img) =>
		chunk(
			'ANMF',
			concat([
				new Uint8Array([...u24(0), ...u24(0), ...u24(width - 1), ...u24(height - 1), ...u24(Math.round(frameMs)), 0x02]),
				img.chunks
			])
		)
	);
	const body = concat([ascii('WEBP'), vp8x, anim, ...anmf]);
	return concat([ascii('RIFF'), new Uint8Array(u32(body.length)), body]);
}
