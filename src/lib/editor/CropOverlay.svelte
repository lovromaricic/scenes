<!--
	@component
	The crop box over the whole source clip (crop mode). Eight handles resize it, dragging inside
	moves it, the outside is dimmed, and a thirds grid shows while dragging. Measured in source pixels.
-->
<script lang="ts">
	import { DragScope } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';
	import { DEFAULT_FRAME, frameRect } from '$lib/model/framing';
	import { cropRatioValue, dragCrop, type Crop, type CropHandle } from '$lib/model/crop';
	import { useEditor } from '$lib/state/context';

	interface Props {
		width: number;
		height: number;
	}

	let { width, height }: Props = $props();

	const editor = useEditor();

	// What's being cropped: a scene or a layer (its source picture's size).
	const source = $derived(editor.croppingSource);
	// The player shows the whole clip fitted into the preview; the box sits over that.
	const clip = $derived(
		source
			? frameRect({ ...DEFAULT_FRAME, mode: 'fit' }, source.width, source.height, width, height)
			: null
	);
	const scale = $derived(clip && source ? clip.w / source.width : 1);
	const draft = $derived(editor.cropping?.draft ?? null);
	const locked = $derived(
		editor.cropping && source
			? cropRatioValue(editor.cropping.ratio, source, editor.project.format)
			: null
	);

	const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
	const visibleHandles = $derived(locked ? HANDLES.filter((h) => h.length === 2) : HANDLES);

	let dragging = $state<{
		handle: CropHandle;
		pointerId: number;
		x: number;
		y: number;
		start: Crop;
	} | null>(null);

	function onpointerdown(event: PointerEvent, handle: CropHandle) {
		if (event.button !== 0 || !draft) return;
		event.preventDefault();
		event.stopPropagation();
		dragging = {
			handle,
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			start: { ...draft }
		};
		drags.start(event, { move: onpointermove, end: onend });
	}

	function onpointermove(event: PointerEvent) {
		const d = dragging;
		if (!d || d.pointerId !== event.pointerId || !source) return;
		const corner = d.handle.length === 2;
		const keepRatio = corner ? (locked ?? (event.shiftKey ? d.start.w / d.start.h : null)) : null;
		editor.setCropDraft(
			dragCrop(
				d.start,
				d.handle,
				(event.clientX - d.x) / scale,
				(event.clientY - d.y) / scale,
				source,
				{
					keepRatio,
					snapDistance: 8 / scale
				}
			)
		);
	}

	function onend() {
		dragging = null;
	}

	function onkeydown(event: KeyboardEvent) {
		if (!draft || !source) return;
		const step = event.shiftKey ? 10 : 1;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		};
		const m = moves[event.key];
		if (!m) return;
		event.preventDefault();
		event.stopPropagation();
		editor.setCropDraft(dragCrop(draft, 'move', m[0], m[1], source));
	}

	const box = $derived(
		clip && draft
			? {
					left: clip.x + draft.x * scale,
					top: clip.y + draft.y * scale,
					w: draft.w * scale,
					h: draft.h * scale
				}
			: null
	);

	/** Every drag ends on release, cancel, lost capture or a move with no button (see drag.ts). */
	const drags = new DragScope();
	onDestroy(() => drags.dispose());
</script>

