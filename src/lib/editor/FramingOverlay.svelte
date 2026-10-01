<!--
	@component
	Reframing a Custom scene on the preview. The whole picture shows as a dimmed "ghost" around the
	frame, so you can see what's outside it; drag to move, scroll or pinch to zoom.
-->
<script lang="ts">
	import { mediaNoun } from '$lib/model/labels';
	import { DragScope } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';
	import Move from '@lucide/svelte/icons/move';
	import { onMount } from 'svelte';
	import { clampFrame, DEFAULT_FRAME, frameRect, type SceneFrame } from '$lib/model/framing';
	import { sourceTimeAt } from '$lib/playback/time';
	import { croppedSize } from '$lib/model/crop';
	import { useEditor } from '$lib/state/context';

	interface Props {
		width: number;
		height: number;
	}

	let { width, height }: Props = $props();

	const editor = useEditor();

	const placed = $derived(editor.selectedScene);
	const scene = $derived(placed?.scene ?? null);
	const info = $derived(scene ? editor.media[scene.mediaId] : null);
	/** What framing works with: the cropped part of the clip. */
	const size = $derived(info && scene ? croppedSize(scene.crop, info) : null);
	/** The framing at the playhead (animated, when the scene has keyframes). */
	const frame = $derived.by(() => {
		const f = scene?.frame ?? DEFAULT_FRAME;
		const v = scene ? editor.frameValues(scene.id) : null;
		return v ? { ...f, ...v } : f;
	});
	const active = $derived(
		!!placed &&
			!!info &&
			frame.mode === 'custom' &&
			!editor.cropping &&
			!editor.playing &&
			editor.time >= placed.start &&
			editor.time < placed.end
	);
	const rect = $derived(
		size && active ? frameRect(frame, size.width, size.height, width, height) : null
	);

	// The ghost picture: the decoded frame at the playhead, drawn into a canvas the size of `rect`.
	let ghost = $state<HTMLCanvasElement>();
	let lastImage: unknown = null;
	let raf = 0;

	onMount(() => {
		const tick = () => {
			raf = requestAnimationFrame(tick);
			if (!ghost || !placed || !rect) return;
			const t = sourceTimeAt(placed, editor.time);
			const image = editor.player.frameImage(placed.scene.id, t);
			const w = Math.max(1, Math.round(rect.w));
			const h = Math.max(1, Math.round(rect.h));
			if (!image || (image === lastImage && ghost.width === w && ghost.height === h)) return;
			lastImage = image;
			ghost.width = w;
			ghost.height = h;
			// Only the cropped part of the picture, like the preview.
			const img = image as HTMLCanvasElement | ImageBitmap;
			const k = info ? img.width / info.width : 1;
			const c = scene?.crop ?? { x: 0, y: 0, w: img.width / k, h: img.height / k };
			ghost.getContext('2d')?.drawImage(img, c.x * k, c.y * k, c.w * k, c.h * k, 0, 0, w, h);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	// ─── Moving and zooming ─────────────────────────────────────────────────────────────────
	// Pointer positions for dragging and pinching; internal only, so not reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pointers = new Map<number, { x: number; y: number }>();
	let start: { frame: SceneFrame; x: number; y: number; distance: number } | null = null;

	function clamped(f: SceneFrame): SceneFrame {
		return size
			? clampFrame(
					f,
					size.width,
					size.height,
					editor.project.format.width,
					editor.project.format.height
				)
			: f;
	}

	/** Id for a keyframe a drag may add (the same one all through the drag). */
	let kfId = '';

	function update(f: SceneFrame) {
		const id = scene?.id;
		if (!id) return;
		const next = clamped(f);
		// At the playhead: with keyframes, only the keyframe there changes.
		editor.liveFrameValues(id, { x: next.x, y: next.y, zoom: next.zoom }, kfId);
	}

	/** Every drag ends on release, cancel, lost capture or a move with no button (see drag.ts). */
	const drags = new DragScope();
	onDestroy(() => drags.dispose());

	function distance(): number {
		const [a, b] = [...pointers.values()];
		return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
	}

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		// Each finger (or the mouse) is its own drag, so a second finger can pinch.
		const id = event.pointerId;
		drags.start(event, { move: onpointermove, end: () => onend(id) });
		if (!start) {
			editor.beginGesture();
			kfId = crypto.randomUUID();
		}
		const [p] = [...pointers.values()];
		start = { frame: { ...frame }, x: p.x, y: p.y, distance: distance() };
	}

	function onpointermove(event: PointerEvent) {
		if (!pointers.has(event.pointerId) || !start) return;
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (pointers.size >= 2 && start.distance > 0) {
			// Pinch to zoom.
			update({ ...start.frame, zoom: start.frame.zoom * (distance() / start.distance) });
			return;
		}
		const [p] = [...pointers.values()];
		update({
			...start.frame,
			x: start.frame.x + (p.x - start.x) / width,
			y: start.frame.y + (p.y - start.y) / height
		});
	}

	function onend(pointerId: number) {
		if (!pointers.delete(pointerId)) return;
		if (pointers.size > 0 && start) {
			const [p] = [...pointers.values()];
			start = { frame: { ...frame }, x: p.x, y: p.y, distance: 0 };
			return;
		}
		start = null;
		editor.endGesture('Reframe');
	}

	function onwheel(event: WheelEvent) {
		if (!scene) return;
		event.preventDefault();
		const factor = Math.exp(-event.deltaY * 0.0015);
		editor.setFrameValues(scene.id, { zoom: clamped({ ...frame, zoom: frame.zoom * factor }).zoom }, `zoom:${scene.id}`);
	}

	function onkeydown(event: KeyboardEvent) {
		if (!scene) return;
		const step = event.shiftKey ? 0.05 : 0.01;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		};
		let next: SceneFrame | null = null;
		if (event.key in moves)
			next = { ...frame, x: frame.x + moves[event.key][0], y: frame.y + moves[event.key][1] };
		else if (event.key === '+' || event.key === '=') next = { ...frame, zoom: frame.zoom * 1.05 };
		else if (event.key === '-') next = { ...frame, zoom: frame.zoom / 1.05 };
		if (!next) return;
		event.preventDefault();
		event.stopPropagation();
		const c = clamped(next);
		editor.setFrameValues(scene.id, { x: c.x, y: c.y, zoom: c.zoom }, `nudge:${scene.id}`);
	}
</script>

{#if active && rect}
	<canvas
		bind:this={ghost}
		class="ghost"
		style:left="{rect.x}px"
		style:top="{rect.y}px"
		style:width="{rect.w}px"
		style:height="{rect.h}px"
		aria-hidden="true"
	></canvas>
	<button
		type="button"
		class="handle"
		data-on-video
		aria-label="Reframe: drag to move the {scene
			? mediaNoun(scene)
			: 'picture'}, scroll or pinch to zoom, or use the arrow keys and + / −"
		style:left="{Math.min(0, rect.x)}px"
		style:top="{Math.min(0, rect.y)}px"
		style:width="{Math.max(width, rect.x + rect.w) - Math.min(0, rect.x)}px"
		style:height="{Math.max(height, rect.y + rect.h) - Math.min(0, rect.y)}px"
		{onpointerdown}
		{onwheel}
		{onkeydown}
	></button>
	<span class="outline" aria-hidden="true"></span>
	<p class="hint">
		<Move size={13} strokeWidth={2} aria-hidden="true" /> Drag to move · Scroll to zoom
	</p>
{/if}

<style>
	/* Everything outside the frame shows faded; inside, the real preview covers it. */
	.ghost {
		position: absolute;
		z-index: 0;
		opacity: 0.35;
		outline: 1.5px dashed var(--color-muted);
		pointer-events: none;
	}
	.handle {
		position: absolute;
		z-index: 3;
		padding: 0;
		border: none;
		background: transparent;
		cursor: grab;
		touch-action: none;
	}
	.handle:active {
		cursor: grabbing;
	}
	.handle:focus-visible {
		box-shadow: none;
		outline: none;
	}
	.handle:focus-visible ~ .outline {
		outline-width: 3px;
	}
	/* The video frame's own outline. */
	.outline {
		position: absolute;
		inset: 0;
		z-index: 2;
		border-radius: inherit;
		outline: 2px solid var(--color-ink);
		pointer-events: none;
	}
	.hint {
		position: absolute;
		left: 50%;
		bottom: var(--space-3);
		translate: -50% 0;
		z-index: 4;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 12px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: var(--text-xs);
		white-space: nowrap;
		pointer-events: none;
	}
</style>
