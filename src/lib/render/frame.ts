import type { FrameResult } from '$lib/media/frames';
import { MOOD_GRADES } from '$lib/model/moods';
import { textFrameState } from '$lib/model/textAnimation';
import type { MoodId, Scene, TextItem } from '$lib/model/types';
import type { LayerInput, TextDraw } from './compositor';
import type { TextSpriteCache } from './text';

/**
 * Pieces of an output frame shared by the live preview and export, so both build frames the
 * same way (moods, text placement and animation).
 */

export function layerInput(frame: FrameResult, scene: Scene, projectMood: MoodId): LayerInput {
	return {
		image: frame.image,
		width: frame.width,
		height: frame.height,
		grade: MOOD_GRADES[scene.mood ?? projectMood]
	};
}

/** The text sprites showing at time `t` in a frame of the given size, with animation applied. */
export function textDrawsAt(
	texts: TextItem[],
	t: number,
	width: number,
	height: number,
	sprites: TextSpriteCache,
	hiddenId: string | null = null
): TextDraw[] {
	const draws: TextDraw[] = [];
	for (const item of texts) {
		if (item.id === hiddenId) continue;
		const state = textFrameState(item, t);
		if (!state.visible) continue;
		const { key, sprite } = sprites.get(item, width, height);
		draws.push({
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
		});
	}
	return draws;
}
