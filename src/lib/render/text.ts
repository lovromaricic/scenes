import type { TextItem } from '$lib/model/types';
import { paintCss, resolveTextStyle } from '$lib/model/textStyle';
import { ensureFallback, fontString } from './fonts';

/**
 * Draws text items into canvas "sprites" that the WebGL compositor places on the video.
 * The same layout function also sizes the clickable boxes on the preview, so what you click
 * lines up with what you see, and the saved video uses exactly the same drawing code.
 *
 * All sizes scale with the frame's short side, so text looks the same in every aspect ratio
 * and at every output resolution.
 */

/** The canvas/CSS font for a text item at `px` pixels (falls back to Geist until loaded). */
export function fontFor(item: TextStyleInput, px: number): string {
	return fontString(resolveTextStyle(item).font, px);
}

/** Load the default fonts used on video. */
export function loadTextFonts(): Promise<void> {
	return ensureFallback();
}

type TextStyleInput = Pick<TextItem, 'style' | 'font' | 'size' | 'colors'>;

export interface TextLayout {
	lines: string[];
	fontSize: number;
	lineHeight: number;
	/** Box around the text (including any box/band padding), in frame pixels. */
	width: number;
	height: number;
	/** Centre in frame pixels. */
	cx: number;
	cy: number;
	/** Extra room around the box for shadows and outlines, in pixels. */
	bleed: number;
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null;
function measurer(): OffscreenCanvasRenderingContext2D {
	measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')!;
	return measureCtx;
}

function displayText(item: Pick<TextItem, 'text'>, uppercase: boolean | undefined): string {
	const text = item.text.trim() ? item.text : ' ';
	return uppercase ? text.toUpperCase() : text;
}

function wrap(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split('\n')) {
		const words = paragraph.split(/\s+/).filter(Boolean);
		if (words.length === 0) {
			lines.push('');
			continue;
		}
		let line = words[0];
		for (const word of words.slice(1)) {
			const candidate = `${line} ${word}`;
			if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
			else {
				lines.push(line);
				line = word;
			}
		}
		lines.push(line);
	}
	return lines;
}

type LayoutInput = Pick<TextItem, 'text' | 'style' | 'x' | 'y' | 'font' | 'size' | 'colors'>;

/** Where and how big a text item is in a frame of the given size. */
export function layoutText(item: LayoutInput, frameW: number, frameH: number): TextLayout {
	const spec = resolveTextStyle(item);
	const short = Math.min(frameW, frameH);
	const fontSize = spec.size * short;
	const ctx = measurer();
	ctx.font = fontString(spec.font, fontSize);
	ctx.letterSpacing = `${(spec.letterSpacing ?? 0) * fontSize}px`;
	const lines = wrap(ctx, displayText(item, spec.uppercase), frameW * 0.84);
	const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width), fontSize * 0.5);
	const lineHeight = fontSize * spec.lineHeight;
	const padX = (spec.box?.padX ?? spec.band?.padX ?? 0) * fontSize;
	const padY = (spec.box?.padY ?? 0) * fontSize;
	const strokeW = (spec.stroke?.width ?? 0) * fontSize;
	const bleed = Math.ceil(
		Math.max(strokeW, spec.shadow ? spec.shadow.blur * fontSize * 1.5 : 0) + 2
	);
	return {
		lines,
		fontSize,
		lineHeight,
		width: textWidth + padX * 2,
		height: lineHeight * lines.length + padY * 2,
		cx: item.x * frameW,
		cy: item.y * frameH,
		bleed
	};
}

export interface TextSprite {
	canvas: OffscreenCanvas;
	layout: TextLayout;
}

