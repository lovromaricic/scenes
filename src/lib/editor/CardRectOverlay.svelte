<!--
	@component
	Resize and move a card's rectangle on the preview: 8 handles, drag inside to move, snapping to
	the frame's edges and centre lines, Shift on a corner keeps proportions. Sizes are in project
	pixels; the rectangle may overhang the frame.
-->
<script lang="ts">
	import { DragScope } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';
	import { dragBox, type Crop, type CropHandle } from '$lib/model/crop';
	import { MIN_RECT, rectFromPixels, rectToPixels } from '$lib/model/card';
	import { useEditor } from '$lib/state/context';
	import { useStageView } from './stageView.svelte';

	interface Props {
		width: number;
		height: number;
	}

	let { width, height }: Props = $props();

	const editor = useEditor();
	const stage = useStageView();

	// The card under the playhead (or the selected one): its rectangle can be clicked to select it.
	const placed = $derived(editor.inspectedScene);
	const scene = $derived(placed?.scene.kind === 'card' ? placed.scene : null);
	const rect = $derived(scene?.card?.rect ?? null);
	const format = $derived(editor.project.format);
	const active = $derived(
		!!placed &&
			!!rect &&
			!editor.playing &&
			!editor.cropping &&
			editor.time >= placed.start &&
			editor.time < placed.end
	);
	/** Handles and the size label show only while the card is selected. */
	const selected = $derived(!!scene && editor.selectedId === scene.id);
	const px = $derived(rect ? rectToPixels(rect, format) : null);
	/** Preview pixels per project pixel. */
	const scale = $derived(width / format.width);

	const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

	let dragging = $state<{
		handle: CropHandle;
		pointerId: number;
		x: number;
		y: number;
		start: Crop;
	} | null>(null);

	function apply(box: Crop) {
		const id = scene?.id;
		if (!id) return;
		editor.live((p) => {
			const s = p.scenes.find((s) => s.id === id);
			if (s?.card?.rect) s.card.rect = rectFromPixels(s.card.rect, box, format);
		});
	}

	function onpointerdown(event: PointerEvent, handle: CropHandle) {
		if (event.button !== 0 || !px || !scene) return;
		event.preventDefault();
		event.stopPropagation();
		// Clicking the rectangle selects its card; it can be dragged straight away.
		if (!selected) editor.select(scene.id);
		editor.beginGesture();
		dragging = {
			handle,
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			start: { ...px }
		};
		drags.start(event, { move: onpointermove, end: onend });
	}

	function onpointermove(event: PointerEvent) {
		const d = dragging;
		if (!d || d.pointerId !== event.pointerId) return;
		const corner = d.handle.length === 2;
		apply(
			dragBox(
				d.start,
				d.handle,
				(event.clientX - d.x) / scale,
				(event.clientY - d.y) / scale,
				format,
				{
					bounded: false,
					min: MIN_RECT,
					keepRatio: corner && event.shiftKey ? d.start.w / d.start.h : null,
					snapDistance: 8 / scale
				}
			)
		);
	}

	function onend() {
		if (!dragging) return;
		dragging = null;
		editor.endGesture('Change rectangle');
	}

	function onkeydown(event: KeyboardEvent) {
		if (!px || !scene?.card?.rect) return;
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
		const box = { ...px, x: px.x + m[0], y: px.y + m[1] };
		editor.setCard(
			scene.id,
			{ ...scene.card, rect: rectFromPixels(scene.card.rect, box, format) },
			`rect-nudge:${scene.id}`
		);
	}

	/** Every drag ends on release, cancel, lost capture or a move with no button (see drag.ts). */
	const drags = new DragScope();
	onDestroy(() => drags.dispose());
</script>

{#if active && px}
	{@const left = px.x * scale}
	{@const top = px.y * scale}
	{@const w = px.w * scale}
	{@const h = px.h * scale}
	<!-- The rectangle may overhang the frame: cut off at the stage's edges. -->
	<div class="clipper" style:clip-path={stage.clipPath}>
		<div
			class="box"
			class:selected
			data-on-video
			style:left="{left}px"
			style:top="{top}px"
			style:width="{w}px"
			style:height="{h}px"
		>
			<button
				type="button"
				class="move"
				aria-pressed={selected}
				aria-label="Rectangle, {px.w} by {px.h}. Drag to move, arrow keys to nudge."
				onpointerdown={(e) => onpointerdown(e, 'move')}
				{onkeydown}
			></button>
			{#each selected ? HANDLES : [] as handle (handle)}
				<span
					class="handle {handle}"
					data-rect-handle={handle}
					aria-hidden="true"
					onpointerdown={(e) => onpointerdown(e, handle)}
				></span>
			{/each}
		</div>
	</div>
	{#if selected}
		<span
			class="size mono"
			data-testid="rect-size"
			style:left="{left + w / 2}px"
			style:top="{top + h + 8 > height - 24 ? Math.max(4, top - 28) : top + h + 8}px"
		>
			{px.w} × {px.h}
		</span>
	{/if}
{/if}

<style>
	.clipper {
		position: absolute;
		inset: 0;
		z-index: 4;
		pointer-events: none;
	}
	.clipper .box {
		pointer-events: auto;
	}
	.box {
		position: absolute;
		z-index: 4;
	}
	.box.selected {
		outline: 1.5px solid var(--color-accent);
	}
	.box:not(.selected):hover {
		outline: 1.5px dashed color-mix(in srgb, var(--color-bg) 80%, transparent);
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
	.handle {
		position: absolute;
		width: 22px;
		height: 22px;
		translate: -50% -50%;
		touch-action: none;
		z-index: 1;
	}
	.handle::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: var(--color-bg);
		box-shadow: 0 0 0 1.5px var(--color-accent);
	}
	.nw,
	.se {
		cursor: nwse-resize;
	}
	.ne,
	.sw {
		cursor: nesw-resize;
	}
	.n,
	.s {
		cursor: ns-resize;
	}
	.e,
	.w {
		cursor: ew-resize;
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
		z-index: 6;
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
