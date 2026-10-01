<!--
	@component
	Interactive layer over the preview for words: click to select, drag to move (snapping to the
	centre), double-click or "Edit words" to type in place (live: the words, the settings and the
	timeline follow every change; Enter is a new line, Esc or a click elsewhere stops). The words
	themselves are always drawn by the WebGL compositor underneath, also while they're typed.
-->
<script lang="ts">
	import { frameBatch } from '$lib/ui/frameBatch';
	import { DragScope } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Paintbrush from '@lucide/svelte/icons/paintbrush';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { FloatingToolbar, ChipGroup } from '$lib/ui';
	import { TEXT_ANIMATIONS } from '$lib/model/catalog';
	import { isTextVisible } from '$lib/model/textAnimation';
	import type { TextAnimation, TextItem } from '$lib/model/types';
	import { layoutText } from '$lib/render/text';
	import { resolveTextStyle } from '$lib/model/textStyle';
	import { useEditor } from '$lib/state/context';
	import TextStylePicker from './TextStylePicker.svelte';
	import KeyframeButtons from './KeyframeButtons.svelte';
	import TextTyping from './TextTyping.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import { turnedBounds } from './toolbarPlacement';
	import { useStageView } from './stageView.svelte';
	import { snapOutside, turnedHalf } from '$lib/model/offscreen';

	interface Props {
		width: number;
		height: number;
	}

	let { width, height }: Props = $props();

	const editor = useEditor();
	const stage = useStageView();

	const SNAP = 0.015;
	/** Snapping just outside the frame's edges, in screen pixels. */
	const SNAP_OUTSIDE_PX = 8;

	const visible = $derived(
		width > 0
			? editor.project.texts.filter((t) => {
					// Words on hidden tracks aren't shown; on locked tracks they can't be changed.
					const track = editor.track(t.trackId);
					if (track?.hidden || track?.locked) return false;
					return isTextVisible(t, editor.time) || t.id === editor.editingTextId;
				})
			: []
	);

	function box(item: TextItem) {
		// Re-measure when a font finishes loading (it changes the words' size).
		void editor.fonts.version;
		// Where the words are at the playhead (keyframed), scaled and turned like the video draws.
		const v = editor.itemValues(item.id);
		// While typing on the preview: the words as typed (what the video shows, too).
		const typing = editor.typingText?.id === item.id ? editor.typingText.text : item.text;
		const placed = { ...item, text: typing, ...(v ? { x: v.x, y: v.y } : {}) };
		const l = layoutText(placed, width, height);
		return {
			item: placed,
			left: l.cx - l.areaWidth / 2,
			top: l.cy - l.height / 2,
			width: l.areaWidth,
			height: l.height,
			layout: l,
			scale: v && (v.scaleX !== 1 || v.scaleY !== 1) ? `${v.scaleX} ${v.scaleY}` : undefined,
			unscale:
				v && (v.scaleX !== 1 || v.scaleY !== 1) ? `${1 / v.scaleX} ${1 / v.scaleY}` : undefined,
			rotate: v?.rotation ? `${v.rotation}deg` : undefined,
			values: v
		};
	}

	let popover = $state<'style' | 'animate' | null>(null);
	let guides = $state({ x: false, y: false });

	// ─── Dragging ───────────────────────────────────────────────────────────────────────────
	/** Every drag ends on release, cancel, lost capture or a move with no button (see drag.ts). */
	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	let drag = $state<{
		id: string;
		pointerId: number;
		startX: number;
		startY: number;
		x0: number;
		y0: number;
		moved: boolean;
		kfId: string;
	} | null>(null);

	function onpointerdown(event: PointerEvent, item: TextItem) {
		if (event.button !== 0 || editor.editingTextId === item.id) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).focus();
		if (editor.selectedId !== item.id) {
			editor.select(item.id);
			popover = null;
		}
		drag = {
			id: item.id,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			x0: editor.itemValues(item.id)?.x ?? item.x,
			y0: editor.itemValues(item.id)?.y ?? item.y,
			moved: false,
			kfId: crypto.randomUUID()
		};
		// Applied once per animation frame (the latest move).
		const batch = frameBatch(onpointermove);
		drags.start(event, {
			move: (e) => batch.push(e),
			end: () => {
				batch.flush();
				onend();
			}
		});
	}

	function onpointermove(event: PointerEvent) {
		const d = drag;
		if (!d || event.pointerId !== d.pointerId) return;
		const dx = (event.clientX - d.startX) / width;
		const dy = (event.clientY - d.startY) / height;
		if (!d.moved) {
			if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < 3) return;
			d.moved = true;
			editor.beginGesture();
			popover = null;
		}
		// Anywhere, also outside the frame (to slide in from off-screen).
		let x = d.x0 + dx;
		let y = d.y0 + dy;
		guides = { x: Math.abs(x - 0.5) < SNAP, y: Math.abs(y - 0.5) < SNAP };
		if (guides.x) x = 0.5;
		if (guides.y) y = 0.5;
		// Just outside an edge: its far edge on the frame's edge (a clean off-screen start).
		const item = editor.project.texts.find((t) => t.id === d.id);
		if (item && !event.altKey) {
			const b = box(item);
			const v = b.values;
			const half = turnedHalf(
				b.width * (v?.scaleX ?? 1),
				b.height * (v?.scaleY ?? 1),
				v?.rotation ?? 0
			);
			const sx = guides.x ? null : snapOutside(x * width, half.hw, width, SNAP_OUTSIDE_PX);
			const sy = guides.y ? null : snapOutside(y * height, half.hh, height, SNAP_OUTSIDE_PX);
			if (sx !== null) x = sx / width;
			if (sy !== null) y = sy / height;
		}
		// At the playhead: with keyframes, only the keyframe there moves.
		editor.liveItemValues(d.id, { x, y }, d.kfId);
	}

	function onend() {
		const d = drag;
		if (!d) return;
		drag = null;
		guides = { x: false, y: false };
		if (d.moved) editor.endGesture('Move words');
	}

	/** While the words are being turned (the toolbar keeps its place until it ends). */
	let turning = $state(false);

	/** Turn words with the handle above them; Shift snaps to 15° steps. */
	function onrotatedown(event: PointerEvent, item: TextItem) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const box = (event.currentTarget as HTMLElement).closest('.text-box')!.getBoundingClientRect();
		const cx = box.left + box.width / 2;
		const cy = box.top + box.height / 2;
		const angle = (e: PointerEvent) => (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
		const a0 = angle(event);
		const r0 = editor.itemValues(item.id)?.rotation ?? 0;
		const kfId = crypto.randomUUID();
		let moved = false;
		turning = true;
		drags.start(event, {
			move: (e) => {
				if (!moved) {
					moved = true;
					popover = null;
					editor.beginGesture();
				}
				let r = Math.round((r0 + angle(e) - a0) * 10) / 10;
				if (e.shiftKey) r = Math.round(r / 15) * 15;
				editor.liveItemValues(item.id, { rotation: r }, kfId);
			},
			end: () => {
				turning = false;
				if (moved) editor.endGesture('Rotate words');
			}
		});
	}

	// ─── Width (side handles) and scale (corners) ───────────────────────────────────────────
	type TextHandle = 'nw' | 'ne' | 'se' | 'sw' | 'w' | 'e';
	/** Corners scale; the sides change the width (no top and bottom: the height fits the lines). */
	const TEXT_HANDLES: TextHandle[] = ['nw', 'ne', 'se', 'sw', 'w', 'e'];

	/** While a handle is dragged: what the label says, and where it is (under the words). */
	let sizing = $state<{ label: string; x: number; y: number } | null>(null);

	/**
	 * Drag a side to set the width (Fixed width: the words re-wrap as it changes; the other side
	 * stays, or with Alt the centre does; never narrower than the widest word), or a corner to
	 * scale (keeping proportions, around the centre; a keyframe when animated). Applied once per
	 * frame; one undo step at the end.
	 */
	function onhandledown(event: PointerEvent, item: TextItem, handle: TextHandle) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const b = box(item);
		const v = b.values ?? { x: item.x, y: item.y, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
		const el = (event.currentTarget as HTMLElement).closest('.text-box')!.getBoundingClientRect();
		const center = { x: el.left + el.width / 2, y: el.top + el.height / 2 };
		const start = { x: event.clientX, y: event.clientY };
		const side = handle === 'w' || handle === 'e';
		const sign = handle === 'e' ? 1 : -1;
		const r = (v.rotation * Math.PI) / 180;
		const kfId = crypto.randomUUID();
		const fmt = editor.project.format;
		let moved = false;
		const label = (text: string) => {
			const nb = box(editor.project.texts.find((t) => t.id === item.id) ?? item);
			sizing = {
				label: text,
				x: nb.left + nb.width / 2,
				y: nb.top + (nb.height * (nb.values?.scaleY ?? 1)) / 2 + nb.height / 2 + 10
			};
		};
		const apply = (e: PointerEvent) => {
			if (!moved) {
				if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 2) return;
				moved = true;
				popover = null;
				editor.beginGesture();
			}
			if (side) {
				// The pointer's move along the words' own (turned, scaled) width.
				const dx = e.clientX - start.x;
				const dy = e.clientY - start.y;
				const along = (dx * Math.cos(r) + dy * Math.sin(r)) / (v.scaleX || 1);
				const grow = sign * along * (e.altKey ? 2 : 1);
				const w = Math.max(b.layout.minWidth, b.width + grow);
				const changed = w - b.width;
				editor.live((p) => {
					const t = p.texts.find((x) => x.id === item.id);
					if (t) t.width = Math.max(0, w - b.layout.padX * 2) / width;
				});
				if (!e.altKey) {
					// The other side stays: the centre moves by half the change, along the width.
					const shift = (sign * changed * (v.scaleX || 1)) / 2;
					editor.liveItemValues(
						item.id,
						{ x: v.x + (shift * Math.cos(r)) / width, y: v.y + (shift * Math.sin(r)) / height },
						kfId
					);
				}
				label(`${Math.round((w / width) * fmt.width)} px`);
			} else {
				const d0 = Math.hypot(start.x - center.x, start.y - center.y) || 1;
				const k = Math.max(
					0.05 / Math.max(v.scaleX, v.scaleY),
					Math.hypot(e.clientX - center.x, e.clientY - center.y) / d0
				);
				editor.liveItemValues(item.id, { scaleX: v.scaleX * k, scaleY: v.scaleY * k }, kfId);
				label(`${Math.round(v.scaleX * k * 100)}%`);
			}
		};
		const batch = frameBatch(apply);
		drags.start(event, {
			move: (e) => batch.push(e),
			end: () => {
				batch.flush();
				sizing = null;
				if (moved) editor.endGesture(side ? 'Text width' : 'Scale words');
			}
		});
	}

	function onkeydown(event: KeyboardEvent, item: TextItem) {
		if (event.key === 'Enter') {
			event.preventDefault();
			startEditing(item.id);
			return;
		}
		const arrows: Record<string, [number, number]> = {
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
			ArrowUp: [0, -1],
			ArrowDown: [0, 1]
		};
		const dir = arrows[event.key];
		if (!dir) return;
		event.preventDefault();
		const step = event.shiftKey ? 0.05 : 0.01;
		const v = editor.itemValues(item.id) ?? item;
		editor.setTextPosition(item.id, v.x + dir[0] * step, v.y + dir[1] * step);
	}

	// ─── Typing in place (see TextTyping) ───────────────────────────────────────────────────
	function startEditing(id: string) {
		popover = null;
		if (editor.selectedId !== id) editor.select(id);
		editor.startEditingText(id);
	}

	/** Stop typing (Esc, or a click elsewhere), keeping what was typed. */
	function finish(id: string, text: string) {
		if (editor.editingTextId !== id) return;
		editor.stopEditingText();
		editor.finishTextWords(id, text);
	}

	const selected = $derived(editor.selectedText);

	function actions(item: TextItem) {
		return [
			{ id: 'edit', label: 'Edit words', icon: Pencil, onclick: () => startEditing(item.id) },
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
			{ id: 'remove', label: 'Remove', icon: Trash2, onclick: () => editor.deleteText(item.id) }
		];
	}

	// Close the Style/Animate popover on Escape or a click anywhere else.
	function onWindowPointerDown(event: PointerEvent) {
		if (popover && !(event.target as HTMLElement).closest('[data-toolbar]')) popover = null;
	}
	function onWindowKeydown(event: KeyboardEvent) {
		if (popover && event.key === 'Escape') {
			event.stopPropagation();
			popover = null;
		}
	}

	const animationOptions = TEXT_ANIMATIONS.map((a) => ({ value: a.id, label: a.label }));
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydowncapture={onWindowKeydown} />

