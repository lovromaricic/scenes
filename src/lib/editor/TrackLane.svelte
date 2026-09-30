<!--
	@component
	One overlay or audio track's items on the storyboard: pictures and cards, words, or sound clips.
	- Drag an item to move it in time, and up or down onto another track of the same kind, into the
	  gap between tracks (a new track there), or (pictures) onto the Scenes track (it becomes a
	  scene). Snaps to the playhead, scene boundaries, other items' edges and the video's start and
	  end (Alt drags freely).
	- Drag its ends to trim it; sound clips also have fade handles at their top corners.
	- Shift-click adds to the selection; dragging a selected item moves the whole selection in time.
	Items on a locked track can't be selected or changed.
-->
<script lang="ts">
	import Music from '@lucide/svelte/icons/music';
	import Mic from '@lucide/svelte/icons/mic';
	import TypeIcon from '@lucide/svelte/icons/type';
	import { onDestroy } from 'svelte';
	import { MAX_FADE, effectiveFades, snapTimes, soundEnd } from '$lib/model/sound';
	import { formatClock, formatShort } from '$lib/model/time';
	import type { Overlay } from '$lib/model/overlay';
	import type { Track } from '$lib/model/tracks';
	import type { SoundItem, TextItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import { DragScope } from '$lib/ui/drag';
	import Waveform from './Waveform.svelte';
	import type { TimeMap } from './scale';
	import type { DropTarget, LaneServices } from './lanes';

	interface Props {
		track: Track;
		map: TimeMap;
		height: number;
		services: LaneServices;
	}

	let { track, map, height, services }: Props = $props();

	const editor = useEditor();
	const drags = new DragScope();
	onDestroy(() => drags.dispose());

	/** Snap within this many pixels. */
	const SNAP_PX = 8;

	type Entry =
		| { kind: 'overlay'; item: Overlay }
		| { kind: 'text'; item: TextItem }
		| { kind: 'sound'; item: SoundItem };

	const entries = $derived<Entry[]>(
		track.kind === 'audio'
			? editor.project.sounds.filter((s) => s.trackId === track.id).map((item) => ({ kind: 'sound', item }))
			: [
					...editor.project.overlays
						.filter((o) => o.trackId === track.id)
						.map((item) => ({ kind: 'overlay' as const, item })),
					...editor.project.texts
						.filter((t) => t.trackId === track.id)
						.map((item) => ({ kind: 'text' as const, item }))
				]
	);

	type Mode = 'move' | 'start' | 'end' | 'fade-in' | 'fade-out';
	let gesture = $state<{
		id: string;
		kind: Entry['kind'];
		mode: Mode;
		startX: number;
		startY: number;
		original: { start: number; duration: number; sourceStart: number; fadeIn: number; fadeOut: number };
		active: boolean;
		/** Where it would go. */
		start: number;
		duration: number;
		sourceStart: number;
		fadeIn: number;
		fadeOut: number;
		dy: number;
		target: DropTarget | null;
		/** Other selected items moving along (time only). */
		group: string[];
	} | null>(null);

	let lane: HTMLDivElement;

	/** Where an item ends on screen: sound clips stop when the video ends. */
	const visibleEnd = (e: Entry, start: number, duration: number) =>
		e.kind === 'sound' ? Math.min(start + duration, Math.max(editor.duration, start + 0.05)) : start + duration;

	function onpointerdown(event: PointerEvent, e: Entry, mode: Mode) {
		if (event.button !== 0 || track.locked) return;
		event.stopPropagation();
		// Shift-click adds or removes it from the selection (no drag).
		if (event.shiftKey && mode === 'move') {
			editor.toggleSelected(e.item.id);
			return;
		}
		const i = e.item as { start: number; duration: number; sourceStart?: number; fadeIn?: number; fadeOut?: number };
		const original = {
			start: i.start,
			duration: i.duration,
			sourceStart: i.sourceStart ?? 0,
			fadeIn: i.fadeIn ?? 0,
			fadeOut: i.fadeOut ?? 0
		};
		const group =
			mode === 'move' && editor.selectedIds.includes(e.item.id)
				? editor.selectedIds.filter((id) => id !== e.item.id)
				: [];
		gesture = {
			id: e.item.id,
			kind: e.kind,
			mode,
			startX: event.clientX,
			startY: event.clientY,
			original,
			active: false,
			...original,
			dy: 0,
			target: null,
			group
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
		const entry = entries.find((x) => x.item.id === g.id);
		if (!entry) return;
		const free = event.altKey;
		const near = (a: number, b: number) => Math.abs(map.x(a) - map.x(b)) < SNAP_PX;
		const targets = () => services.snapTargets([g.id, ...g.group]);
		let snapped: number | null = null;

		if (g.mode === 'move') {
			let start = map.t(map.x(o.start) + dx);
			if (!free) {
				const s = snapTimes([start, start + o.duration], targets(), near);
				start += s.shift;
				snapped = s.target;
			}
			g.start = Math.max(0, start);
			g.dy = g.group.length ? 0 : dy;
			g.target = g.group.length ? null : services.targetAt(event.clientY, g.kind, event.clientX);
			services.showTarget(g.target, track.id);
			if (g.kind !== 'sound') editor.seek(Math.min(g.start + 0.05, Math.max(0, editor.duration - 0.01)));
		} else if (g.mode === 'start' || g.mode === 'end') {
			const end = visibleEnd(entry, o.start, o.duration);
			const from = g.mode === 'start' ? o.start : end;
			let t = map.t(map.x(from) + dx);
			if (!free) {
				const s = snapTimes([t], targets(), near);
				t += s.shift;
				snapped = s.target;
			}
			const next = trimmed(entry, g.mode, t - from);
			g.start = next.start;
			g.duration = next.duration;
			g.sourceStart = next.sourceStart;
			editor.seek(g.mode === 'start' ? g.start : Math.max(g.start, visibleEnd(entry, g.start, g.duration) - 0.05));
		} else {
			const t = map.t(event.clientX - lane.getBoundingClientRect().left);
			const end = visibleEnd(entry, o.start, o.duration);
			const limit = Math.min(MAX_FADE, end - o.start);
			const round = (v: number) => Math.round(Math.min(limit, Math.max(0, v)) * 10) / 10;
			if (g.mode === 'fade-in') g.fadeIn = round(t - o.start);
			else g.fadeOut = round(end - t);
		}
		services.setSnap(snapped === null ? null : map.x(snapped));
	}

	/** An item with one edge trimmed by `delta` seconds (within its kind's limits). */
	function trimmed(e: Entry, edge: 'start' | 'end', delta: number) {
		if (e.kind === 'overlay') return editor.resizeOverlay(e.item, edge, delta);
		if (e.kind === 'sound') {
			const s = editor.trimmedSound(e.item, edge, delta);
			return { start: s.start, duration: s.duration, sourceStart: s.sourceStart };
		}
		const t = editor.resizeTextTiming(e.item, edge, delta);
		return { start: t.start, duration: t.duration, sourceStart: 0 };
	}

	function onend() {
		const g = gesture;
		gesture = null;
		services.setSnap(null);
		services.showTarget(null, track.id);
		if (!g) return;
		if (!g.active) {
			editor.select(g.id);
			return;
		}
		const o = g.original;
		if (g.mode === 'move') {
			const t = g.target;
			if (t?.kind === 'main' && g.kind === 'overlay') editor.overlayToScene(g.id, t.index);
			else if (t?.kind === 'gap') editor.moveItemToNewTrack(g.id, g.start, t.index);
			else editor.moveItems([g.id, ...g.group], g.start - o.start, t?.kind === 'track' ? t.id : undefined);
		} else if (g.mode === 'start' || g.mode === 'end') {
			if (g.kind === 'overlay') editor.setOverlayTiming(g.id, g.start, g.duration, g.sourceStart);
			else if (g.kind === 'text') editor.setTextTiming(g.id, g.start, g.duration);
			else
				editor.setSoundTiming(
					g.id,
					{ start: g.start, duration: g.duration, sourceStart: g.sourceStart },
					undefined,
					'Trim sound'
				);
		} else {
			editor.setSoundFades(g.id, g.fadeIn, g.fadeOut);
		}
		if (!g.group.length) editor.select(g.id);
	}

	function onkeydown(event: KeyboardEvent, e: Entry) {
		if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		const step = event.shiftKey ? 1 : 0.1;
		editor.moveItems([e.item.id], event.key === 'ArrowLeft' ? -step : step);
	}

	function thumbnail(o: Overlay): string | undefined {
		if (o.kind === 'card') return undefined;
		const url = editor.thumbnails[o.mediaId];
		return url ? `url("${url}")` : undefined;
	}

	function label(e: Entry): string {
		if (e.kind === 'overlay') return `Layer: ${e.item.name}`;
		if (e.kind === 'text') return `Words: ${e.item.text}`;
		return `${e.item.kind === 'music' ? 'Music' : 'Voiceover'}: ${e.item.name}`;
	}
</script>

<div
	class="lane-items"
	class:locked={track.locked}
	class:dimmed={track.hidden || track.muted}
	bind:this={lane}
	style:height="{height}px"
>
	{#each entries as e (e.item.id)}
		{@const g = gesture?.active && gesture.id === e.item.id ? gesture : null}
		{@const moving = !!gesture?.active && gesture.mode === 'move' && gesture.group.includes(e.item.id)}
		{@const shift = moving && gesture ? gesture.start - gesture.original.start : 0}
		{@const start = g ? g.start : e.item.start + shift}
		{@const duration = g ? g.duration : e.item.duration}
		{@const end = visibleEnd(e, start, duration)}
		{@const length = Math.max(0, end - start)}
		{@const width = Math.max(1, map.width(start, length) - 3)}
		{@const selected = editor.selectedIds.includes(e.item.id)}
		{@const atEnd = editor.endsWithVideo(e.item)}
		<div
			class="item-slot {e.kind}"
			class:active={!!g}
			class:narrow={width < 64}
			data-item-id={e.item.id}
			style:left="{map.x(start)}px"
			style:width="{width}px"
			style:top="2px"
			style:height="{height - 4}px"
			style:translate={g && g.mode === 'move' && g.dy ? `0 ${g.dy}px` : undefined}
		>
			<button
				type="button"
				class="item {e.kind}"
				class:selected
				title="{label(e)} · {formatClock(length)}"
				aria-label="{label(e)}, from {formatShort(start)} for {formatShort(length)}"
				aria-pressed={selected}
				aria-disabled={track.locked}
				aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
				onpointerdown={(ev) => onpointerdown(ev, e, 'move')}
				onclick={(ev) => {
					// Keyboard activation only; pointer clicks are handled when the press ends.
					if (ev.detail === 0 && !track.locked) editor.select(e.item.id);
				}}
				onkeydown={(ev) => onkeydown(ev, e)}
			>
				{#if e.kind === 'overlay'}
					<span
						class="thumb"
						style:background-image={thumbnail(e.item)}
						style:background-color={e.item.kind === 'card' ? e.item.card?.background : undefined}
					></span>
					<span class="meta">
						<span class="name">{e.item.name}</span>
						<span class="dur mono">{formatShort(length)}</span>
					</span>
				{:else if e.kind === 'text'}
					<span class="words">
						<TypeIcon size={12} strokeWidth={2} aria-hidden="true" />
						<span class="name">{e.item.text}</span>
					</span>
				{:else}
					{@const wave = editor.waveforms[e.item.mediaId]}
					{@const fades = effectiveFades(g ? { fadeIn: g.fadeIn, fadeOut: g.fadeOut } : e.item, length)}
					{@const fadeInPx = Math.min(width, map.x(start + fades.fadeIn) - map.x(start))}
					{@const fadeOutPx = Math.min(width, map.x(end) - map.x(end - fades.fadeOut))}
					{@const h = height - 4}
					{#if wave}
						<Waveform
							peaks={wave.peaks}
							perSecond={wave.perSecond}
							from={g ? g.sourceStart : e.item.sourceStart}
							{length}
						/>
					{/if}
					<svg class="fades" aria-hidden="true" {width} height={h}>
						{#if fadeInPx > 0.5}
							<path class="fade-area" d="M0 0 L{fadeInPx} 0 L0 {h} Z" />
							<line class="fade-line in" x1="0" y1={h} x2={fadeInPx} y2="0" />
						{/if}
						{#if fadeOutPx > 0.5}
							<path class="fade-area" d="M{width} 0 L{width - fadeOutPx} 0 L{width} {h} Z" />
							<line class="fade-line out" x1={width - fadeOutPx} y1="0" x2={width} y2={h} />
						{/if}
					</svg>
					<span class="sound-name">
						{#if e.item.kind === 'music'}<Music size={11} strokeWidth={2} aria-hidden="true" />{:else}<Mic
								size={11}
								strokeWidth={2}
								aria-hidden="true"
							/>{/if}
						{e.item.name}
					</span>
					{#if (selected || g) && !track.locked}
						<span
							class="fade-dot in"
							data-sound-fade="in"
							style:left="{fadeInPx}px"
							title="Drag to set the fade in"
							aria-hidden="true"
							onpointerdown={(ev) => onpointerdown(ev, e, 'fade-in')}
						></span>
						<span
							class="fade-dot out"
							data-sound-fade="out"
							style:left="{width - fadeOutPx}px"
							title="Drag to set the fade out"
							aria-hidden="true"
							onpointerdown={(ev) => onpointerdown(ev, e, 'fade-out')}
						></span>
					{/if}
				{/if}
				{#if atEnd}
					<span class="end-marker mono" title="Stays until the end of the video" aria-label="Lasts to the end"
						>end</span
					>
				{/if}
			</button>
			{#if !track.locked}
				{#each ['start', 'end'] as const as edge (edge)}
					<span
						class="trim {edge}"
						class:visible={selected || g?.mode === edge}
						data-trim={edge}
						data-sound-trim={e.kind === 'sound' ? edge : undefined}
						title={edge === 'start' ? 'Drag to trim the start' : 'Drag to trim the end'}
						aria-hidden="true"
						onpointerdown={(ev) => onpointerdown(ev, e, edge)}
					></span>
				{/each}
			{/if}
			{#if g}
				<span class="badge mono" data-testid="item-drag-label">
					{#if g.mode === 'move'}
						{formatClock(start)}
					{:else if g.mode === 'fade-in'}
						Fade in {g.fadeIn.toFixed(1)} s
					{:else if g.mode === 'fade-out'}
						Fade out {g.fadeOut.toFixed(1)} s
					{:else}
						{formatClock(length)}
					{/if}
				</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.lane-items {
		position: relative;
	}
	.dimmed .item-slot {
		opacity: 0.4;
	}
	.item-slot {
		position: absolute;
		touch-action: none;
		user-select: none;
	}
	.item-slot.active {
		z-index: 20;
	}
	.item {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
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
	.locked .item {
		cursor: default;
	}
	.item:hover {
		border-color: var(--color-muted);
	}
	.item.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}
	.active .item {
		cursor: grabbing;
		box-shadow: var(--shadow-float);
	}
	.overlay .item {
		padding: 3px;
	}
	.thumb {
		flex: 1;
		min-height: 0;
		border-radius: 5px;
		background-color: var(--color-surface);
		background-size: auto 100%;
		background-repeat: repeat-x;
	}
	.meta {
		display: flex;
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
	.words {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 100%;
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
	}
	.narrow .meta,
	.narrow .words .name,
	.narrow .sound-name {
		display: none;
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
	.sound-name {
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
	.end-marker {
		position: absolute;
		right: 12px;
		bottom: 3px;
		padding: 0 4px;
		border-radius: 3px;
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: 9px;
		line-height: 13px;
		pointer-events: none;
	}
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
	.item-slot:hover .trim,
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
	.item.sound {
		overflow: visible;
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
