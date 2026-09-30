import { base } from '$app/paths';
import { getFontFace } from '$lib/media/db';
import { builtinFont, closestFace, type TextFont } from '$lib/model/textStyle';

/**
 * Loads the fonts used on video with the FontFace API, under private family names ("sv-…") so
 * they never clash with the interface's own fonts. Built-in fonts come from the bundled woff2 files;
 * fonts from this computer and uploaded files come from IndexedDB, so a project renders the same
 * after a reload without asking for permission again. Anything missing falls back to Geist.
 */

export type FontStatus = 'loading' | 'ready' | 'failed';

export const FALLBACK_FAMILY = 'sv-geist';

const status = new Map<string, FontStatus>();
const pending = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();

/** The private CSS family name a font is registered under. */
export function cssFamily(font: Pick<TextFont, 'source' | 'id'>): string {
	return font.source === 'builtin' ? `sv-${font.id}` : `sv-face-${font.id}`;
}

/** Built-in fonts: the face actually available closest to what's asked. */
function builtinFace(font: TextFont) {
	const b = builtinFont(font.id);
	return b ? closestFace(b.faces, font.weight, font.italic) : undefined;
}

/** One key per loadable face. */
export function fontKey(font: TextFont): string {
	if (font.source !== 'builtin') return `face:${font.id}`;
	const face = builtinFace(font);
	return `builtin:${font.id}:${face?.weight ?? font.weight}:${(face?.italic ?? font.italic) ? 'i' : 'n'}`;
}

export function fontStatus(font: TextFont): FontStatus | undefined {
	return status.get(fontKey(font));
}

/** Be told whenever a font finishes loading (or fails), e.g. to redraw. */
export function onFontsChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function set(key: string, s: FontStatus) {
	status.set(key, s);
	for (const l of listeners) l();
}

/** Load a font (once). Resolves true when it's ready, false if it couldn't be loaded. */
export function ensureFont(font: TextFont): Promise<boolean> {
	if (typeof document === 'undefined' || typeof FontFace === 'undefined')
		return Promise.resolve(false);
	const key = fontKey(font);
	let p = pending.get(key);
	if (p) return p;
	status.set(key, 'loading');
	p = (async () => {
		try {
			let face: FontFace;
			if (font.source === 'builtin') {
				const f = builtinFace(font);
				if (!f) throw new Error(`Unknown built-in font ${font.id}`);
				const url = `${base}/fonts/${font.id}/${f.weight}-${f.italic ? 'italic' : 'normal'}.woff2`;
				face = new FontFace(cssFamily(font), `url(${url})`, {
					weight: String(f.weight),
					style: f.italic ? 'italic' : 'normal'
				});
			} else {
				const record = await getFontFace(font.id);
				if (!record) throw new Error(`Font file ${font.id} is missing`);
				face = new FontFace(cssFamily(font), await record.blob.arrayBuffer(), {
					weight: String(record.weight),
					style: record.italic ? 'italic' : 'normal'
				});
			}
			await face.load();
			document.fonts.add(face);
			set(key, 'ready');
			return true;
		} catch (error) {
			console.warn('Font could not be loaded', font, error);
			set(key, 'failed');
			return false;
		}
	})();
	pending.set(key, p);
	return p;
}

/** Load every font the given texts use (plus the fallback). */
export async function ensureFonts(fonts: TextFont[]): Promise<void> {
	await Promise.all([ensureFallback(), ...fonts.map(ensureFont)]);
}

let fallback: Promise<void> | null = null;
/** Geist, used by the default styles and whenever a font is missing. */
export function ensureFallback(): Promise<void> {
	fallback ??= Promise.all(
		[400, 600, 700].map((weight) =>
			ensureFont({ family: 'Geist', source: 'builtin', id: 'geist', weight, italic: false })
		)
	).then(() => undefined);
	return fallback;
}

/**
 * The canvas/CSS font for a face at `px` pixels. Until the font is ready (or if it failed) this
 * uses the Geist fallback, so drawing never waits on a font and redraws once it arrives.
 */
export function fontString(font: TextFont, px: number): string {
	const ready = status.get(fontKey(font)) === 'ready';
	const family = ready ? `"${cssFamily(font)}", "${FALLBACK_FAMILY}"` : `"${FALLBACK_FAMILY}"`;
	return `${font.italic ? 'italic ' : ''}${font.weight} ${px}px ${family}`;
}