<!-- Words may sit outside the frame: their boxes are cut off at the stage's edges. -->
<div class="overlay" class:dragging={!!drag} style:clip-path={stage.clipPath}>
	{#if guides.x}<span class="guide vertical" aria-hidden="true"></span>{/if}
	{#if guides.y}<span class="guide horizontal" aria-hidden="true"></span>{/if}

	{#each visible as item (item.id)}
		{@const b = box(item)}
		{@const isSelected = editor.selectedId === item.id}
		{@const isEditing = editor.editingTextId === item.id}
		<div
			class="text-box"
			class:selected={isSelected}
			data-on-video
			style:left="{b.left}px"
			style:top="{b.top}px"
			style:width="{b.width}px"
			style:height="{b.height}px"
			style:scale={b.scale}
			style:rotate={b.rotate}
		>
			{#if isEditing}
				<TextTyping
					item={b.item}
					layout={b.layout}
					rotation={b.values?.rotation ?? 0}
					scaleX={b.values?.scaleX ?? 1}
					scaleY={b.values?.scaleY ?? 1}
					onfinish={(text) => finish(item.id, text)}
				/>
			{:else}
				<button
					type="button"
					class="hit"
					aria-label="Words: {item.text}"
					aria-pressed={isSelected}
					onpointerdown={(e) => onpointerdown(e, item)}
					ondblclick={(e) => {
						e.stopPropagation();
						startEditing(item.id);
					}}
					onkeydown={(e) => onkeydown(e, item)}
				></button>
				{#if isSelected && !drag}
					<!-- Handles keep their size on screen whatever the words' scale. -->
					<span
						class="rotate"
						data-text-handle="rotate"
						role="presentation"
						title="Drag to turn (Shift: 15° steps)"
						style:scale={b.unscale}
						onpointerdown={(e) => onrotatedown(e, item)}
					></span>
					{#each TEXT_HANDLES as handle (handle)}
						<span
							class="handle {handle}"
							data-text-handle={handle}
							role="presentation"
							title={handle === 'w' || handle === 'e'
								? 'Drag to change the width (Alt: from the centre)'
								: 'Drag to scale'}
							style:scale={b.unscale}
							onpointerdown={(e) => onhandledown(e, item, handle)}
						></span>
					{/each}
				{/if}
			{/if}

			{#if editor.fonts.status(resolveTextStyle(item).font) === 'failed' && !isEditing}
				<button
					type="button"
					class="font-missing"
					title="This font couldn’t be loaded, so Geist is used. Pick another in the settings."
					onclick={() => editor.select(item.id)}
				>
					Font missing
				</button>
			{/if}
		</div>
	{/each}
	{#if sizing}
		<span
			class="size-label mono"
			data-testid="text-size-label"
			style:left="{sizing.x}px"
			style:top="{sizing.y}px">{sizing.label}</span
		>
	{/if}
</div>

{#each visible as item (item.id)}
	{@const isSelected = editor.selectedId === item.id}
	{@const isEditing = editor.editingTextId === item.id}
	{#if isSelected && !isEditing && selected}
		{@const b = box(item)}
		{@const sx = b.values?.scaleX ?? 1}
		{@const sy = b.values?.scaleY ?? 1}
		<!-- At a fixed spot in the video frame (see SelectionToolbar): it stays put while the words
			are moved, turned or animated. -->
		<SelectionToolbar
			bounds={turnedBounds(
				b.left + b.width / 2,
				b.top + b.height / 2,
				b.width * sx,
				b.height * sy,
				b.values?.rotation ?? 0
			)}
			{width}
			{height}
			frozen={!!drag || turning || !!sizing}
		>
			{#snippet bar({ compact })}
				<FloatingToolbar label="Text options" actions={actions(selected)} {compact} />
				<KeyframeButtons id={selected.id} dark />
			{/snippet}
			{#snippet panel({ up })}
				{#if popover === 'style'}
					<div class="popover" class:up role="dialog" aria-label="Text style">
						<TextStylePicker
							compact
							value={selected.style}
							onchange={(style) => editor.setTextStyle(selected.id, style)}
						/>
					</div>
				{:else if popover === 'animate'}
					<div class="popover narrow" class:up role="dialog" aria-label="Animation">
						<p class="popover-label">How the words appear</p>
						<ChipGroup
							label="Animation"
							size="sm"
							options={animationOptions}
							value={selected.animation}
							onchange={(a: TextAnimation) => editor.setTextAnimation(selected.id, a)}
						/>
					</div>
				{/if}
			{/snippet}
		</SelectionToolbar>
	{/if}
{/each}

<style>
	.overlay {
		position: absolute;
		z-index: 5;
		inset: 0;
		pointer-events: none;
	}
	.text-box {
		position: absolute;
		pointer-events: auto;
		border-radius: 6px;
	}
	/* The same handles as layers: corners scale, the sides change the width. */
	.handle {
		position: absolute;
		z-index: 3;
		width: 22px;
		height: 22px;
		margin: -11px 0 0 -11px;
		touch-action: none;
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
	.handle.w::after,
	.handle.e::after {
		width: 6px;
		height: 16px;
		border-radius: 3px;
	}
	.handle.nw {
		left: 0;
		top: 0;
		cursor: nwse-resize;
	}
	.handle.ne {
		left: 100%;
		top: 0;
		cursor: nesw-resize;
	}
	.handle.se {
		left: 100%;
		top: 100%;
		cursor: nwse-resize;
	}
	.handle.sw {
		left: 0;
		top: 100%;
		cursor: nesw-resize;
	}
	.handle.w {
		left: 0;
		top: 50%;
		cursor: ew-resize;
	}
	.handle.e {
		left: 100%;
		top: 50%;
		cursor: ew-resize;
	}
	.size-label {
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
	.rotate {
		position: absolute;
		left: 50%;
		top: -32px;
		width: 22px;
		height: 22px;
		translate: -50% 0;
		touch-action: none;
		cursor: grab;
		z-index: 2;
	}
	.rotate::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 15px;
		width: 1.5px;
		height: 17px;
		translate: -50% 0;
		background: var(--color-accent);
	}
	.rotate::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 4px;
		width: 11px;
		height: 11px;
		translate: -50% 0;
		border-radius: 50%;
		background: var(--color-bg);
		box-shadow: 0 0 0 1.5px var(--color-accent);
	}
	.hit {
		position: absolute;
		inset: -4px;
		padding: 0;
		border: none;
		border-radius: 8px;
		background: transparent;
		cursor: move;
		touch-action: none;
	}
	.hit:hover {
		outline: 1.5px dashed color-mix(in srgb, var(--color-bg) 80%, transparent);
		outline-offset: 0;
	}
	.selected .hit,
	.selected .hit:hover {
		outline: 2px solid var(--color-accent);
		outline-offset: 0;
	}
	.hit:focus-visible {
		box-shadow: var(--focus-ring);
	}
	.popover {
		position: absolute;
		top: calc(100% + 8px);
		width: 320px;
		padding: var(--space-4);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		box-shadow: var(--shadow-float);
		animation: pop-in var(--dur-fast) var(--ease-out);
	}
	/* Opened from a toolbar low in the frame: upwards. */
	.popover.up {
		top: auto;
		bottom: calc(100% + 8px);
	}
	.popover.narrow {
		width: auto;
		white-space: nowrap;
	}
	.popover-label {
		margin-bottom: var(--space-2);
		font-size: var(--text-sm);
		color: var(--color-muted);
	}
	/* Below the words, so it never collides with the floating toolbar above them. */
	.font-missing {
		position: absolute;
		left: 0;
		top: calc(100% + 6px);
		z-index: 4;
		padding: 2px 8px;
		border: none;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.guide {
		position: absolute;
		background: var(--color-accent);
		opacity: 0.8;
	}
	.guide.vertical {
		left: 50%;
		top: 0;
		bottom: 0;
		width: 1px;
	}
	.guide.horizontal {
		top: 50%;
		left: 0;
		right: 0;
		height: 1px;
	}
	@keyframes pop-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
