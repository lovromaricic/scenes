import { CanvasSink } from 'mediabunny';
import { getHandle } from './handles';

/**
 * Small frames for the storyboard filmstrips, decoded in the background and cached.
 *
 * Each file gets its own small, low-priority decoder (separate from playback), and requests are
 * processed one file at a time in time order with `canvasesAtTimestamps`, so a whole filmstrip
 * costs one pass over the file. Frames are cached by file and time (rounded to 0.1s), so cards
 * that show the same part of a clip, or redraw after a trim, reuse what's already decoded.
 */

/** Height of decoded filmstrip frames in pixels (tiles are ~70 CSS px tall; this covers 2× screens). */
export const FILMSTRIP_HEIGHT = 144;
const MAX_CACHED = 800;

export interface StripFrame {
	image: ImageBitmap;
	width: number;
	height: number;
}

type Listener = (frame: StripFrame) => void;

const cache = new Map<string, StripFrame>();
const pending = new Map<string, Map<number, Listener[]>>();
const sinks = new Map<string, Promise<{ sink: CanvasSink | null; photo: StripFrame | null }>>();
let working = false;

/** Cache key for a time: rounded to 0.1s so nearby requests share a frame. */
export function quantize(t: number): number {
	return Math.round(t * 10) / 10;
}

function key(mediaId: string, t: number): string {
	return `${mediaId}@${quantize(t).toFixed(1)}`;
}

function remember(k: string, frame: StripFrame) {
	cache.delete(k);
	cache.set(k, frame);
	if (cache.size > MAX_CACHED) {
		const oldest = cache.keys().next().value!;
		cache.get(oldest)?.image.close();
		cache.delete(oldest);
	}
}

/** A frame that's already decoded, or null. */
export function cachedFrame(mediaId: string, t: number): StripFrame | null {
	const k = key(mediaId, t);
	const hit = cache.get(k);
	if (hit) {
		cache.delete(k);
		cache.set(k, hit);
	}
	return hit ?? null;
}

/**
 * Ask for frames at these source times. `onFrame` is called (possibly later, possibly
 * immediately from the cache) once per time as frames become available.
 */
export function requestFrames(
	mediaId: string,
	times: number[],
	onFrame: (t: number, frame: StripFrame) => void
) {
	for (const t of times) {
		const q = quantize(t);
		const hit = cachedFrame(mediaId, q);
		if (hit) {
			onFrame(t, hit);
			continue;
		}
		let byTime = pending.get(mediaId);
		if (!byTime) pending.set(mediaId, (byTime = new Map()));
		const list = byTime.get(q) ?? [];
		list.push((f) => onFrame(t, f));
		byTime.set(q, list);
	}
	if (!working) void work();
}

function sinkFor(mediaId: string) {
	let s = sinks.get(mediaId);
	if (!s) {
		s = (async () => {
			const handle = await getHandle(mediaId);
			if (handle.info.kind === 'photo') {
				const { width, height } = handle.info;
				const scale = Math.min(1, (FILMSTRIP_HEIGHT * 2) / Math.min(width, height));
				const image = await createImageBitmap(handle.blob, {
					imageOrientation: 'from-image',
					resizeWidth: Math.max(1, Math.round(width * scale)),
					resizeHeight: Math.max(1, Math.round(height * scale))
				});
				return { sink: null, photo: { image, width: image.width, height: image.height } };
			}
			if (!handle.video) return { sink: null, photo: null };
			return {
				sink: new CanvasSink(handle.video, { height: FILMSTRIP_HEIGHT, poolSize: 0 }),
				photo: null
			};
		})();
		s.catch(() => sinks.delete(mediaId));
		sinks.set(mediaId, s);
	}
	return s;
}

async function work() {
	working = true;
	try {
		while (pending.size) {
			const [mediaId, byTime] = pending.entries().next().value!;
			pending.delete(mediaId);
			const times = [...byTime.keys()].sort((a, b) => a - b);
			let source;
			try {
				source = await sinkFor(mediaId);
			} catch {
				continue;
			}
			const deliver = (t: number, frame: StripFrame) => {
				remember(key(mediaId, t), frame);
				for (const l of byTime.get(t) ?? []) l(frame);
			};
			if (source.photo) {
				for (const t of times) deliver(t, source.photo);
				continue;
			}
			if (!source.sink) continue;
			let i = 0;
			try {
				for await (const wrapped of source.sink.canvasesAtTimestamps(times)) {
					const t = times[i++];
					if (!wrapped) continue;
					const image = await createImageBitmap(wrapped.canvas);
					deliver(t, { image, width: image.width, height: image.height });
					// Stay out of playback's way: give the main thread a breather between frames.
					await new Promise((r) => setTimeout(r, 0));
				}
			} catch (error) {
				console.warn('Filmstrip decoding stopped', error);
			}
		}
	} finally {
		working = false;
	}
}

/**
 * Source times to sample for a filmstrip of `count` tiles: the middle of each tile's slice of
 * the scene's visible range (after trimming). Speed doesn't change which frames are visible,
 * only how long the card is, which changes `count`.
 */
export function sampleTimes(sourceStart: number, sourceEnd: number, count: number): number[] {
	const n = Math.max(1, Math.floor(count));
	const span = Math.max(0, sourceEnd - sourceStart);
	return Array.from({ length: n }, (_, i) => sourceStart + ((i + 0.5) / n) * span);
}
