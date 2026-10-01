<!--
	@component
	Typing words in place on the preview, what you see is what you get: the words are drawn by
	the video's own renderer the whole time (same lines, font, shadow, outline, box, turn, and
	faded outside the frame), and an invisible text field only takes the typing, the caret and
	the selection. The caret and the selection are drawn here, from the renderer's own line
	layout (`layoutText` rows), and clicks, drags, double-clicks, Up/Down and Home/End are placed
	with it too, so they land where the letters are.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { TextItem } from '$lib/model/types';
	import { rowOffsets, type TextLayout } from '$lib/render/text';
	import { useEditor } from '$lib/state/context';
	import { DragScope } from '$lib/ui/drag';

	interface Props {
		/** The words being typed (with the text as typed). */
		item: TextItem;
		/** Their layout at the preview's size (the box this sits in). */
		layout: TextLayout;
		/** How they're turned and scaled on screen (the box's CSS does the same). */
		rotation: number;
		scaleX: number;
		scaleY: number;
		/** Typing stopped (Esc or a click elsewhere): what was typed. */
		onfinish: (text: string) => void;
	}

	let { item, layout, rotation, scaleX, scaleY, onfinish }: Props = $props();

	const editor = useEditor();
	let input = $state<HTMLTextAreaElement>();
	let surface = $state<HTMLDivElement>();
	let focused = $state(false);
	/** The selection in the typed text (start ≤ end), and which end moves (the caret). */
	let sel = $state({ start: 0, end: 0, backward: false });

	const rows = $derived(layout.rows);
	const offsets = $derived(rows.map((r) => rowOffsets(item, layout, r)));
	/** Left edge of each row inside the box (rows are centred, hanging spaces left out). */
	const rowLeft = (r: number) => layout.areaWidth / 2 - rows[r].width / 2;
	const rowTop = (r: number) => layout.padY + r * layout.lineHeight;
	/** A row that wraps onto the next (not at a line break). */
	const soft = (r: number) => r < rows.length - 1 && rows[r].end === rows[r + 1].start;

	/** The row a caret at `i` is on (at a wrap, the start of the next row). */
	function rowOf(i: number): number {
		for (let r = rows.length - 1; r >= 0; r--) if (rows[r].start <= i) return r;
		return 0;
	}
	const xAt = (r: number, i: number) =>
		rowLeft(r) + (offsets[r]?.[Math.max(0, Math.min(rows[r].text.length, i - rows[r].start))] ?? 0);

	/** The character position nearest to x on row r. */
	function nearest(r: number, x: number): number {
		const offs = offsets[r] ?? [0];
		let best = 0;
		for (let k = 1; k < offs.length; k++)
			if (Math.abs(rowLeft(r) + offs[k] - x) < Math.abs(rowLeft(r) + offs[best] - x)) best = k;
		// Past the end of a wrapped row: before its hanging space, not on the next row.
		if (soft(r) && best === offs.length - 1 && best > 0) best--;
		return Math.min(rows[r].start + best, valueLength());
	}

	const valueLength = () => input?.value.length ?? item.text.length;

	/** Read the field's selection. */
	function sync() {
		if (!input) return;
		sel = {
			start: input.selectionStart,
			end: input.selectionEnd,
			backward: input.selectionDirection === 'backward'
		};
	}

	function select(anchor: number, focus: number) {
		if (!input) return;
		const n = valueLength();
		anchor = Math.max(0, Math.min(n, anchor));
		focus = Math.max(0, Math.min(n, focus));
		input.setSelectionRange(
			Math.min(anchor, focus),
			Math.max(anchor, focus),
			focus < anchor ? 'backward' : 'forward'
		);
		sync();
	}

	const caretAt = () => (sel.backward ? sel.start : sel.end);
	const anchorAt = () => (sel.backward ? sel.end : sel.start);

	onMount(() => {
		if (!input) return;
		input.value = item.text;
		editor.showTyping(item.id, item.text);
		input.focus();
		input.select();
		sync();
		const onSelection = () => sync();
		document.addEventListener('selectionchange', onSelection);
		return () => document.removeEventListener('selectionchange', onSelection);
	});

	// ─── Typing ─────────────────────────────────────────────────────────────────────────────
	function oninput(event: Event) {
		if (!input) return;
		// Shown as typed (also halfway through a composed character); in the project only whole.
		editor.showTyping(item.id, input.value);
		if (!(event as InputEvent).isComposing) editor.typeTextWords(item.id, input.value);
		sync();
	}

	function oncompositionend() {
		if (!input) return;
		editor.showTyping(item.id, input.value);
		editor.typeTextWords(item.id, input.value);
		sync();
	}

	function onkeydown(event: KeyboardEvent) {
		// Typing keys are for the words, not the editor's shortcuts. Enter is a new line.
		event.stopPropagation();
		if (event.isComposing) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			input?.blur();
			return;
		}
		sync();
		const caret = caretAt();
		const r = rowOf(caret);
		const move = (to: number) => {
			event.preventDefault();
			select(event.shiftKey ? anchorAt() : to, to);
		};
		// Up, Down, Home and End go by the lines as drawn (the field's own lines don't matter).
		const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
		if (event.key === 'ArrowUp' && plain) move(r === 0 ? 0 : nearest(r - 1, xAt(r, caret)));
		else if (event.key === 'ArrowDown')
			move(r === rows.length - 1 ? valueLength() : nearest(r + 1, xAt(r, caret)));
		else if (event.key === 'Home' && plain) move(rows[r].start);
		else if (event.key === 'End' && plain)
			move(
				soft(r)
					? rows[r].start + rows[r].text.trimEnd().length
					: Math.min(rows[r].end, valueLength())
			);
		else queueMicrotask(sync);
	}

	// ─── Pointer: place the caret, select by dragging, words and lines by double/triple click ──
	const drags = new DragScope();
	onDestroy(() => drags.dispose());

	/** The character position under a point on screen. */
	function indexAt(clientX: number, clientY: number): number {
		const box = surface!.parentElement!.getBoundingClientRect();
		const dx = clientX - (box.left + box.width / 2);
		const dy = clientY - (box.top + box.height / 2);
		const t = (-rotation * Math.PI) / 180;
		const x = (dx * Math.cos(t) - dy * Math.sin(t)) / (scaleX || 1) + layout.areaWidth / 2;
		const y = (dx * Math.sin(t) + dy * Math.cos(t)) / (scaleY || 1) + layout.height / 2;
		const r = Math.max(
			0,
			Math.min(rows.length - 1, Math.floor((y - layout.padY) / layout.lineHeight))
		);
		return nearest(r, x);
	}

	const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_'’-]/u.test(c);

	function wordAround(i: number): [number, number] {
		const text = input?.value ?? '';
		let a = i;
		let b = i;
		if (!isWord(text[a]) && isWord(text[a - 1])) a--;
		if (!isWord(text[a])) return [i, Math.min(text.length, i + 1)];
		while (a > 0 && isWord(text[a - 1])) a--;
		b = a;
		while (b < text.length && isWord(text[b])) b++;
		return [a, b];
	}

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0 || !input) return;
		// Not cancelled (that would also cancel the mousedown, which counts double-clicks and
		// keeps the focus in the field: see onmousedown).
		event.stopPropagation();
		input.focus();
		const i = indexAt(event.clientX, event.clientY);
		const anchor = event.shiftKey ? anchorAt() : i;
		select(anchor, i);
		drags.start(event, {
			move: (e) => select(anchor, indexAt(e.clientX, e.clientY)),
			end: () => {}
		});
	}

	/** Double-click selects a word, triple-click a line (clicks are counted on mousedown). */
	function onmousedown(event: MouseEvent) {
		// The field keeps the focus.
		event.preventDefault();
		if (event.button !== 0 || event.detail < 2 || !input) return;
		drags.dispose();
		const i = indexAt(event.clientX, event.clientY);
		if (event.detail === 2) {
			const [a, b] = wordAround(i);
			select(a, b);
		} else {
			const r = rowOf(i);
			select(rows[r].start, Math.min(rows[r].end, valueLength()));
		}
	}

	/** The selection as rectangles, row by row (a selected line break shows as a little extra). */
	const highlights = $derived.by(() => {
		if (sel.start === sel.end) return [];
		const out: { left: number; top: number; width: number }[] = [];
		rows.forEach((row, r) => {
			const a = Math.max(sel.start, row.start);
			const b = Math.min(sel.end, row.end);
			const breakSelected =
				!soft(r) && r < rows.length - 1 && sel.start <= row.end && sel.end > row.end;
			if (a > b || (a === b && !breakSelected)) return;
			const x1 = xAt(r, a);
			const x2 = xAt(r, b) + (breakSelected ? layout.fontSize * 0.25 : 0);
			out.push({ left: x1, top: rowTop(r), width: Math.max(1, x2 - x1) });
		});
		return out;
	});

	const caret = $derived.by(() => {
		const i = sel.backward ? sel.start : sel.end;
		const r = rowOf(i);
		return { left: xAt(r, i), top: rowTop(r) };
	});
