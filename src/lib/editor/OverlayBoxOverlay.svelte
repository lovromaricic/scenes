<!--
	@component
	Layers on the preview: click one to select it, drag to move, drag a handle to resize (snapping
	to the frame's edges and centre lines, with a live size label). Photos and videos keep their
	own proportions at every handle unless Shift is held (for cards, Shift on a corner keeps them).
	The selected layer
	gets a floating toolbar: Crop, Style, Animate, Remove.
-->
<script lang="ts">
	import Crop from '@lucide/svelte/icons/crop';
	import Paintbrush from '@lucide/svelte/icons/paintbrush';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { FloatingToolbar } from '$lib/ui';
	import { dragBox, type Crop as Box, type CropHandle } from '$lib/model/crop';
	import type { Overlay, OverlayBox, PlacedOverlay } from '$lib/model/overlay';
	import { useEditor } from '$lib/state/context';
	import { DragScope } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';
	import OverlayStyleFields from './OverlayStyleFields.svelte';
	import OverlayAnimationFields from './OverlayAnimationFields.svelte';

	interface Props {
		width: number;
		height: number;
	}

	let { width, height }: Props = $props();

	const editor = useEditor();
	const format = $derived(editor.project.format);
	/** Preview pixels per project pixel. */
	const scale = $derived(width / format.width);
	/** Layers showing at the playhead, lowest first (so higher ones are on top here too). */
	const showing = $derived(
		editor.playing || editor.cropping
			? []
			: editor.placedOverlays.filter((p) => editor.time >= p.start && editor.time < p.end)
	);

	const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
	/** Moves smaller than this are a click, not a drag. */
	const CLICK = 3;

	const toPixels = (b: OverlayBox): Box => ({
		x: Math.round(b.x * format.width),
		y: Math.round(b.y * format.height),
		w: Math.round(b.w * format.width),
		h: Math.round(b.h * format.height)
	});
	const fromPixels = (b: Box): OverlayBox => ({
		x: b.x / format.width,
		y: b.y / format.height,
		w: b.w / format.width,
		h: b.h / format.height
	});

	let popover = $state<'style' | 'animate' | null>(null);
	/** Every drag ends on release, cancel, lost capture or a move with no button (see drag.ts). */
	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	let dragging = $state<{
		id: string;
		handle: CropHandle;
		pointerId: number;
		x: number;
		y: number;
		start: Box;
		moved: boolean;
	} | null>(null);

	function onpointerdown(event: PointerEvent, o: Overlay, handle: CropHandle) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		// Clicking a layer selects it; it can be dragged straight away.
		if (editor.selectedId !== o.id) {
			editor.select(o.id);
			popover = null;
		}
		dragging = {
			id: o.id,
			handle,
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			start: toPixels(o.box),
			moved: false
		};
		drags.start(event, { move: onpointermove, end: onend });
	}

	function onpointermove(event: PointerEvent) {
		const d = dragging;
		if (!d || d.pointerId !== event.pointerId) return;
		if (!d.moved) {
			if (Math.hypot(event.clientX - d.x, event.clientY - d.y) < CLICK) return;
			d.moved = true;
			popover = null;
			editor.beginGesture();
		}
		const o = editor.project.overlays.find((x) => x.id === d.id);
		if (!o) return;
		const corner = d.handle.length === 2;
		// Photos and videos always scale in their own shape (every handle), unless Shift is held;
		// cropping is what the Crop tool is for. Cards are free-form; Shift on a corner keeps
		// their shape.
		const picture = o.kind === 'card' ? null : editor.sourceSize(o);
		const pictureRatio = picture
			? o.crop
				? o.crop.w / o.crop.h
				: picture.width / picture.height
			: null;
		const ratio =
			pictureRatio && !event.shiftKey
				? pictureRatio
				: o.kind === 'card' && corner && event.shiftKey
					? d.start.w / d.start.h
					: null;
		const box = dragBox(
			d.start,
			d.handle,
			(event.clientX - d.x) / scale,
			(event.clientY - d.y) / scale,
			format,
			{
				bounded: false,
				min: 16,
				keepRatio: ratio,
				keepRatioOnEdges: !!pictureRatio,
				snapDistance: 8 / scale
			}
		);
		editor.live((p) => {
			const target = p.overlays.find((x) => x.id === d.id);
			if (target) target.box = fromPixels(box);
		});
	}

	function onend() {
		const d = dragging;
		if (!d) return;
		dragging = null;
		if (d.moved) editor.endGesture(d.handle === 'move' ? 'Move layer' : 'Resize layer');
	}

	function onkeydown(event: KeyboardEvent, o: Overlay) {
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
		const px = toPixels(o.box);
		editor.setOverlayBox(o.id, fromPixels({ ...px, x: px.x + m[0], y: px.y + m[1] }), `nudge:${o.id}`);
	}

	function actions(o: Overlay) {
		return [
			...(o.kind === 'card'
				? []
				: [{ id: 'crop', label: 'Crop', icon: Crop, onclick: () => editor.enterCrop(o.id) }]),
			{
				id: 'style',
				label: 'Style',
				icon: Paintbrush,
				onclick: () => (popover = popover === 'style' ? null : 'style')
			},
			{
				id: 'animate',
				label: 'Animate',
				icon: Sparkles,
				onclick: () => (popover = popover === 'animate' ? null : 'animate')
			},
			{ id: 'remove', label: 'Remove', icon: Trash2, onclick: () => editor.deleteOverlay(o.id) }
		];
	}

	// Close the popover on Escape or a click anywhere else.
	function onWindowPointerDown(event: PointerEvent) {
		if (popover && !(event.target as HTMLElement).closest('.layer-toolbar')) popover = null;
	}
	function onWindowKeydown(event: KeyboardEvent) {
		if (popover && event.key === 'Escape') {
			event.stopPropagation();
			popover = null;
		}
	}

	function geometry(p: PlacedOverlay) {
		const px = toPixels(p.overlay.box);
		return { px, left: px.x * scale, top: px.y * scale, w: px.w * scale, h: px.h * scale };
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydowncapture={onWindowKeydown} />

{#each showing as p (p.overlay.id)}
	{@const o = p.overlay}
	{@const g = geometry(p)}
	{@const selected = editor.selectedId === o.id}
	<div
		class="layer-box"
		class:selected
		data-on-video
		data-layer-box={o.id}
		style:left="{g.left}px"
		style:top="{g.top}px"
		style:width="{g.w}px"
		style:height="{g.h}px"
	>
		<button
			type="button"
			class="move"
			aria-pressed={selected}
			aria-label="Layer {o.name} on the video, {g.px.w} by {g.px.h}. Drag to move, arrow keys to nudge."
			onpointerdown={(e) => onpointerdown(e, o, 'move')}
			onkeydown={(e) => onkeydown(e, o)}
			onclick={(e) => {
				if (e.detail === 0) editor.select(o.id);
			}}
		></button>
		{#if selected}
			{#each HANDLES as handle (handle)}
				<span
					class="handle {handle}"
					data-layer-handle={handle}
					aria-hidden="true"
					onpointerdown={(e) => onpointerdown(e, o, handle)}
				></span>
			{/each}
		{/if}
	</div>
	{#if selected && !dragging}
		<!-- Outside the layer's box, and stacked above the words on the video: the toolbar and its
			popovers must never have words (or other layers) on top of them, catching clicks. -->
		<div
			class="toolbar-anchor"
			data-on-video
			style:left="{g.left}px"
			style:top="{g.top}px"
			style:width="{g.w}px"
			style:height="{g.h}px"
		>
			<div class="layer-toolbar" class:below={g.top < 64}>
				<FloatingToolbar label="Layer options" actions={actions(o)} />
				{#if popover === 'style'}
					<div class="popover" role="dialog" aria-label="Layer style">
						<OverlayStyleFields overlay={o} />
					</div>
				{:else if popover === 'animate'}
					<div class="popover" role="dialog" aria-label="Layer animation">
						<OverlayAnimationFields overlay={o} />
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if selected && !popover}
		<span
			class="size mono"
			data-testid="layer-size"
			style:left="{g.left + g.w / 2}px"
			style:top="{g.top + g.h + 8 > height - 24
				? Math.max(4, Math.min(g.top + g.h, height) - 30)
				: g.top + g.h + 8}px"
		>
			{g.px.w} × {g.px.h}
		</span>
	{/if}
{/each}

<style>
	.layer-box {
		position: absolute;
		z-index: 4;
	}
	.layer-box.selected {
		z-index: 5;
		outline: 1.5px solid var(--color-accent);
	}
	.layer-box:not(.selected):hover {
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
	/* Above the words (z-index 5) and every layer box; only its toolbar takes clicks. */
	.toolbar-anchor {
		position: absolute;
		z-index: 7;
		pointer-events: none;
	}
	.layer-toolbar {
		pointer-events: auto;
		position: absolute;
		bottom: calc(100% + 12px);
		left: 50%;
		translate: -50% 0;
		z-index: 6;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-md);
	}
	.layer-toolbar.below {
		bottom: auto;
		top: calc(100% + 12px);
	}
	.popover {
		position: absolute;
		top: calc(100% + 8px);
		width: 300px;
		padding: var(--space-4);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		box-shadow: var(--shadow-float);
		animation: pop-in var(--dur-fast) var(--ease-out);
	}
	@keyframes pop-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
