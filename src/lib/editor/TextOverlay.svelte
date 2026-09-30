<!--
	@component
	Interactive layer over the preview for words: click to select, drag to move (snapping to the
	centre), double-click or "Edit words" to type in place. The words themselves are drawn by the
	WebGL compositor underneath; only the text being typed is shown in HTML.
-->
<script lang="ts">
	import { DragScope } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Paintbrush from '@lucide/svelte/icons/paintbrush';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { tick } from 'svelte';
	import { FloatingToolbar, ChipGroup } from '$lib/ui';
	import { TEXT_ANIMATIONS } from '$lib/model/catalog';
	import { isTextVisible } from '$lib/model/textAnimation';
	import type { TextAnimation, TextItem } from '$lib/model/types';
	import { layoutText } from '$lib/render/text';
	import { resolveTextStyle } from '$lib/model/textStyle';
	import { textCss } from '$lib/render/textCss';
	import { useEditor } from '$lib/state/context';
	import TextStylePicker from './TextStylePicker.svelte';

	interface Props {
		width: number;
		height: number;
	}

	let { width, height }: Props = $props();

	const editor = useEditor();

	const SNAP = 0.015;

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
		const l = layoutText(item, width, height);
		return {
			left: l.cx - l.width / 2,
			top: l.cy - l.height / 2,
			width: l.width,
			height: l.height,
			layout: l
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
			x0: item.x,
			y0: item.y,
			moved: false
		};
		drags.start(event, { move: onpointermove, end: onend });
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
		let x = clamp(d.x0 + dx, 0.04, 0.96);
		let y = clamp(d.y0 + dy, 0.04, 0.96);
		guides = { x: Math.abs(x - 0.5) < SNAP, y: Math.abs(y - 0.5) < SNAP };
		if (guides.x) x = 0.5;
		if (guides.y) y = 0.5;
		editor.live((p) => {
			const t = p.texts.find((t) => t.id === d.id);
			if (t) {
				t.x = x;
				t.y = y;
			}
		});
	}

	function onend() {
		const d = drag;
		if (!d) return;
		drag = null;
		guides = { x: false, y: false };
		if (d.moved) editor.endGesture('Move words');
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
		editor.setTextPosition(
			item.id,
			clamp(item.x + dir[0] * step, 0.04, 0.96),
			clamp(item.y + dir[1] * step, 0.04, 0.96)
		);
	}

	// ─── Typing in place ────────────────────────────────────────────────────────────────────
	let editorEl = $state<HTMLDivElement>();

	function startEditing(id: string) {
		popover = null;
		if (editor.selectedId !== id) editor.select(id);
		editor.startEditingText(id);
	}

	/** Focus the typing box and select its words whenever a text starts being edited. */
	let focusedFor: string | null = null;
	$effect(() => {
		const id = editor.editingTextId;
		const el = editorEl;
		if (!id) {
			focusedFor = null;
			return;
		}
		if (!el || focusedFor === id) return;
		focusedFor = id;
		void tick().then(() => {
			el.focus();
			const range = document.createRange();
			range.selectNodeContents(el);
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(range);
		});
	});

	function commit(save: boolean) {
		const id = editor.editingTextId;
		if (!id || !editorEl) return;
		const text = editorEl.innerText;
		editor.stopEditingText();
		if (save) editor.setTextWords(id, text);
	}

	function onEditorKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			commit(true);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			commit(false);
		}
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
		if (popover && !(event.target as HTMLElement).closest('.toolbar-anchor')) popover = null;
	}
	function onWindowKeydown(event: KeyboardEvent) {
		if (popover && event.key === 'Escape') {
			event.stopPropagation();
			popover = null;
		}
	}

	const animationOptions = TEXT_ANIMATIONS.map((a) => ({ value: a.id, label: a.label }));

	function clamp(v: number, lo: number, hi: number) {
		return Math.min(hi, Math.max(lo, v));
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydowncapture={onWindowKeydown} />

<div class="overlay" class:dragging={!!drag}>
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
		>
			{#if isEditing}
				<div
					bind:this={editorEl}
					class="typing"
					contenteditable="plaintext-only"
					role="textbox"
					aria-multiline="true"
					aria-label="Type the words on the video"
					tabindex="0"
					spellcheck="true"
					style={textCss(item, b.layout.fontSize)}
					onkeydown={onEditorKeydown}
					onblur={() => commit(true)}
				>
					{item.text}
				</div>
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
			{#if isSelected && !isEditing && !drag && selected}
				<div class="toolbar-anchor" class:below={b.top < 64}>
					<FloatingToolbar label="Text options" actions={actions(selected)} />
					{#if popover === 'style'}
						<div class="popover" role="dialog" aria-label="Text style">
							<TextStylePicker
								compact
								value={selected.style}
								onchange={(style) => editor.setTextStyle(selected.id, style)}
							/>
						</div>
					{:else if popover === 'animate'}
						<div class="popover narrow" role="dialog" aria-label="Animation">
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
				</div>
			{/if}
		</div>
	{/each}
</div>

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
	.typing {
		position: absolute;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		min-width: 1ch;
		max-width: none;
		width: max-content;
		text-align: center;
		white-space: pre-wrap;
		outline: 2px solid var(--color-accent);
		outline-offset: 4px;
		cursor: text;
		caret-color: currentColor;
	}
	.typing:focus-visible {
		box-shadow: none;
	}
	.toolbar-anchor {
		position: absolute;
		bottom: calc(100% + 12px);
		left: 50%;
		translate: -50% 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-md);
	}
	.toolbar-anchor.below {
		bottom: auto;
		top: calc(100% + 12px);
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
