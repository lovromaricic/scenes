import type { TextItem } from '$lib/model/types';
import { paintCss, resolveTextStyle, shadowOffset, shadowReach } from '$lib/model/textStyle';
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
	/** Each line's characters (see `rows`). */
	lines: string[];
	/** The lines, with where they are in the words and their widths. */
	rows: TextRow[];
	/** How many of the rows count for the size (empty lines at the end don't). */
	shownRows: number;
	/** Room inside a box (Bold box) or band (Highlighter) around the text. */
	padX: number;
	padY: number;
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

/**
 * The words as drawn: upper case for styles that use it (letter by letter, so every character
 * keeps its place in the typed text: one that would become two letters, like ß, stays as it is).
 */
function displayText(item: Pick<TextItem, 'text'>, uppercase: boolean | undefined): string {
	const text = item.text.trim() ? item.text : ' ';
	if (!uppercase) return text;
	let out = '';
	for (const c of text) {
		const u = c.toUpperCase();
		out += u.length === c.length ? u : c;
	}
	return out;
}

/** One line as laid out, with where it is in the typed text. */
export interface TextRow {
	/** The characters on the line (spaces at a wrap stay at its end, "hanging"). */
	text: string;
	/** Where the line starts and ends in the words (end: before the line break, if any). */
	start: number;
	end: number;
	/** Width without the hanging spaces at its end: what's centred. */
	width: number;
}

/**
 * Break the words into lines no wider than `maxWidth` (measured by `measure`): at the user's own
 * line breaks, and between words. Every character keeps its place (spaces aren't collapsed);
 * spaces where a line wraps stay at the end of that line, hanging past it, so they never move
 * the text. A word longer than a line has a line to itself.
 */
export function wrapRows(text: string, maxWidth: number, measure: (s: string) => number): Omit<TextRow, 'width'>[] {
	const rows: Omit<TextRow, 'width'>[] = [];
	let at = 0;
	for (const paragraph of text.split('\n')) {
		const tokens = paragraph.match(/^\s+|\S+\s*/g) ?? [];
		let line = '';
		let lineStart = at;
		let pos = at;
		for (const token of tokens) {
			if (line.trim() && measure((line + token).trimEnd()) > maxWidth) {
				rows.push({ text: line, start: lineStart, end: pos });
				line = '';
				lineStart = pos;
			}
			line += token;
			pos += token.length;
		}
		rows.push({ text: line, start: lineStart, end: at + paragraph.length });
		at += paragraph.length + 1;
	}
	return rows;
}

/** Line breaks are decided at this font size, so they're the same at every resolution. */
const WRAP_REFERENCE_PX = 100;

type LayoutInput = Pick<TextItem, 'text' | 'style' | 'x' | 'y' | 'font' | 'size' | 'colors'> &
	Partial<Pick<TextItem, 'shadow'>>;

/**
 * Where and how big a text item is in a frame of the given size, line by line. The one layout
 * for drawing (preview, export, home picture) and for typing on the preview (the caret and the
 * selection are placed from its rows), so they always agree.
 */
export function layoutText(item: LayoutInput, frameW: number, frameH: number): TextLayout {
	const spec = resolveTextStyle(item);
	const short = Math.min(frameW, frameH);
	const fontSize = spec.size * short;
	const ctx = measurer();
	const letterSpacing = spec.letterSpacing ?? 0;
	const text = displayText(item, spec.uppercase);
	// Where lines break: measured at a fixed size, then scaled, so the preview, the export and
	// every other size wrap the words at exactly the same places.
	ctx.font = fontString(spec.font, WRAP_REFERENCE_PX);
	ctx.letterSpacing = `${letterSpacing * WRAP_REFERENCE_PX}px`;
	const broken = wrapRows(text, (frameW * 0.84 * WRAP_REFERENCE_PX) / fontSize, (t) => ctx.measureText(t).width);
	ctx.font = fontString(spec.font, fontSize);
	ctx.letterSpacing = `${letterSpacing * fontSize}px`;
	const rows: TextRow[] = broken.map((r) => ({ ...r, width: r.text.trim() ? ctx.measureText(r.text.trimEnd()).width : 0 }));
	// Empty lines at the very end (Enter just pressed) hang below, like spaces at a line's end:
	// they don't change the size or the place of the words.
	let shown = rows.length;
	while (shown > 1 && !rows[shown - 1].text.trim()) shown--;
	const textWidth = Math.max(...rows.map((r) => r.width), fontSize * 0.5);
	const lineHeight = fontSize * spec.lineHeight;
	const padX = (spec.box?.padX ?? spec.band?.padX ?? 0) * fontSize;
	const padY = (spec.box?.padY ?? 0) * fontSize;
	const strokeW = (spec.stroke?.width ?? 0) * fontSize;
	const bleed = Math.ceil(
		// The outline reaches half its width past the letters; the shadow its blur and offset.
		Math.max(strokeW, shadowReach(spec.shadow, fontSize) + strokeW / 2) + 2
	);
	return {
		lines: rows.map((r) => r.text),
		rows,
		shownRows: shown,
		fontSize,
		lineHeight,
		padX,
		padY,
		width: textWidth + padX * 2,
		height: lineHeight * shown + padY * 2,
		cx: item.x * frameW,
		cy: item.y * frameH,
		bleed
	};
}

