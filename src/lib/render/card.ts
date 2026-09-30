import { radiusPixels, type CardContent } from '$lib/model/card';
import type { FrameResult } from '$lib/media/frames';

/**
 * Draws a card (background colour + optional rounded rectangle) at an exact pixel size. The
 * preview, export and storyboard thumbnails all use this, at their own size, so cards look the
 * same everywhere.
 */
export function drawCard(
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	card: CardContent,
	x: number,
	y: number,
	w: number,
	h: number
): void {
	ctx.fillStyle = card.background;
	ctx.fillRect(x, y, w, h);
	const r = card.rect;
	if (!r) return;
	const rx = x + r.x * w;
	const ry = y + r.y * h;
	const rw = r.w * w;
	const rh = r.h * h;
	ctx.fillStyle = r.color;
	ctx.beginPath();
	ctx.roundRect(rx, ry, rw, rh, radiusPixels(r.radius, rw, rh));
	ctx.fill();
}

/** Cards rendered to canvases, reused until the card or the size changes. */
export class CardCache {
	private cache = new Map<string, { canvas: OffscreenCanvas; used: number }>();
	private tick = 0;

	frame(card: CardContent, width: number, height: number): FrameResult {
		const key = `${width}x${height}|${JSON.stringify(card)}`;
		let entry = this.cache.get(key);
		if (!entry) {
			const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
			drawCard(canvas.getContext('2d')!, card, 0, 0, width, height);
			entry = { canvas, used: 0 };
			this.cache.set(key, entry);
			if (this.cache.size > 16) {
				const oldest = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used)[0][0];
				this.cache.delete(oldest);
			}
		}
		entry.used = ++this.tick;
		return { image: entry.canvas, width, height, exact: true };
	}
}
