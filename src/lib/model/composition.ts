import type { SourceBounds } from './edits';
import type { PlacedScene } from './timeline';
import type { TransitionKind } from './types';

/**
 * Which frames make up the picture at timeline time `t`.
 *
 * A transition straddles the cut: it runs from half its length before the cut to half after.
 * During it, the outgoing scene keeps playing past its trim point if the clip has footage there
 * (and otherwise holds its last frame), and the incoming scene likewise starts early.
 * This keeps the video's length the sum of its scenes, so every lane stays aligned.
 */

export const TRANSITION_SECONDS: Record<TransitionKind, number> = {
	cut: 0,
	crossfade: 0.8,
	'fade-black': 1.0,
	slide: 0.6,
	zoom: 0.7
};

export interface LayerRef {
	placed: PlacedScene;
	/** Source time to show. */
	sourceTime: number;
}

export interface Composition {
	a: LayerRef | null;
	/** The incoming scene, during a transition. */
	b: LayerRef | null;
	transition: { kind: TransitionKind; progress: number } | null;
}

/** Transition length between two placed scenes, shortened so it fits both. */
export function transitionLength(from: PlacedScene, to: PlacedScene): number {
	const kind = from.scene.transition.kind;
	if (kind === 'cut') return 0;
	return Math.min(
		from.scene.transition.duration || TRANSITION_SECONDS[kind],
		from.duration,
		to.duration
	);
}

/** Source time for a scene at timeline time `t`, allowed to run into the clip's spare footage. */
export function extendedSourceTime(p: PlacedScene, t: number, bounds: SourceBounds): number {
	const { scene } = p;
	if (scene.kind !== 'video') return 0;
	const s = scene.sourceStart + (t - p.start) * scene.speed;
	return Math.min(bounds.end - 1e-3, Math.max(bounds.start, s));
}

export function compose(
	placed: PlacedScene[],
	t: number,
	bounds: (p: PlacedScene) => SourceBounds
): Composition {
	if (placed.length === 0) return { a: null, b: null, transition: null };
	let i = placed.findIndex((p) => t < p.end);
	if (i === -1) i = placed.length - 1;
	const layer = (p: PlacedScene): LayerRef => ({
		placed: p,
		sourceTime: extendedSourceTime(p, t, bounds(p))
	});

	const check = (from: number): Composition | null => {
		const a = placed[from];
		const b = placed[from + 1];
		if (!a || !b) return null;
		const d = transitionLength(a, b);
		if (d <= 0) return null;
		const cut = a.end;
		const begin = cut - d / 2;
		if (t < begin || t >= cut + d / 2) return null;
		return {
			a: layer(a),
			b: layer(b),
			transition: { kind: a.scene.transition.kind, progress: (t - begin) / d }
		};
	};

	return check(i - 1) ?? check(i) ?? { a: layer(placed[i]), b: null, transition: null };
}