/**
 * Measure where each character of a row is (for the caret and selection): the x of the caret
 * before character k, from the row's left (centred) edge, at the layout's size.
 */
export function rowOffsets(item: LayoutInput, layout: TextLayout, row: TextRow): number[] {
	const spec = resolveTextStyle(item);
	const ctx = measurer();
	ctx.font = fontString(spec.font, layout.fontSize);
	ctx.letterSpacing = `${(spec.letterSpacing ?? 0) * layout.fontSize}px`;
	const out = [0];
	for (let k = 1; k <= row.text.length; k++) out.push(ctx.measureText(row.text.slice(0, k)).width);
	return out;
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
	ctx.textAlign = 'left';
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

	// The letters (and outline) are drawn fully opaque into their own layer when they're
	// translucent (so the outline doesn't show through them) or have a shadow (cast once, by the
	// letters and outline together), then placed with the fill's opacity.
	const fillOpacity = Math.max(0, Math.min(1, spec.fill.opacity));
	const shadow = spec.shadow.on && spec.shadow.opacity > 0 ? spec.shadow : null;
	const letters = fillOpacity < 1 || shadow ? new OffscreenCanvas(canvas.width, canvas.height) : canvas;
	const lctx = letters === canvas ? ctx : letters.getContext('2d')!;
	if (lctx !== ctx) {
		lctx.font = ctx.font;
		lctx.letterSpacing = ctx.letterSpacing;
		lctx.textAlign = 'left';
		lctx.textBaseline = 'middle';
	}

	layout.rows.forEach((row, i) => {
		const line = row.text;
		const y = top + lineHeight * (i + 0.5);
		// Each line is centred by its width without the spaces hanging at its end.
		const x = centerX - row.width / 2;
		if (spec.band && line.trim()) {
			const w = row.width + spec.band.padX * 2 * fontSize;
			ctx.fillStyle = paintCss(spec.band);
			ctx.beginPath();
			ctx.roundRect(centerX - w / 2, y - lineHeight * 0.44, w, lineHeight * 0.88, fontSize * 0.12);
			ctx.fill();
		}
		if (spec.stroke && spec.stroke.width > 0) {
			lctx.lineJoin = 'round';
			lctx.lineWidth = spec.stroke.width * fontSize;
			lctx.strokeStyle = spec.stroke.color;
			lctx.strokeText(line, x, y);
		}
		lctx.fillStyle = paintCss({ ...spec.fill, opacity: letters === canvas ? fillOpacity : 1 });
		lctx.fillText(line, x, y);
	});

	if (shadow) {
		// Only the shadow: the letters are drawn far off the canvas and their shadow brought back
		// by the offset, so it keeps its own opacity whatever the letters' is.
		const off = shadowOffset(shadow, fontSize);
		const away = canvas.width + bleed * 4 + 100;
		ctx.save();
		ctx.shadowColor = paintCss(shadow);
		ctx.shadowBlur = shadow.blur * fontSize;
		ctx.shadowOffsetX = off.x + away;
		ctx.shadowOffsetY = off.y;
		ctx.drawImage(letters, -away, 0);
		ctx.restore();
	}
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
