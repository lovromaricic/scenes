import type { FrameResult } from '$lib/media/frames';
import { MOOD_GRADES } from '$lib/model/moods';
import { frameRect } from '$lib/model/framing';
import { croppedSize, cropUv, type Size } from '$lib/model/crop';
import type { MoodId, Scene } from '$lib/model/types';
import type { LayerInput } from './compositor';
import { sceneFrameAt } from '$lib/model/keyframes';

/**
 * Pieces of an output frame shared by the live preview and export, so both build frames the
 * same way (moods, text placement and animation).
 */

/**
 * One scene's picture for an output frame of outW × outH: its crop (applied first), then its
 * framing (animated at `contentTime`, see keyframes.ts), and its mood. `source` is the clip's
 * own size in pixels (crop is measured in it).
 */
export function layerInput(
	frame: FrameResult,
	scene: Scene,
	projectMood: MoodId,
	outW: number,
	outH: number,
	source: Size = { width: frame.width, height: frame.height },
	contentTime: number = scene.sourceStart
): LayerInput {
	// The decoded image may be smaller than the source; crop maps across proportionally.
	const cropped = croppedSize(scene.crop, source);
	const aspectW = (cropped.width / source.width) * frame.width;
	const aspectH = (cropped.height / source.height) * frame.height;
	return {
		image: frame.image,
		width: frame.width,
		height: frame.height,
		// Cards are drawn in their exact colours: no mood.
		grade: MOOD_GRADES[scene.kind === 'card' ? 'natural' : (scene.mood ?? projectMood)],
		// Custom framing follows its keyframes, at the scene's own (content) time.
		rect: frameRect(sceneFrameAt(scene.frame, scene.keyframes, contentTime), aspectW, aspectH, outW, outH),
		bars: scene.frame?.bars ?? 'black',
		uv: cropUv(scene.crop, source)
	};
}