{#if box && clip && draft}
	<!-- The dimmed area outside the box, clipped to the clip. -->
	<div
		class="crop"
		style:left="{clip.x}px"
		style:top="{clip.y}px"
		style:width="{clip.w}px"
		style:height="{clip.h}px"
		aria-hidden="true"
	>
		<span
			class="shade"
			style:left="{box.left - clip.x}px"
			style:top="{box.top - clip.y}px"
			style:width="{box.w}px"
			style:height="{box.h}px"
		></span>
	</div>
	<!-- The box and its handles (not clipped, so handles at the clip's edges stay whole). -->
	<div
		class="box"
		style:left="{box.left}px"
		style:top="{box.top}px"
		style:width="{box.w}px"
		style:height="{box.h}px"
	>
		<button
			type="button"
			class="move"
			aria-label="Crop box, {draft.w} by {draft.h}. Drag to move, arrow keys to nudge."
			onpointerdown={(e) => onpointerdown(e, 'move')}
			ondblclick={() => editor.applyCrop()}
			{onkeydown}
		></button>
		{#if dragging}
			<span class="grid" aria-hidden="true"></span>
		{/if}
		{#each visibleHandles as h (h)}
			<span
				class="handle {h}"
				data-handle={h}
				aria-hidden="true"
				onpointerdown={(e) => onpointerdown(e, h)}
			></span>
		{/each}
	</div>
	<span
		class="size mono"
		data-testid="crop-size"
		style:left="{box.left + box.w / 2}px"
		style:top="{box.top + box.h + 8 > height - 24 ? box.top + box.h - 30 : box.top + box.h + 8}px"
	>
		{draft.w} × {draft.h}
	</span>
{/if}

<style>
	.crop {
		position: absolute;
		z-index: 6;
		overflow: hidden;
		pointer-events: none;
	}
	.shade {
		position: absolute;
		/* Everything outside the box is dimmed. */
		box-shadow: 0 0 0 9999px color-mix(in srgb, var(--color-ink) 62%, transparent);
	}
	.box {
		position: absolute;
		z-index: 7;
		outline: 1.5px solid var(--color-bg);
	}
	.move {
		position: absolute;
		inset: 0;
		padding: 0;
		border: none;
		background: transparent;
		cursor: move;
		touch-action: none;
	}
	.move:focus-visible {
		box-shadow: inset 0 0 0 2px var(--color-bg);
	}
	/* Rule-of-thirds guides while dragging. */
	.grid {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			linear-gradient(
				to right,
				transparent calc(33.33% - 0.5px),
				var(--color-bg) calc(33.33% - 0.5px),
				var(--color-bg) calc(33.33% + 0.5px),
				transparent calc(33.33% + 0.5px),
				transparent calc(66.66% - 0.5px),
				var(--color-bg) calc(66.66% - 0.5px),
				var(--color-bg) calc(66.66% + 0.5px),
				transparent calc(66.66% + 0.5px)
			),
			linear-gradient(
				to bottom,
				transparent calc(33.33% - 0.5px),
				var(--color-bg) calc(33.33% - 0.5px),
				var(--color-bg) calc(33.33% + 0.5px),
				transparent calc(33.33% + 0.5px),
				transparent calc(66.66% - 0.5px),
				var(--color-bg) calc(66.66% - 0.5px),
				var(--color-bg) calc(66.66% + 0.5px),
				transparent calc(66.66% + 0.5px)
			);
		opacity: 0.6;
	}
	.handle {
		position: absolute;
		width: 24px;
		height: 24px;
		translate: -50% -50%;
		touch-action: none;
		z-index: 1;
	}
	/* The visible part of each handle. */
	.handle::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		border-radius: 2px;
		background: var(--color-bg);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-ink) 40%, transparent);
	}
	.nw,
	.ne,
	.se,
	.sw {
		cursor: nwse-resize;
	}
	.ne,
	.sw {
		cursor: nesw-resize;
	}
	.nw::after,
	.ne::after,
	.se::after,
	.sw::after {
		width: 12px;
		height: 12px;
	}
	.n,
	.s {
		cursor: ns-resize;
	}
	.e,
	.w {
		cursor: ew-resize;
	}
	.n::after,
	.s::after {
		width: 22px;
		height: 6px;
	}
	.e::after,
	.w::after {
		width: 6px;
		height: 22px;
	}
	.nw {
		left: 0;
		top: 0;
	}
	.n {
		left: 50%;
		top: 0;
	}
	.ne {
		left: 100%;
		top: 0;
	}
	.e {
		left: 100%;
		top: 50%;
	}
	.se {
		left: 100%;
		top: 100%;
	}
	.s {
		left: 50%;
		top: 100%;
	}
	.sw {
		left: 0;
		top: 100%;
	}
	.w {
		left: 0;
		top: 50%;
	}
	.size {
		position: absolute;
		z-index: 8;
		translate: -50% 0;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: var(--text-xs);
		white-space: nowrap;
		pointer-events: none;
	}
</style>
