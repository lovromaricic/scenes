import { placeOverlays, type PlacedOverlay } from '$lib/model/overlay';
import { isTextVisible, textFrameState } from '$lib/model/textAnimation';
import { itemValuesAt, maxItemScale, textBaseValues } from '$lib/model/keyframes';
import { overlayTracksBottomUp, type Track } from '$lib/model/tracks';
import type { Overlay } from '$lib/model/overlay';
import type { TextItem } from '$lib/model/types';
import type { TextDraw } from './compositor';
import type { OverlayDraw } from './overlay';
import type { TextSpriteCache } from './text';

/**
 * What's drawn over the scenes at a moment, in drawing order: overlay tracks from the lowest (just
 * above the scenes) to the highest, and on each track its items by start time. Hidden tracks are
 * left out. Shared by the preview, Watch, export and thumbnails, so they always stack the same.
 */
export type VisualEntry = { type: 'overlay'; placed: PlacedOverlay } | { type: 'text'; item: TextItem };

export type VisualDraw = { type: 'overlay'; draw: OverlayDraw } | { type: 'text'; draw: TextDraw };

export function visualsAt(
	project: { tracks: Track[]; overlays: Overlay[]; texts: TextItem[] },
	t: number,
	videoLength: number
): VisualEntry[] {
	if (t >= videoLength) return [];
	const out: VisualEntry[] = [];
	const placed = placeOverlays(project.overlays);
	for (const track of overlayTracksBottomUp(project.tracks)) {
		if (track.hidden) continue;
		const here: { start: number; entry: VisualEntry }[] = [];
		for (const p of placed)
			if (p.overlay.trackId === track.id && t >= p.start && t < p.end)
				here.push({ start: p.start, entry: { type: 'overlay', placed: p } });
		for (const item of project.texts)
			if (item.trackId === track.id && isTextVisible(item, t))
				here.push({ start: item.start, entry: { type: 'text', item } });
		here.sort((a, b) => a.start - b.start);
		for (const h of here) out.push(h.entry);
	}
	return out;
}

/**
 * A text item's sprite placed in a frame of the given size at time `t`: its keyframed (or fixed)
 * position, scale, rotation and opacity, with the entrance animation on top (a fade multiplies
 * the opacity, slide up offsets the position, pop multiplies the scale). Words that grow are
 * drawn from a larger sprite, so they stay sharp however big they get.
 */
export function textDraw(
	item: TextItem,
	t: number,
	width: number,
	height: number,
	sprites: TextSpriteCache
): TextDraw | null {
	const state = textFrameState(item, t);
	if (!state.visible) return null;
	const base = textBaseValues(item);
	const v = itemValuesAt(base, item.keyframes, t - item.start);
	const sharp = textSharpness(maxItemScale(base, item.keyframes));
	const { key, sprite } = sprites.get(item, width * sharp, height * sharp);
	return {
		key,
		image: sprite.canvas,
		// Position comes from the item itself, not the cached sprite (which is only keyed by
		// words, style and size), so moving words shows up immediately.
		cx: v.x * width,
		cy: v.y * height + state.dy * Math.min(width, height),
		width: sprite.canvas.width,
		height: sprite.canvas.height,
		scale: state.scale / sharp,
		scaleX: v.scaleX,
		scaleY: v.scaleY,
		rotation: (v.rotation * Math.PI) / 180,
		opacity: state.opacity * v.opacity
	};
}

/** How much larger than normal to draw words that reach `maxScale` (in steps, so it's cached). */
export function textSharpness(maxScale: number): number {
	if (maxScale <= 1.05) return 1;
	return Math.min(4, Math.ceil(maxScale * 2) / 2);
}

/**
 * Whether a drawn picture or words reaches outside a W × H frame (counting its rotation, and a
 * layer's shadow). Only these are drawn on the editor's pasteboard, faded.
 */
export function reachesOutside(v: VisualDraw, W: number, H: number): boolean {
	let cx: number;
	let cy: number;
	let w: number;
	let h: number;
	let margin = 0;
	let rotation: number;
	if (v.type === 'overlay') {
		const d = v.draw;
		if (d.opacity <= 0.001) return false;
		cx = d.rect.x + d.rect.w / 2;
		cy = d.rect.y + d.rect.h / 2;
		w = d.rect.w;
		h = d.rect.h;
		rotation = d.rotation ?? 0;
		if (d.shadow) margin = d.shadow.blur + Math.hypot(d.shadow.offsetX, d.shadow.offsetY);
	} else {
		const d = v.draw;
		if (d.opacity <= 0.001) return false;
		cx = d.cx;
		cy = d.cy;
		w = d.width * d.scale * (d.scaleX ?? 1);
		h = d.height * d.scale * (d.scaleY ?? 1);
		rotation = d.rotation ?? 0;
	}
	const c = Math.abs(Math.cos(rotation));
	const s = Math.abs(Math.sin(rotation));
	const hw = (w * c + h * s) / 2 + margin;
	const hh = (w * s + h * c) / 2 + margin;
	return cx - hw < 0 || cy - hh < 0 || cx + hw > W || cy + hh > H;
}
