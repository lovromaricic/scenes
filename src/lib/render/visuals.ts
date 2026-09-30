import { placeOverlays, type PlacedOverlay } from '$lib/model/overlay';
import { isTextVisible, textFrameState } from '$lib/model/textAnimation';
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

/** A text item's sprite placed in a frame of the given size at time `t` (with its animation). */
export function textDraw(
	item: TextItem,
	t: number,
	width: number,
	height: number,
	sprites: TextSpriteCache
): TextDraw | null {
	const state = textFrameState(item, t);
	if (!state.visible) return null;
	const { key, sprite } = sprites.get(item, width, height);
	return {
		key,
		image: sprite.canvas,
		// Position comes from the item itself, not the cached sprite (which is only keyed by
		// words, style and size), so moving words shows up immediately.
		cx: item.x * width,
		cy: item.y * height + state.dy * Math.min(width, height),
		width: sprite.canvas.width,
		height: sprite.canvas.height,
		scale: state.scale,
		opacity: state.opacity
	};
}