</script>

<!-- The words are on the video (drawn by the renderer); this only takes typing and clicks. -->
<div
	bind:this={surface}
	class="surface"
	role="presentation"
	{onpointerdown}
	{onmousedown}
	ondblclick={(e) => e.stopPropagation()}
>
	{#each highlights as h, i (i)}
		<span
			class="highlight"
			style:left="{h.left}px"
			style:top="{h.top}px"
			style:width="{h.width}px"
			style:height="{layout.lineHeight}px"
		></span>
	{/each}
	{#if focused && sel.start === sel.end}
		<span
			class="caret"
			data-testid="text-caret"
			style:left="{caret.left}px"
			style:top="{caret.top}px"
			style:height="{layout.lineHeight}px"
		></span>
	{/if}
	<textarea
		bind:this={input}
		class="input"
		aria-label="Type the words on the video"
		aria-multiline="true"
		spellcheck="false"
		autocomplete="off"
		autocapitalize="off"
		{...{ autocorrect: 'off' }}
		wrap="off"
		{oninput}
		{oncompositionend}
		{onkeydown}
		onkeyup={sync}
		onselect={sync}
		onfocus={() => (focused = true)}
		onblur={() => {
			focused = false;
			onfinish(input?.value ?? item.text);
		}}></textarea>
</div>

<style>
	/* The same outline as selected words that aren't being typed into: no jump. */
	.surface {
		position: absolute;
		inset: -4px;
		padding: 4px;
		border-radius: 8px;
		outline: 2px solid var(--color-accent);
		cursor: text;
		touch-action: none;
		user-select: none;
	}
	.surface > span {
		position: absolute;
		pointer-events: none;
		/* Positions are in the box (inside the 4 px margin). */
		translate: 4px 4px;
	}
	.highlight {
		background: color-mix(in srgb, var(--color-accent) 32%, transparent);
	}
	.caret {
		width: 2px;
		margin-left: -1px;
		background: var(--color-accent);
		animation: blink 1.06s steps(1) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
	/* Takes the typing, invisibly (it's what keyboards and input methods type into). */
	.input {
		position: absolute;
		inset: 4px;
		width: calc(100% - 8px);
		height: calc(100% - 8px);
		margin: 0;
		padding: 0;
		border: none;
		outline: none;
		resize: none;
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
		white-space: pre;
		font-size: 16px;
		background: transparent;
		color: transparent;
		caret-color: transparent;
	}
</style>
