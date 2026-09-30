import type { PlacedScene } from '$lib/model/timeline';

/** Source time shown for a scene at timeline time `t` (clamped to the scene). */
export function sourceTimeAt(placed: PlacedScene, t: number): number {
	const { scene } = placed;
	if (scene.kind !== 'video') return 0;
	const local = Math.min(placed.duration, Math.max(0, t - placed.start));
	return Math.min(scene.sourceEnd - 1e-3, scene.sourceStart + local * scene.speed);
}
