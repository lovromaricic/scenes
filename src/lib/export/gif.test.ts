import { describe, expect, it } from 'vitest';
import { GifWriter, ditherToPalette, estimateGifBytes, gifSize, muxAnimatedWebp, webpImageChunks } from './gif';

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** A gradient frame, w × h RGBA. */
function gradient(w: number, h: number, shift = 0) {
	const d = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			d[i] = (x * 255) / (w - 1);
			d[i + 1] = ((y + shift) * 255) / h;
			d[i + 2] = 128;
			d[i + 3] = 255;
		}
	return d;
}

describe('GIF', () => {
	it('keeps the video’s shape, never bigger than it', () => {
		expect(gifSize({ width: 1920, height: 1080 }, 480)).toEqual({ width: 480, height: 270 });
		expect(gifSize({ width: 1080, height: 1920 }, 320)).toEqual({ width: 320, height: 569 });
		expect(gifSize({ width: 400, height: 300 }, 640)).toEqual({ width: 400, height: 300 });
		expect(estimateGifBytes(480, 270, 15, 4, true)).toBeGreaterThan(estimateGifBytes(480, 270, 15, 4, false));
	});

	it('writes frames with their own palettes, looping or once', () => {
		const make = (loop: boolean) => {
			const g = new GifWriter(32, 16, 10, loop, true);
			for (let f = 0; f < 3; f++) g.add(gradient(32, 16, f * 4));
			return g.finish();
		};
		const looping = make(true);
		expect(ascii(looping, 0, 6)).toBe('GIF89a');
		expect(ascii(looping, 0, looping.length)).toContain('NETSCAPE2.0');
		expect(ascii(make(false), 0, 200)).not.toContain('NETSCAPE2.0');
		// Three image descriptors (0x2c) after graphic control extensions (0x21 0xf9).
		let frames = 0;
		for (let i = 0; i + 1 < looping.length; i++) if (looping[i] === 0x21 && looping[i + 1] === 0xf9) frames++;
		expect(frames).toBe(3);
	});

	it('dithering spreads the error: a mid grey between black and white becomes a mix of both', () => {
		const w = 16;
		const h = 16;
		const grey = new Uint8ClampedArray(w * h * 4).fill(128);
		const idx = ditherToPalette(grey, w, h, [
			[0, 0, 0],
			[255, 255, 255]
		]);
		const white = idx.reduce((n, v) => n + v, 0) / idx.length;
		expect(white).toBeGreaterThan(0.4);
		expect(white).toBeLessThan(0.6);
	});
});

describe('animated WebP', () => {
	/** A minimal single-picture WebP: RIFF, WEBP and one VP8L chunk (contents don't matter here). */
	const fakeWebp = (bytes: number[]) => {
		const data = new Uint8Array(bytes);
		const chunk = new Uint8Array(8 + data.length + (data.length & 1));
		chunk.set(new TextEncoder().encode('VP8L'), 0);
		chunk.set([data.length, 0, 0, 0], 4);
		chunk.set(data, 8);
		const out = new Uint8Array(12 + chunk.length);
		out.set(new TextEncoder().encode('RIFF'), 0);
		out.set([(4 + chunk.length) & 255, 0, 0, 0], 4);
		out.set(new TextEncoder().encode('WEBP'), 8);
		out.set(chunk, 12);
		return out;
	};

	it('packs frames into RIFF/WEBP with VP8X (animation), ANIM (loop) and one ANMF per frame', () => {
		expect(webpImageChunks(fakeWebp([1, 2, 3])).chunks.length).toBe(12);
		const file = muxAnimatedWebp([fakeWebp([1, 2, 3]), fakeWebp([4, 5])], 40, 30, 100, true);
		expect(ascii(file, 0, 4)).toBe('RIFF');
		expect(ascii(file, 8, 4)).toBe('WEBP');
		expect(ascii(file, 12, 4)).toBe('VP8X');
		expect(file[20] & 0x02).toBe(0x02); // animation flag
		// Canvas size − 1, 24-bit little endian.
		expect(file[24] | (file[25] << 8)).toBe(39);
		expect(file[27] | (file[28] << 8)).toBe(29);
		const text = ascii(file, 0, file.length);
		expect(text.split('ANMF').length - 1).toBe(2);
		expect(text).toContain('ANIM');
		// RIFF size is the rest of the file.
		expect(file[4] | (file[5] << 8) | (file[6] << 16)).toBe(file.length - 8);
	});
});
