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
			left: l.cx - l.width / 2,
			top: l.cy - l.height / 2,
			width: l.width,
			height: l.height,
			layout: l,
			scale: v && (v.scaleX !== 1 || v.scaleY !== 1) ? `${v.scaleX} ${v.scaleY}` : undefined,
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
					<span
						class="rotate"
						data-text-handle="rotate"
						role="presentation"
						title="Drag to turn (Shift: 15° steps)"
						onpointerdown={(e) => onrotatedown(e, item)}
					></span>
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
			frozen={!!drag || turning}
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
