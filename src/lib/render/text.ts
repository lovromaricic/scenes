import type { TextItem, TextStyleId } from '$lib/model/types';

/**
 * Draws text items into canvas "sprites" that the WebGL compositor places on the video.
 * The same layout function also sizes the clickable boxes on the preview, so what you click
 * lines up with what you see, and the saved video uses exactly the same drawing code.
 *
 * All sizes scale with the frame's short side, so text looks the same in every aspect ratio
 * and at every output resolution.
 */

interface StyleSpec {
	family: 'sans' | 'serif';
	weight: number;
	italic: boolean;
	/** Font size as a fraction of the frame's short side. */
	size: number;
	lineHeight: number;
	uppercase?: boolean;
	letterSpacing?: number;
	fill: string;
	/** Outline around the letters, width as a fraction of the font size. */
	stroke?: { color: string; width: number };
	/** A box behind the text. */
	box?: { color: string; padX: number; padY: number; radius: number };
	/** A highlighter band behind each line. */
	band?: { color: string; padX: number };
	shadow?: { color: string; blur: number; offsetY: number };
}

// These colours are part of the rendered video (content), not the interface palette.
const WHITE = '#ffffff';
const INK = '#141417';
const HIGHLIGHTER = '#ffe14d';
const SOFT_SHADOW = { color: 'rgba(0,0,0,0.45)', blur: 0.25, offsetY: 0.04 };

export const TEXT_STYLE_SPECS: Record<TextStyleId, StyleSpec> = {
	clean: {
		family: 'sans',
		weight: 600,
		italic: false,
		size: 0.062,
		lineHeight: 1.18,
		fill: WHITE,
		shadow: SOFT_SHADOW
	},
	boxed: {
		family: 'sans',
		weight: 600,
		italic: false,
		size: 0.056,
		lineHeight: 1.22,
		fill: WHITE,
		box: { color: 'rgba(20,20,23,0.88)', padX: 0.5, padY: 0.28, radius: 0.22 }
	},
	serif: {
		family: 'serif',
		weight: 400,
		italic: true,
		size: 0.085,
		lineHeight: 1.08,
		fill: WHITE,
		shadow: SOFT_SHADOW
	},
	outline: {
		family: 'sans',
		weight: 600,
		italic: false,
		size: 0.068,
		lineHeight: 1.12,
		uppercase: true,
		letterSpacing: 0.02,
		fill: WHITE,
		stroke: { color: INK, width: 0.16 }
	},
	highlight: {
		family: 'sans',
		weight: 600,
		italic: false,
		size: 0.058,
		lineHeight: 1.3,
		fill: INK,
		band: { color: HIGHLIGHTER, padX: 0.28 }
	},
	title: {
		family: 'serif',
		weight: 400,
		italic: true,
		size: 0.15,
		lineHeight: 1.0,
		fill: WHITE,
		shadow: SOFT_SHADOW
	}
};

const FAMILIES = {
	sans: '"Geist", ui-sans-serif, system-ui, sans-serif',
	serif: '"Instrument Serif", Georgia, serif'
};

export function fontFor(style: TextStyleId, px: number): string {
	const s = TEXT_STYLE_SPECS[style];
	return `${s.italic ? 'italic ' : ''}${s.weight} ${px}px ${FAMILIES[s.family]}`;
}

/** Wait until the fonts used on video are ready, so canvases don't draw with fallbacks. */
let fontsReady: Promise<void> | null = null;
export function loadTextFonts(): Promise<void> {
	if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
	fontsReady ??= Promise.all(
		(Object.keys(TEXT_STYLE_SPECS) as TextStyleId[]).map((id) =>
			document.fonts.load(fontFor(id, 40), 'Aa')
		)
	)
		.then(() => undefined)
		.catch(() => undefined);
	return fontsReady;
}

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

function displayText(item: Pick<TextItem, 'text' | 'style'>): string {
	const text = item.text.trim() ? item.text : ' ';
	return TEXT_STYLE_SPECS[item.style].uppercase ? text.toUpperCase() : text;
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

/** Where and how big a text item is in a frame of the given size. */
export function layoutText(
	item: Pick<TextItem, 'text' | 'style' | 'x' | 'y'>,
	frameW: number,
	frameH: number
): TextLayout {
	const spec = TEXT_STYLE_SPECS[item.style];
	const short = Math.min(frameW, frameH);
	const fontSize = spec.size * short;
	const ctx = measurer();
	ctx.font = fontFor(item.style, fontSize);
	ctx.letterSpacing = `${(spec.letterSpacing ?? 0) * fontSize}px`;
	const lines = wrap(ctx, displayText(item), frameW * 0.84);
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
	const spec = TEXT_STYLE_SPECS[item.style];
	const { fontSize, lineHeight, bleed } = layout;
	const canvas = new OffscreenCanvas(
		Math.max(1, Math.ceil(layout.width + bleed * 2)),
		Math.max(1, Math.ceil(layout.height + bleed * 2))
	);
	const ctx = canvas.getContext('2d')!;
	ctx.font = fontFor(item.style, fontSize);
	ctx.letterSpacing = `${(spec.letterSpacing ?? 0) * fontSize}px`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';

	const centerX = canvas.width / 2;
	const padY = (spec.box?.padY ?? 0) * fontSize;
	const top = bleed + padY;

	if (spec.box) {
		ctx.fillStyle = spec.box.color;
		ctx.beginPath();
		ctx.roundRect(bleed, bleed, layout.width, layout.height, spec.box.radius * fontSize);
		ctx.fill();
	}

	layout.lines.forEach((line, i) => {
		const y = top + lineHeight * (i + 0.5);
		if (spec.band && line) {
			const w = ctx.measureText(line).width + spec.band.padX * 2 * fontSize;
			ctx.fillStyle = spec.band.color;
			ctx.beginPath();
			ctx.roundRect(centerX - w / 2, y - lineHeight * 0.44, w, lineHeight * 0.88, fontSize * 0.12);
			ctx.fill();
		}
		if (spec.shadow) {
			ctx.shadowColor = spec.shadow.color;
			ctx.shadowBlur = spec.shadow.blur * fontSize;
			ctx.shadowOffsetY = spec.shadow.offsetY * fontSize;
		}
		if (spec.stroke) {
			ctx.lineJoin = 'round';
			ctx.lineWidth = spec.stroke.width * fontSize;
			ctx.strokeStyle = spec.stroke.color;
			ctx.strokeText(line, centerX, y);
		}
		ctx.fillStyle = spec.fill;
		ctx.fillText(line, centerX, y);
		ctx.shadowColor = 'transparent';
	});

	return { canvas, layout };
}

/** Caches sprites so a text is only redrawn when its words, style or the frame size change. */
export class TextSpriteCache {
	private sprites = new Map<string, { sprite: TextSprite; used: number }>();
	private frame = 0;

	get(item: TextItem, frameW: number, frameH: number): { key: string; sprite: TextSprite } {
		const key = `${item.id}|${item.style}|${frameW}x${frameH}|${item.text}`;
		let entry = this.sprites.get(key);
		if (!entry) {
			entry = { sprite: drawTextSprite(item, frameW, frameH), used: this.frame };
			this.sprites.set(key, entry);
		}
		entry.used = this.frame;
		return { key, sprite: entry.sprite };
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
	}
}