/** Draw a text item into its own transparent canvas (box + bleed), ready to upload to the GPU. */
export function drawTextSprite(item: TextItem, frameW: number, frameH: number): TextSprite {
	const layout = layoutText(item, frameW, frameH);
	const spec = resolveTextStyle(item);
	const { fontSize, lineHeight, bleed } = layout;
	const canvas = new OffscreenCanvas(
		Math.max(1, Math.ceil(layout.width + bleed * 2)),
		Math.max(1, Math.ceil(layout.height + bleed * 2))
	);
	const ctx = canvas.getContext('2d')!;
	ctx.font = fontString(spec.font, fontSize);
	ctx.letterSpacing = `${(spec.letterSpacing ?? 0) * fontSize}px`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';

	const centerX = canvas.width / 2;
	const padY = (spec.box?.padY ?? 0) * fontSize;
	const top = bleed + padY;

	if (spec.box) {
		ctx.fillStyle = paintCss(spec.box);
		ctx.beginPath();
		ctx.roundRect(bleed, bleed, layout.width, layout.height, spec.box.radius * fontSize);
		ctx.fill();
	}

	// Translucent text: draw the letters (and outline) fully opaque into a layer, then place the
	// layer with the fill's opacity, so the outline doesn't show through the letters.
	const fillOpacity = Math.max(0, Math.min(1, spec.fill.opacity));
	const letters = fillOpacity < 1 ? new OffscreenCanvas(canvas.width, canvas.height) : canvas;
	const lctx = letters === canvas ? ctx : letters.getContext('2d')!;
	if (lctx !== ctx) {
		lctx.font = ctx.font;
		lctx.letterSpacing = ctx.letterSpacing;
		lctx.textAlign = 'center';
		lctx.textBaseline = 'middle';
	}

	layout.lines.forEach((line, i) => {
		const y = top + lineHeight * (i + 0.5);
		if (spec.band && line) {
			const w = ctx.measureText(line).width + spec.band.padX * 2 * fontSize;
			ctx.fillStyle = paintCss(spec.band);
			ctx.beginPath();
			ctx.roundRect(centerX - w / 2, y - lineHeight * 0.44, w, lineHeight * 0.88, fontSize * 0.12);
			ctx.fill();
		}
		if (spec.shadow) {
			lctx.shadowColor = spec.shadow.color;
			lctx.shadowBlur = spec.shadow.blur * fontSize;
			lctx.shadowOffsetY = spec.shadow.offsetY * fontSize;
		}
		if (spec.stroke && spec.stroke.width > 0) {
			lctx.lineJoin = 'round';
			lctx.lineWidth = spec.stroke.width * fontSize;
			lctx.strokeStyle = spec.stroke.color;
			lctx.strokeText(line, centerX, y);
		}
		lctx.fillStyle = paintCss({ ...spec.fill, opacity: letters === canvas ? fillOpacity : 1 });
		lctx.fillText(line, centerX, y);
		lctx.shadowColor = 'transparent';
	});

	if (letters !== canvas) {
		ctx.globalAlpha = fillOpacity;
		ctx.drawImage(letters, 0, 0);
		ctx.globalAlpha = 1;
	}

	return { canvas, layout };
}

/**
 * Caches sprites so a text is only redrawn when it changes: its words, style, colours, size, the
 * frame size, or the font actually in use (so it redraws once a font finishes loading).
 */
/** A texture side every WebGL2 device supports (the real limit is asked from the GPU). */
export const SAFE_TEXTURE_SIZE = 4096;
/** Most pixels in one text sprite (about 128 MB of RGBA), however large the words. */
export const MAX_SPRITE_PIXELS = 32_000_000;

/**
 * How many sprite pixels to draw per frame pixel for words whose sprite is `w` × `h` frame
 * pixels: `want` (more than 1 for words that grow, so they stay sharp), but no more than fits a
 * texture of `maxSide` pixels and the pixel budget. Very large words (thousands of pixels, or
 * grown 4×) are then drawn from a slightly smaller sprite, scaled up, rather than not at all.
 */
export function spriteFactor(w: number, h: number, want: number, maxSide: number, maxPixels = MAX_SPRITE_PIXELS): number {
	// A little room for the sprite's rounding and the outline/shadow margin, which round up.
	const side = Math.max(16, maxSide - 8);
	return Math.min(want, side / Math.max(1, w), side / Math.max(1, h), Math.sqrt(maxPixels / Math.max(1, w * h)));
}

/**
 * Text sprites, drawn once and kept while they're used: a sprite is only redrawn when the words,
 * their style or the frame size change (moving, turning, scaling and fading don't redraw it).
 */
export class TextSpriteCache {
	private sprites = new Map<string, { sprite: TextSprite; used: number }>();
	/** Each sprite's drawing factor (see spriteFactor), so words aren't measured every frame. */
	private factors = new Map<string, number>();
	private frame = 0;

	/**
	 * The sprite for words in a frame of frameW × frameH, drawn `want` times larger if that fits
	 * the GPU's `maxTexture` (and the pixel budget). `factor` is the size it was drawn at: sprite
	 * pixels per frame pixel.
	 */
	get(
		item: TextItem,
		frameW: number,
		frameH: number,
		want = 1,
		maxTexture = SAFE_TEXTURE_SIZE
	): { key: string; sprite: TextSprite; factor: number } {
		const spec = resolveTextStyle(item);
		const words = `${item.id}|${item.text}|${JSON.stringify(spec)}|${fontString(spec.font, 10)}`;
		const fk = `${words}|${frameW}x${frameH}|${want}|${maxTexture}`;
		let factor = this.factors.get(fk);
		if (factor === undefined) {
			const l = layoutText(item, frameW, frameH);
			factor = spriteFactor(l.width + l.bleed * 2, l.height + l.bleed * 2, want, maxTexture);
			if (this.factors.size > 256) this.factors.clear();
			this.factors.set(fk, factor);
		}
		const key = `${words}|${frameW * factor}x${frameH * factor}`;
		let entry = this.sprites.get(key);
		if (!entry) {
			entry = { sprite: drawTextSprite(item, frameW * factor, frameH * factor), used: this.frame };
			this.sprites.set(key, entry);
		}
		entry.used = this.frame;
		return { key, sprite: entry.sprite, factor };
	}

	/** Call once per rendered frame; forgets sprites not used for a while. */
	endFrame(): string[] {
		this.frame++;
		const dropped: string[] = [];
		if (this.sprites.size > 24) {
			for (const [key, entry] of this.sprites) {
				if (this.frame - entry.used > 120) {
					this.sprites.delete(key);
					dropped.push(key);
				}
			}
		}
		return dropped;
	}

	clear(): void {
		this.sprites.clear();
		this.factors.clear();
	}
}
