<!--
	@component
	The Sound lane: music and voiceover clips in rows, each with its waveform.
	- Drag a clip to move it in time, or up and down to another row (overlapping clips get a new
	  row below; empty rows go away).
	- Drag its ends to trim it (never beyond the file); the waveform is cropped, not squeezed, and
	  the new length shows while dragging.
	- Drag the dots at its top corners to set the fade in and out (0–5 s), drawn as sloped lines.
	- Moves and trims snap to the playhead, scene boundaries and other clips' edges (hold Alt to
	  drag freely); `snapX` tells the storyboard where to draw the snap line.
-->
<script lang="ts">
	import Music from '@lucide/svelte/icons/music';
	import Mic from '@lucide/svelte/icons/mic';
	import { onDestroy } from 'svelte';
	import { MAX_FADE, effectiveFades, snapTimes, soundEnd, soundRowCount } from '$lib/model/sound';
	import { formatClock } from '$lib/model/time';
	import type { SoundItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import { DragScope } from '$lib/ui/drag';
	import Waveform from './Waveform.svelte';
	import type { TimeMap } from './scale';

	interface Props {
		map: TimeMap;
		rowHeight: number;
		/** The lane's height, for the label beside it. */
		height?: number;
		/** Where a drag has snapped to (content pixels), for the storyboard's snap line. */
		snapX?: number | null;
	}

	let { map, rowHeight, height = $bindable(0), snapX = $bindable(null) }: Props = $props();

	const editor = useEditor();

	/** Every drag ends on release, cancel, lost capture or a move with no button (see drag.ts). */
	const drags = new DragScope();
	onDestroy(() => drags.dispose());

	/** Snap within this many pixels. */
	const SNAP_PX = 8;

	type Mode = 'move' | 'start' | 'end' | 'fade-in' | 'fade-out';
	let gesture = $state<{
		id: string;
		mode: Mode;
		startX: number;
		startY: number;
		original: SoundItem;
		active: boolean;
		/** What the clip would become. */
		preview: SoundItem;
	} | null>(null);

	let lane: HTMLDivElement;

	const rows = $derived(soundRowCount(editor.project.sounds));
	/** A move pointing below the last row makes a new row. */
	const newRow = $derived(!!gesture?.active && gesture.mode === 'move' && gesture.preview.row >= rows);
	$effect(() => {
		height = (rows + (newRow ? 1 : 0)) * rowHeight + 4;
	});

	/** Snap targets: the playhead, scene boundaries, and other clips' edges. */
	function targets(except: string): number[] {
		const list = [editor.time];
		for (const p of editor.placed) list.push(p.start, p.end);
		for (const s of editor.project.sounds) {
			if (s.id === except) continue;
			list.push(s.start, soundEnd(s, editor.duration));
		}
		return list;
	}
	const near = (a: number, b: number) => Math.abs(map.x(a) - map.x(b)) < SNAP_PX;

	/** Content x (time 0 = the lane's left edge) of a pointer. */
	const laneX = (clientX: number) => clientX - lane.getBoundingClientRect().left;

	function onpointerdown(event: PointerEvent, sound: SoundItem, mode: Mode) {
		if (event.button !== 0) return;
		event.stopPropagation();
		const original = $state.snapshot(sound) as SoundItem;
		gesture = {
			id: sound.id,
			mode,
			startX: event.clientX,
			startY: event.clientY,
			original,
			active: false,
			preview: original
		};
		drags.start(event, { move: onpointermove, end: onend });
	}

	function onpointermove(event: PointerEvent) {
		const g = gesture;
		if (!g) return;
		const dx = event.clientX - g.startX;
		const dy = event.clientY - g.startY;
		if (!g.active) {
			if (Math.hypot(dx, dy) < 3) return;
			g.active = true;
		}
		const o = g.original;
		const end = soundEnd(o, editor.duration);
		const free = event.altKey;
		let snapped: number | null = null;

		if (g.mode === 'move') {
			let start = map.t(map.x(o.start) + dx);
			const length = end - o.start;
			if (!free) {
				const s = snapTimes([start, start + length], targets(o.id), near);
				start += s.shift;
				snapped = s.target;
			}
			start = Math.min(Math.max(0, start), Math.max(0, editor.duration - 0.3));
			const row = Math.max(0, Math.min(rows, o.row + Math.round(dy / rowHeight)));
			g.preview = { ...o, start, row };
		} else if (g.mode === 'start' || g.mode === 'end') {
			const from = g.mode === 'start' ? o.start : end;
			let t = map.t(map.x(from) + dx);
			if (!free) {
				const s = snapTimes([t], targets(o.id), near);
				t += s.shift;
				snapped = s.target;
			}
			g.preview = editor.trimmedSound(o, g.mode, t - from);
		} else {
			const t = map.t(laneX(event.clientX));
			const length = end - o.start;
			const limit = Math.min(MAX_FADE, length);
			const round = (v: number) => Math.round(Math.min(limit, Math.max(0, v)) * 10) / 10;
			g.preview =
				g.mode === 'fade-in'
					? { ...o, fadeIn: round(t - o.start) }
					: { ...o, fadeOut: round(end - t) };
		}
		snapX = snapped === null ? null : map.x(snapped);
		// Show the moment being edited.
		if (g.mode === 'start') editor.seek(g.preview.start);
		else if (g.mode === 'end')
			editor.seek(Math.max(g.preview.start, soundEnd(g.preview, editor.duration) - 0.05));
	}

	function onend() {
		const g = gesture;
		gesture = null;
		snapX = null;
		if (!g) return;
		if (!g.active) {
			editor.select(g.id);
			return;
		}
		const p = g.preview;
		if (g.mode === 'move') editor.setSoundTiming(g.id, p, p.row, 'Move sound');
		else if (g.mode === 'start' || g.mode === 'end')
			editor.setSoundTiming(g.id, p, undefined, 'Trim sound');
		else editor.setSoundFades(g.id, p.fadeIn, p.fadeOut);
		editor.select(g.id);
	}

	function onkeydown(event: KeyboardEvent, sound: SoundItem) {
		if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		const step = event.shiftKey ? 1 : 0.1;
		const start = sound.start + (event.key === 'ArrowLeft' ? -step : step);
		editor.setSoundTiming(sound.id, { ...sound, start }, undefined, 'Move sound', `nudge:${sound.id}`);
	}

	/** A clip as drawn: itself, or what it's being dragged into. */
	function shown(sound: SoundItem): SoundItem {
		return gesture?.active && gesture.id === sound.id ? gesture.preview : sound;
	}
</script>

<div class="sound-rows" bind:this={lane}>
	{#if newRow}
		<span
			class="new-row"
			style:top="{rows * rowHeight + 3}px"
			style:height="{rowHeight - 4}px"
			aria-hidden="true"
		></span>
	{/if}
	{#each editor.project.sounds as sound (sound.id)}
		{@const s = shown(sound)}
		{@const end = soundEnd(s, editor.duration)}
		{@const length = Math.max(0, end - s.start)}
		{@const width = Math.max(1, map.width(s.start, length) - 3)}
		{@const fades = effectiveFades(s, length)}
		{@const fadeInPx = Math.min(width, map.x(s.start + fades.fadeIn) - map.x(s.start))}
		{@const fadeOutPx = Math.min(width, map.x(end) - map.x(end - fades.fadeOut))}
		{@const h = rowHeight - 4}
		{@const wave = editor.waveforms[s.mediaId]}
		{@const selected = editor.selectedId === sound.id}
		{@const active = gesture?.active && gesture.id === sound.id ? gesture : null}
		<div
			class="clip-slot"
			class:active={!!active}
			class:narrow={width < 64}
			data-sound-id={sound.id}
			style:left="{map.x(s.start)}px"
			style:width="{width}px"
			style:top="{3 + s.row * rowHeight}px"
			style:height="{h}px"
		>
			<button
				type="button"
				class="sound {s.kind}"
				class:selected
				title="{s.name} · {formatClock(length)}"
				aria-label="{s.kind === 'music' ? 'Music' : 'Voiceover'}: {s.name}, {formatClock(length)}"
				aria-pressed={selected}
				aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
				onpointerdown={(e) => onpointerdown(e, sound, 'move')}
				onclick={(e) => {
					// Keyboard activation only; pointer clicks are handled when the press ends.
					if (e.detail === 0) editor.select(sound.id);
				}}
				onkeydown={(e) => onkeydown(e, sound)}
			>
				{#if wave}
					<!-- The trimmed part of the file: trimming hides audio, it never squeezes it. -->
					<Waveform peaks={wave.peaks} perSecond={wave.perSecond} from={s.sourceStart} {length} />
				{/if}
				<svg class="fades" aria-hidden="true" width={width} height={h}>
					{#if fadeInPx > 0.5}
						<path class="fade-area" d="M0 0 L{fadeInPx} 0 L0 {h} Z" />
						<line class="fade-line in" x1="0" y1={h} x2={fadeInPx} y2="0" />
					{/if}
					{#if fadeOutPx > 0.5}
						<path class="fade-area" d="M{width} 0 L{width - fadeOutPx} 0 L{width} {h} Z" />
						<line class="fade-line out" x1={width - fadeOutPx} y1="0" x2={width} y2={h} />
					{/if}
				</svg>
				<span class="name">
					{#if s.kind === 'music'}<Music size={11} strokeWidth={2} aria-hidden="true" />{:else}<Mic
							size={11}
							strokeWidth={2}
							aria-hidden="true"
						/>{/if}
					{s.name}
				</span>
			</button>
			{#each ['start', 'end'] as const as edge (edge)}
				<span
					class="trim {edge}"
					class:visible={selected || active?.mode === edge}
					data-sound-trim={edge}
					title={edge === 'start' ? 'Drag to trim the start' : 'Drag to trim the end'}
					aria-hidden="true"
					onpointerdown={(e) => onpointerdown(e, sound, edge)}
				></span>
			{/each}
			{#if selected || active}
				<span
					class="fade-dot in"
					data-sound-fade="in"
					style:left="{fadeInPx}px"
					title="Drag to set the fade in"
					aria-hidden="true"
					onpointerdown={(e) => onpointerdown(e, sound, 'fade-in')}
				></span>
				<span
					class="fade-dot out"
					data-sound-fade="out"
					style:left="{width - fadeOutPx}px"
					title="Drag to set the fade out"
					aria-hidden="true"
					onpointerdown={(e) => onpointerdown(e, sound, 'fade-out')}
				></span>
			{/if}
			{#if active}
				<span class="badge mono" data-testid="sound-drag-label">
					{#if active.mode === 'move'}
						{formatClock(s.start)}
					{:else if active.mode === 'fade-in'}
						Fade in {s.fadeIn.toFixed(1)} s
					{:else if active.mode === 'fade-out'}
						Fade out {s.fadeOut.toFixed(1)} s
					{:else}
						{formatClock(length)}
					{/if}
				</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.sound-rows {
		position: absolute;
		inset: 0;
	}
	.new-row {
		position: absolute;
		left: 0;
		right: 0;
		border: 1.5px dashed var(--color-muted);
		border-radius: var(--radius-sm);
	}
	.clip-slot {
		position: absolute;
		touch-action: none;
		user-select: none;
	}
	.clip-slot.active {
		z-index: 6;
	}
	.sound {
		position: absolute;
		inset: 0;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		overflow: hidden;
		text-align: left;
		cursor: grab;
		touch-action: none;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.sound:hover {
		border-color: var(--color-muted);
	}
	.sound.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}
	.active .sound {
		cursor: grabbing;
		box-shadow: var(--shadow-float);
	}
	.fades {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.fade-line {
		stroke: var(--color-ink);
		stroke-width: 1.25;
		opacity: 0.6;
	}
	.fade-area {
		fill: var(--color-bg);
		opacity: 0.55;
	}
	.name {
		position: absolute;
		top: 3px;
		left: 6px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: calc(100% - 12px);
		padding: 0 5px;
		border-radius: 4px;
		background: var(--color-bg);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.narrow .name {
		display: none;
	}
	/* Trim handles: the same look as on scene cards. */
	.trim {
		position: absolute;
		top: 4px;
		bottom: 4px;
		width: 8px;
		border-radius: 3px;
		background: var(--color-ink);
		cursor: ew-resize;
		opacity: 0;
		z-index: 2;
		touch-action: none;
		transition: opacity var(--dur-fast) var(--ease-out);
	}
	.trim::after {
		content: '';
		position: absolute;
		inset: 30% 3px;
		border-radius: 1px;
		background: var(--color-bg);
	}
	.trim.start {
		left: -2px;
	}
	.trim.end {
		right: -2px;
	}
	.clip-slot:hover .trim,
	.trim.visible {
		opacity: 1;
	}
	.trim.visible {
		background: var(--color-accent);
	}
	@media (pointer: coarse) {
		.trim {
			width: 16px;
		}
	}
	/* Fade handles at the top corners. */
	.fade-dot {
		position: absolute;
		top: -5px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-bg);
		box-shadow: 0 0 0 1.5px var(--color-ink);
		cursor: ew-resize;
		z-index: 3;
		touch-action: none;
	}
	.fade-dot.out {
		margin-left: -12px;
	}
	.badge {
		position: absolute;
		bottom: calc(100% + 6px);
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
