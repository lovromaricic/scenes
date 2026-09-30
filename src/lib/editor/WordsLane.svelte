<!--
	@component
	The Words lane: one pill per text item, placed by its timing. Drag a pill to move it in time,
	drag its ends to change when it starts or stops. Overlapping items stack into rows.
-->
<script lang="ts">
	import { formatShort } from '$lib/model/time';
	import type { TextItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';

	interface Props {
		pps: number;
		rows: number[];
		rowHeight: number;
	}

	let { pps, rows, rowHeight }: Props = $props();

	const editor = useEditor();

	type Mode = 'move' | 'start' | 'end';
	let gesture = $state<{
		id: string;
		mode: Mode;
		pointerId: number;
		startX: number;
		original: TextItem;
		active: boolean;
	} | null>(null);

	function onpointerdown(event: PointerEvent, item: TextItem, mode: Mode) {
		if (event.button !== 0) return;
		event.stopPropagation();
		gesture = {
			id: item.id,
			mode,
			pointerId: event.pointerId,
			startX: event.clientX,
			original: $state.snapshot(item) as TextItem,
			active: false
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onpointermove(event: PointerEvent) {
		const g = gesture;
		if (!g || event.pointerId !== g.pointerId) return;
		const dx = event.clientX - g.startX;
		if (!g.active) {
			if (Math.abs(dx) < 3) return;
			g.active = true;
			editor.beginGesture();
		}
		const delta = dx / pps;
		const o = g.original;
		const next =
			g.mode === 'move'
				? {
						start: Math.min(
							Math.max(0, o.start + delta),
							Math.max(0, editor.duration - o.duration)
						),
						duration: o.duration
					}
				: editor.resizeTextTiming(o, g.mode, delta);
		editor.live((p) => {
			const t = p.texts.find((t) => t.id === g.id);
			if (t) {
				t.start = next.start;
				t.duration = next.duration;
			}
		});
		// Show the words while moving them.
		editor.seek(
			g.mode === 'end'
				? next.start + next.duration - 0.05
				: next.start + Math.min(0.5, next.duration / 2)
		);
	}

	function onpointerup(event: PointerEvent) {
		const g = gesture;
		if (!g || event.pointerId !== g.pointerId) return;
		gesture = null;
		if (g.active) editor.endGesture(g.mode === 'move' ? 'Move words' : 'Timing');
		else editor.select(g.id);
	}

	function onkeydown(event: KeyboardEvent, item: TextItem) {
		if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		const step = event.shiftKey ? 1 : 0.1;
		const start = item.start + (event.key === 'ArrowLeft' ? -step : step);
		editor.setTextTiming(item.id, start, item.duration);
	}
</script>

{#each editor.project.texts as item, i (item.id)}
	{@const selected = editor.selectedId === item.id}
	{@const active = gesture?.active && gesture.id === item.id}
	<div
		class="pill-slot"
		class:active
		style:left="{item.start * pps}px"
		style:width="{Math.max(24, item.duration * pps - 3)}px"
		style:top="{3 + (rows[i] ?? 0) * rowHeight}px"
		style:height="{rowHeight - 4}px"
	>
		<button
			type="button"
			class="pill"
			class:selected
			title="{item.text} — drag to move, drag the ends to change timing"
			aria-label="Words: {item.text}, from {formatShort(item.start)} for {formatShort(
				item.duration
			)}"
			aria-pressed={selected}
			aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
			onpointerdown={(e) => onpointerdown(e, item, 'move')}
			{onpointermove}
			{onpointerup}
			onpointercancel={onpointerup}
			onclick={(e) => {
				// Keyboard activation only; pointer clicks are handled on pointerup.
				if (e.detail === 0) editor.select(item.id);
			}}
			onkeydown={(e) => onkeydown(e, item)}
		>
			<span class="label">{item.text}</span>
		</button>
		{#each ['start', 'end'] as const as edge (edge)}
			<span
				class="edge {edge}"
				aria-hidden="true"
				onpointerdown={(e) => onpointerdown(e, item, edge)}
				{onpointermove}
				{onpointerup}
				onpointercancel={onpointerup}
			></span>
		{/each}
		{#if active}
			<span class="badge mono">{formatShort(item.start)} · {formatShort(item.duration)}</span>
		{/if}
	</div>
{/each}

<style>
	.pill-slot {
		position: absolute;
		touch-action: none;
	}
	.pill {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		overflow: hidden;
		cursor: grab;
		touch-action: none;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.pill:hover {
		border-color: var(--color-muted);
	}
	.pill.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}
	.active .pill {
		cursor: grabbing;
		box-shadow: var(--shadow-float);
	}
	.label {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
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
	.pill-slot:hover .edge::after,
	.active .edge::after {
		content: '';
		position: absolute;
		top: 25%;
		bottom: 25%;
		left: 3px;
		width: 2px;
		border-radius: 1px;
		background: var(--color-muted);
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
</style>
