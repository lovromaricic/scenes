<!--
	@component
	The Layers track: overlays (videos, photos, cards drawn on top of the scenes), in rows above the
	Scenes track. The highest row is drawn on top in the video, and is shown at the top here. Drag
	an item to move it in time or to another row (above the top row makes a new one); drag its
	ends to change how long it shows. A selected item shows a thin line to the scene it's
	linked to (it moves with that scene).
-->
<script lang="ts">
	import { DragScope } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';

	/** Every drag ends on release, cancel, lost capture or a move with no button (see drag.ts). */
	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	import Layers from '@lucide/svelte/icons/layers';
	import { formatShort } from '$lib/model/time';
	import { rowCount, type Overlay, type PlacedOverlay } from '$lib/model/overlay';
	import { useEditor } from '$lib/state/context';
	import type { TimeMap } from './scale';
	import { dragHasVisual, handleVisualDrop } from '$lib/media/dragTypes';
	import { OVERLAY_SECONDS } from '$lib/model/overlay';

	interface Props {
		map: TimeMap;
		rowHeight: number;
		/** Gap between the Layers rows and the Scenes row (for the link line). */
		gap: number;
		/** The track's height, for the label beside it. */
		height?: number;
		/** A scene being dragged up into the track: where it would land as a layer. */
		ghost?: { start: number; duration: number; row: number } | null;
		/** Dragging a layer down into the Scenes track: where it would go, and showing that. */
		toScenes?: { index(clientX: number): number; hover(index: number | null): void };
	}

	let { map, rowHeight, gap, height = $bindable(0), ghost = null, toScenes }: Props = $props();

	const editor = useEditor();

	const rows = $derived(rowCount(editor.project.overlays));
	const empty = $derived(editor.project.overlays.length === 0);

	type Mode = 'move' | 'start' | 'end';
	let gesture = $state<{
		id: string;
		mode: Mode;
		pointerId: number;
		startX: number;
		startY: number;
		original: PlacedOverlay;
		active: boolean;
		/** Where it would go: start time, row, duration (and source start for trims). */
		start: number;
		row: number;
		duration: number;
		sourceStart: number;
		/** Dragged down below the track: the scene position it would become (else null). */
		toScene: number | null;
		dy: number;
	} | null>(null);

	/**
	 * The row a drag points at: whole rows up or down from where it started. (Measured from the
	 * pointer's travel, not the track's position, because the storyboard sits at the bottom of the
	 * window and grows upwards while a new row appears.) `rows` means a new row above the top.
	 */
	function rowAt(clientY: number, startY: number, startRow: number): number {
		const steps = Math.round((startY - clientY) / rowHeight);
		return Math.max(0, Math.min(rows, startRow + steps));
	}

	function onpointerdown(event: PointerEvent, placed: PlacedOverlay, mode: Mode) {
		if (event.button !== 0) return;
		event.stopPropagation();
		const o = placed.overlay;
		gesture = {
			id: o.id,
			mode,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			original: placed,
			active: false,
			start: placed.start,
			row: o.row,
			duration: o.duration,
			sourceStart: o.sourceStart,
			toScene: null,
			dy: 0
		};
		drags.start(event, { move: onpointermove, end: onend });
	}

	function onpointermove(event: PointerEvent) {
		const g = gesture;
		if (!g || event.pointerId !== g.pointerId) return;
		const dx = event.clientX - g.startX;
		if (!g.active) {
			if (Math.hypot(dx, event.clientY - g.startY) < 4) return;
			g.active = true;
		}
		const o = g.original.overlay;
		if (g.mode === 'move') {
			// Below the track: it would become a scene.
			const bottom = layersEl.getBoundingClientRect().bottom;
			g.dy = event.clientY - g.startY;
			if (toScenes && event.clientY > bottom + 8) {
				g.toScene = toScenes.index(event.clientX);
				toScenes.hover(g.toScene);
				return;
			}
			if (g.toScene !== null) {
				g.toScene = null;
				toScenes?.hover(null);
			}
			const latest = Math.max(0, editor.duration - 0.5);
			g.start = Math.min(latest, Math.max(0, map.t(map.x(g.original.start) + dx)));
			g.row = rowAt(event.clientY, g.startY, o.row);
			editor.seek(g.start);
		} else {
			const from = g.mode === 'end' ? g.original.end : g.original.start;
			const delta = map.t(map.x(from) + dx) - from;
			const next = editor.resizeOverlay(o, g.mode, delta);
			g.start = next.start;
			g.duration = next.duration;
			g.sourceStart = next.sourceStart;
			editor.seek(g.mode === 'end' ? next.start + next.duration - 0.05 : next.start);
		}
	}

	function onend() {
		const g = gesture;
		if (!g) return;
		gesture = null;
		if (!g.active) {
			editor.select(g.id);
			return;
		}
		if (g.toScene !== null) {
			toScenes?.hover(null);
			editor.overlayToScene(g.id, g.toScene);
			return;
		}
		if (g.mode === 'move') editor.placeOverlay(g.id, g.start, g.row);
		else editor.setOverlayTiming(g.id, g.start, g.duration, g.sourceStart);
		editor.select(g.id);
	}

	function onkeydown(event: KeyboardEvent, placed: PlacedOverlay) {
		if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		const step = event.shiftKey ? 1 : 0.1;
		const o = placed.overlay;
		editor.placeOverlay(o.id, placed.start + (event.key === 'ArrowLeft' ? -step : step), o.row);
	}

	/** Where an item is drawn: its own place, or where it's being dragged. */
	function geometry(p: PlacedOverlay) {
		const g = gesture?.active && gesture.id === p.overlay.id ? gesture : null;
		const start = g ? g.start : p.start;
		const duration = g ? g.duration : p.overlay.duration;
		const row = g ? g.row : p.overlay.row;
		return {
			left: map.x(start),
			width: map.width(start, duration) - 3,
			top: (rows + (newTopRow ? 1 : 0) - 1 - row) * rowHeight,
			start,
			duration
		};
	}

	/** A new row is about to be made above the top one. */
	const newTopRow = $derived(!!gesture?.active && gesture.mode === 'move' && gesture.row >= rows);
	$effect(() => {
		height = (rows + (newTopRow ? 1 : 0)) * rowHeight;
	});

	// ─── Dropping from "Your media", the Cards button or the computer ──────────────────────
	let layersEl: HTMLDivElement;
	/** Where a drop would go: time and row. */
	let drop = $state<{ start: number; row: number } | null>(null);
	let dropDepth = 0;

	function dropAt(event: DragEvent) {
		// The track starts at time 0 and scrolls with the storyboard, so its own box gives the time.
		const rect = layersEl.getBoundingClientRect();
		const start = Math.max(0, Math.min(map.t(event.clientX - rect.left), Math.max(0, editor.duration - 0.5)));
		// Rows from the bottom; nothing grows while dragging over, so the track stays put.
		const row = Math.max(0, Math.min(rows - 1, Math.floor((rect.bottom - event.clientY) / rowHeight)));
		return { start, row };
	}

	function ondragenter(event: DragEvent) {
		if (!dragHasVisual(event)) return;
		event.preventDefault();
		dropDepth++;
		drop = dropAt(event);
	}
	function ondragover(event: DragEvent) {
		if (!dragHasVisual(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		drop = dropAt(event);
	}
	function ondragleave(event: DragEvent) {
		if (!dragHasVisual(event)) return;
		dropDepth = Math.max(0, dropDepth - 1);
		if (dropDepth === 0) drop = null;
	}
	function ondrop(event: DragEvent) {
		if (!dragHasVisual(event)) return;
		const at = dropAt(event);
		drop = null;
		dropDepth = 0;
		const noScenes = editor.project.scenes.length === 0;
		const placed = handleVisualDrop(event, {
			media: (id) => (noScenes ? editor.addSceneFromMedia(id) : editor.addOverlayFromMedia(id, at.start, at.row)),
			card: () => (noScenes ? editor.addCard() : editor.addCardOverlay(at.start, at.row)),
			files: (files) => void editor.importAsOverlays(files, at.start, at.row)
		});
		if (placed) event.preventDefault();
	}

	function thumbnail(o: Overlay): string | undefined {
		if (o.kind === 'card') return undefined;
		const url = editor.thumbnails[o.mediaId];
		return url ? `url("${url}")` : undefined;
	}

	// The link line: from the selected item down to the start of its scene.
	const link = $derived.by(() => {
		const p = editor.selectedOverlay;
		if (!p || gesture?.active) return null;
		const scene = editor.placed.find((s) => s.scene.id === p.overlay.sceneId);
		if (!scene) return null;
		const g = geometry(p);
		return { x1: g.left + 1, y1: g.top + rowHeight - 3, x0: map.x(scene.start) + 1, y2: height + gap };
	});
</script>

<div
	class="layers"
	class:drop-hover={!!drop}
	bind:this={layersEl}
	style:height="{height}px"
	role="presentation"
	{ondragenter}
	{ondragover}
	{ondragleave}
	{ondrop}
>
	{#if ghost}
		<span
			class="drop-ghost"
			aria-hidden="true"
			style:left="{map.x(ghost.start)}px"
			style:width="{map.width(ghost.start, ghost.duration) - 3}px"
			style:top="{Math.max(0, rows - 1 - ghost.row) * rowHeight + 2}px"
			style:height="{rowHeight - 4}px"
		>
			<span>Make it a layer</span>
		</span>
	{/if}
	{#if drop}
		<span
			class="drop-ghost"
			aria-hidden="true"
			style:left="{map.x(drop.start)}px"
			style:width="{map.width(drop.start, OVERLAY_SECONDS) - 3}px"
			style:top="{(rows - 1 - drop.row) * rowHeight + 2}px"
			style:height="{rowHeight - 4}px"
		>
			<span>Place here</span>
		</span>
	{/if}
	{#if newTopRow}
		<span class="new-row" style:height="{rowHeight - 4}px" aria-hidden="true"></span>
	{/if}
	{#if empty && !drop && !ghost}
		<p class="hint">
			<Layers size={13} strokeWidth={1.8} aria-hidden="true" />
			Drop videos, images or cards here to place them on top
		</p>
	{/if}

	{#each editor.placedOverlays as placed (placed.overlay.id)}
		{@const o = placed.overlay}
		{@const g = geometry(placed)}
		{@const selected = editor.selectedId === o.id}
		{@const active = gesture?.active && gesture.id === o.id}
		<div
			class="layer-slot"
			class:active
			class:narrow={g.width < 64}
			data-overlay-id={o.id}
			style:left="{g.left}px"
			style:width="{g.width}px"
			style:top="{g.top + 2}px"
			style:height="{rowHeight - 4}px"
			style:translate={active && gesture?.toScene !== null ? `0 ${gesture?.dy ?? 0}px` : undefined}
			class:to-scene={active && gesture?.toScene !== null}
		>
			<button
				type="button"
				class="layer {o.kind}"
				class:selected
				title="{o.name} · {formatShort(g.duration)} — drag to move, drag the ends to change how long it shows"
				aria-label="Layer: {o.name}, from {formatShort(g.start)} for {formatShort(g.duration)}"
				aria-pressed={selected}
				aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
				onpointerdown={(e) => onpointerdown(e, placed, 'move')}
				onclick={(e) => {
					// Keyboard activation only; pointer clicks are handled on pointerup.
					if (e.detail === 0) editor.select(o.id);
				}}
				onkeydown={(e) => onkeydown(e, placed)}
			>
				<span
					class="thumb"
					style:background-image={thumbnail(o)}
					style:background-color={o.kind === 'card' ? o.card?.background : undefined}
				>
					{#if o.kind === 'card' && o.card?.rect}
						<span class="card-rect" style:background={o.card.rect.color}></span>
					{/if}
				</span>
				<span class="meta">
					<span class="name">{o.name}</span>
					<span class="dur mono">{formatShort(g.duration)}</span>
				</span>
			</button>
			{#each ['start', 'end'] as const as edge (edge)}
				<span
					class="edge {edge}"
					class:visible={selected}
					aria-hidden="true"
					onpointerdown={(e) => onpointerdown(e, placed, edge)}
				></span>
			{/each}
			{#if active}
				<span class="badge mono">{formatShort(g.start)} · {formatShort(g.duration)}</span>
			{/if}
		</div>
	{/each}

	{#if link}
		<svg class="link" aria-hidden="true" style:height="{link.y2}px">
			<path
				d="M {link.x1} {link.y1} V {link.y2 - gap / 2} H {link.x0} V {link.y2}"
				fill="none"
				stroke="var(--color-accent)"
				stroke-width="1"
				stroke-dasharray="3 3"
			/>
			<circle cx={link.x0} cy={link.y2 - 1} r="2.5" fill="var(--color-accent)" />
		</svg>
	{/if}
</div>

<style>
	.layers {
		position: relative;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-surface) 55%, var(--color-bg));
		transition: height var(--dur) var(--ease-out);
	}
	.drop-hover {
		box-shadow: inset 0 0 0 1.5px var(--color-ink);
	}
	.drop-ghost {
		position: absolute;
		z-index: 8;
		display: flex;
		align-items: flex-end;
		padding: 4px 6px;
		border: 2px dashed var(--color-ink);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-bg) 70%, transparent);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		pointer-events: none;
	}
	.hint {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		padding-left: var(--space-3);
		color: var(--color-muted);
		font-size: var(--text-xs);
		pointer-events: none;
	}
	.new-row {
		position: absolute;
		left: 0;
		right: 0;
		top: 2px;
		border: 1.5px dashed var(--color-muted);
		border-radius: var(--radius-sm);
	}
	.layer-slot {
		position: absolute;
		touch-action: none;
		user-select: none;
		transition:
			left var(--dur) var(--ease-out),
			top var(--dur) var(--ease-out),
			width var(--dur) var(--ease-out);
	}
	.layer-slot.active {
		z-index: 6;
		transition: none;
	}
	.layer-slot.to-scene {
		z-index: 20;
		opacity: 0.85;
	}
	.layer {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		padding: 3px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		overflow: hidden;
		text-align: left;
		cursor: grab;
		touch-action: none;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.layer:hover {
		border-color: var(--color-muted);
	}
	.layer.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}
	.active .layer {
		cursor: grabbing;
		box-shadow: var(--shadow-float);
	}
	.thumb {
		position: relative;
		flex: 1;
		min-height: 0;
		border-radius: 5px;
		background-color: var(--color-surface);
		background-size: auto 100%;
		background-repeat: repeat-x;
		background-position: left center;
	}
	.card-rect {
		position: absolute;
		inset: 25% 30%;
		border-radius: 2px;
	}
	.meta {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px;
		height: 16px;
		padding: 2px 3px 0;
		font-size: var(--text-xs);
		line-height: 14px;
	}
	.name {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-weight: var(--weight-medium);
	}
	.dur {
		flex: none;
		color: var(--color-muted);
	}
	/* Short items show just their picture; the name is in the tooltip. */
	.narrow .meta {
		display: none;
	}
	.edge {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 8px;
		cursor: ew-resize;
		z-index: 1;
		touch-action: none;
	}
	@media (pointer: coarse) {
		.edge {
			width: 16px;
		}
	}
	.edge.start {
		left: -2px;
	}
	.edge.end {
		right: -2px;
	}
	.layer-slot:hover .edge::after,
	.edge.visible::after {
		content: '';
		position: absolute;
		top: 25%;
		bottom: 25%;
		left: 3px;
		width: 2px;
		border-radius: 1px;
		background: var(--color-muted);
	}
	.edge.visible::after {
		background: var(--color-accent);
	}
	.badge {
		position: absolute;
		bottom: calc(100% + 4px);
		left: 50%;
		translate: -50% 0;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: var(--text-xs);
		white-space: nowrap;
		z-index: 7;
	}
	.link {
		position: absolute;
		left: 0;
		top: 0;
		width: 100%;
		overflow: visible;
		pointer-events: none;
		z-index: 5;
	}
</style>
