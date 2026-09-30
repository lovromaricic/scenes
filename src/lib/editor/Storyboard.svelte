<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { trimEdge } from '$lib/model/edits';
	import { formatClock, formatShort } from '$lib/model/time';
	import { sceneDuration } from '$lib/model/timeline';
	import type { Scene } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import SceneCard from './SceneCard.svelte';
	import TransitionButton from './TransitionButton.svelte';
	import TransitionPicker from './TransitionPicker.svelte';
	import SoundLane from './SoundLane.svelte';
	import WordsLane from './WordsLane.svelte';
	import { stackRows } from '$lib/model/edits';
	import { aspectRatioValue } from '$lib/model/catalog';
	import { fitPxPerSec, ticks } from './scale';

	interface Props {
		onaddscene?: () => void;
	}

	let { onaddscene }: Props = $props();

	const editor = useEditor();

	const CARD_GAP = 10;
	const ADD_CARD_W = 104;
	const LOADING_CARD_W = 120;
	const END_PAD = 24;
	/** Matches the right padding of `.tracks`. */
	const TRACK_PAD = 24;
	/** Pointer travel before a press on a card turns into a drag. */
	const DRAG_THRESHOLD = 5;

	let trackWidth = $state(0);
	let tracks: HTMLDivElement;

	const scenes = $derived(editor.project.scenes);
	const duration = $derived(editor.duration);
	const importing = $derived(editor.importing);

	// ─── Gestures ───────────────────────────────────────────────────────────────────────────
	interface Drag {
		id: string;
		from: number;
		to: number;
		pointerId: number;
		startX: number;
		/** Pointer position inside the card when grabbed. */
		grab: number;
		/** Card's left edge in content pixels while dragging. */
		x: number;
		active: boolean;
	}
	interface Trim {
		id: string;
		edge: 'start' | 'end';
		startX: number;
		delta: number;
	}

	let drag = $state<Drag | null>(null);
	/** The transition picker that is open: which scene it follows, and where to show it. */
	let picker = $state<{ sceneId: string; after: number; x: number; y: number } | null>(null);

	function openPicker(event: MouseEvent, item: Item) {
		if (picker?.sceneId === item.scene.id) {
			picker = null;
			return;
		}
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		picker = {
			sceneId: item.scene.id,
			after: item.index + 1,
			x: rect.left + rect.width / 2,
			y: rect.top
		};
	}

	const pickerScene = $derived(picker ? scenes.find((s) => s.id === picker!.sceneId) : null);
	let trim = $state<Trim | null>(null);
	/** The scale is frozen during a gesture so the storyboard doesn't rescale under the pointer. */
	let frozenPps = $state<number | null>(null);

	const fittedPps = $derived(
		fitPxPerSec(trackWidth - TRACK_PAD - ADD_CARD_W - END_PAD - CARD_GAP, duration)
	);
	const pps = $derived(frozenPps ?? fittedPps);

	interface Item {
		scene: Scene;
		index: number;
		left: number;
		width: number;
		duration: number;
	}

	const layout = $derived.by(() => {
		let order = scenes.map((scene, index) => ({ scene, index }));
		if (drag?.active) {
			const d = drag;
			const moving = order.find((o) => o.scene.id === d.id)!;
			order = order.filter((o) => o.scene.id !== d.id);
			order.splice(d.to, 0, moving);
		}
		let x = 0;
		const items: Item[] = [];
		for (const { scene, index } of order) {
			const dur = sceneDuration(scene);
			if (trim && trim.id === scene.id) {
				const trimmed = sceneDuration(trimEdge(scene, trim.edge, trim.delta, editor.bounds(scene)));
				if (trim.edge === 'end') {
					items.push({ scene, index, left: x, width: trimmed * pps, duration: trimmed });
					x += trimmed * pps;
				} else {
					// The left edge follows the pointer; later cards move once the trim is done.
					items.push({
						scene,
						index,
						left: x + (dur - trimmed) * pps,
						width: trimmed * pps,
						duration: trimmed
					});
					x += dur * pps;
				}
			} else {
				items.push({ scene, index, left: x, width: dur * pps, duration: dur });
				x += dur * pps;
			}
		}
		return { items, end: x };
	});

	const WORD_ROW_H = 28;
	const wordRows = $derived(stackRows(editor.project.texts));
	const wordsH = $derived(Math.max(1, Math.max(0, ...wordRows) + 1) * WORD_ROW_H + 4);

	const SOUND_ROW_H = 40;
	/** Music on the first row, voiceovers stacked below it. */
	const soundRows = $derived.by(() => {
		const sounds = editor.project.sounds;
		const rows: Record<string, number> = {};
		const hasMusic = sounds.some((s) => s.kind === 'music');
		for (const s of sounds) if (s.kind === 'music') rows[s.id] = 0;
		const voices = sounds.filter((s) => s.kind === 'voice');
		stackRows(voices).forEach((row, i) => (rows[voices[i].id] = row + (hasMusic ? 1 : 0)));
		return rows;
	});
	const soundH = $derived(
		Math.max(1, Math.max(0, ...Object.values(soundRows)) + 1) * SOUND_ROW_H + 4
	);

	const loadingWidth = $derived(importing * (LOADING_CARD_W + CARD_GAP));
	const contentWidth = $derived(
		Math.max(layout.end, duration * pps) + loadingWidth + CARD_GAP + ADD_CARD_W
	);
	const rulerTicks = $derived(ticks(duration, pps));

	function thumbnailFor(scene: Scene): string {
		const url = editor.thumbnails[scene.mediaId];
		return url ? `url("${url}")` : 'none';
	}

	function contentX(clientX: number): number {
		const rect = tracks.getBoundingClientRect();
		return clientX - rect.left + tracks.scrollLeft;
	}

	// Reorder by dragging a card.
	function onCardPointerDown(event: PointerEvent, item: Item) {
		if (event.button !== 0 || trim) return;
		drag = {
			id: item.scene.id,
			from: item.index,
			to: item.index,
			pointerId: event.pointerId,
			startX: event.clientX,
			grab: contentX(event.clientX) - item.left,
			x: item.left,
			active: false
		};
	}

	function onCardPointerMove(event: PointerEvent) {
		const d = drag;
		if (!d || event.pointerId !== d.pointerId) return;
		if (!d.active) {
			if (Math.abs(event.clientX - d.startX) < DRAG_THRESHOLD) return;
			d.active = true;
			frozenPps = pps;
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		}
		autoScroll(event.clientX);
		const x = contentX(event.clientX);
		d.x = x - d.grab;
		// Insert before the first other card whose middle is right of the pointer.
		let offset = 0;
		let to = 0;
		for (const s of scenes) {
			if (s.id === d.id) continue;
			const w = sceneDuration(s) * pps;
			if (offset + w / 2 < x) to++;
			offset += w;
		}
		d.to = to;
	}

	function onCardPointerUp(event: PointerEvent) {
		const d = drag;
		if (!d || event.pointerId !== d.pointerId) return;
		drag = null;
		frozenPps = null;
		if (d.active) {
			// The click that ends a drag must not also select; later clicks must still work.
			suppressClick = true;
			setTimeout(() => (suppressClick = false));
			editor.moveScene(d.from, d.to);
		}
	}

	let suppressClick = false;
	function onCardClick(id: string) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		editor.select(id);
	}

	function onCardKeydown(event: KeyboardEvent, item: Item) {
		if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		const to = item.index + (event.key === 'ArrowLeft' ? -1 : 1);
		if (to < 0 || to >= scenes.length) return;
		editor.moveScene(item.index, to);
		// Keep focus on the moved card.
		requestAnimationFrame(() =>
			tracks.querySelector<HTMLElement>(`[data-scene-id="${item.scene.id}"] .card`)?.focus()
		);
	}

	function autoScroll(clientX: number) {
		const rect = tracks.getBoundingClientRect();
		const edge = 48;
		if (clientX < rect.left + edge) tracks.scrollLeft -= 12;
		else if (clientX > rect.right - edge) tracks.scrollLeft += 12;
	}

	// Trim by dragging a card edge.
	function onTrimPointerDown(event: PointerEvent, item: Item, edge: 'start' | 'end') {
		if (event.button !== 0) return;
		event.stopPropagation();
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		frozenPps = pps;
		trim = { id: item.scene.id, edge, startX: event.clientX, delta: 0 };
		if (editor.selectedId !== item.scene.id) editor.selectedId = item.scene.id;
		peekTrim(item.scene);
	}

	function onTrimPointerMove(event: PointerEvent, item: Item) {
		if (!trim || trim.id !== item.scene.id) return;
		trim.delta = (event.clientX - trim.startX) / pps;
		peekTrim(item.scene);
	}

	function onTrimPointerUp() {
		const t = trim;
		if (!t) return;
		trim = null;
		frozenPps = null;
		editor.player.endPeek();
		editor.trimScene(t.id, t.edge, t.delta);
	}

	/** Show the frame at the edge being trimmed. */
	function peekTrim(scene: Scene) {
		if (!trim || scene.kind === 'photo') return;
		const trimmed = trimEdge(scene, trim.edge, trim.delta, editor.bounds(scene));
		editor.player.peek(
			scene.id,
			trim.edge === 'start' ? trimmed.sourceStart : trimmed.sourceEnd - 1 / 30
		);
	}

	// Playhead
	function timeFromPointer(event: PointerEvent): number {
		return Math.min(duration, Math.max(0, contentX(event.clientX) / pps));
	}

	function onRulerDown(event: PointerEvent) {
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		editor.seek(timeFromPointer(event));
	}

	function onRulerMove(event: PointerEvent) {
		const target = event.currentTarget as HTMLElement;
		if (!target.hasPointerCapture(event.pointerId)) return;
		editor.seek(timeFromPointer(event));
	}

	function onPlayheadKey(event: KeyboardEvent) {
		const step = event.shiftKey ? 1 : 1 / 30;
		if (event.key === 'ArrowLeft') editor.nudge(-step);
		else if (event.key === 'ArrowRight') editor.nudge(step);
		else if (event.key === 'Home') editor.seek(0);
		else if (event.key === 'End') editor.seek(duration);
		else return;
		event.preventDefault();
	}
</script>

{#if picker && pickerScene}
	<TransitionPicker
		x={picker.x}
		y={picker.y}
		after={picker.after}
		value={pickerScene.transition.kind}
		onchange={(kind) => {
			editor.setTransition(pickerScene.id, kind);
			const placed = editor.placed.find((p) => p.scene.id === pickerScene.id);
			// Show the new transition: jump to just before the cut.
			if (placed && kind !== 'cut') editor.seek(Math.max(0, placed.end - 0.6));
			picker = null;
		}}
		onclose={() => (picker = null)}
	/>
{/if}

<section class="storyboard" aria-label="Storyboard">
	<div class="labels" aria-hidden="true">
		<span class="label ruler-label"></span>
		<span class="label scenes-label">Scenes</span>
		<span class="label words-label" style:height="{wordsH}px">Words</span>
		<span class="label sound-label" style:height="{soundH}px">Sound</span>
	</div>

	<div class="tracks" bind:this={tracks} bind:clientWidth={trackWidth}>
		<div class="content" style:width="{contentWidth}px">
			<!-- Ruler: click or drag to move the playhead -->
			<div
				class="ruler"
				role="presentation"
				onpointerdown={onRulerDown}
				onpointermove={onRulerMove}
			>
				{#each rulerTicks as t (t)}
					<span class="tick mono" style:left="{t * pps}px">{formatClock(t)}</span>
				{/each}
			</div>

			<!-- Scenes -->
			<div class="row scenes-row" class:dragging={drag?.active}>
				{#each layout.items as item (item.scene.id)}
					{@const isDragged = drag?.active && drag.id === item.scene.id}
					{@const isTrimmed = trim?.id === item.scene.id}
					{@const selected = editor.selectedId === item.scene.id}
					<div
						class="card-slot"
						class:lifted={isDragged}
						class:trimming={isTrimmed}
						data-scene-id={item.scene.id}
						style:left="{isDragged ? drag!.x : item.left}px"
						style:width="{item.width}px"
						role="presentation"
						onpointerdown={(e) => onCardPointerDown(e, item)}
						onpointermove={onCardPointerMove}
						onpointerup={onCardPointerUp}
						onpointercancel={onCardPointerUp}
					>
						<SceneCard
							index={item.index}
							name={item.scene.name}
							duration={item.duration}
							width={Math.max(24, item.width - CARD_GAP)}
							thumbnail={thumbnailFor(item.scene)}
							scene={item.scene}
							tileAspect={aspectRatioValue(editor.project.aspect)}
							{selected}
							onselect={() => onCardClick(item.scene.id)}
							onkeydown={(e) => onCardKeydown(e, item)}
						/>
						{#if !drag?.active}
							{#each ['start', 'end'] as const as edge (edge)}
								<span
									class="trim-handle {edge}"
									class:visible={selected || isTrimmed}
									aria-hidden="true"
									title={edge === 'start' ? 'Drag to trim the start' : 'Drag to trim the end'}
									onpointerdown={(e) => onTrimPointerDown(e, item, edge)}
									onpointermove={(e) => onTrimPointerMove(e, item)}
									onpointerup={onTrimPointerUp}
									onpointercancel={onTrimPointerUp}
								></span>
							{/each}
						{/if}
						{#if isTrimmed}
							<span class="trim-badge mono">{formatShort(item.duration)}</span>
						{/if}
					</div>
				{/each}
				{#if !drag?.active && !trim}
					{#each layout.items.slice(0, -1) as item (item.scene.id)}
						<div class="transition-slot" style:left="{item.left + item.width - CARD_GAP / 2}px">
							<TransitionButton
								kind={item.scene.transition.kind}
								after={item.index + 1}
								active={picker?.sceneId === item.scene.id}
								onclick={(e) => openPicker(e, item)}
							/>
						</div>
					{/each}
				{/if}
				{#each { length: importing } as _, i (i)}
					<div
						class="loading-card"
						style:left="{layout.end + i * (LOADING_CARD_W + CARD_GAP)}px"
						style:width="{LOADING_CARD_W}px"
						aria-label="Adding a clip"
						role="img"
					>
						<LoaderCircle size={18} strokeWidth={1.8} aria-hidden="true" />
						<span>Adding…</span>
					</div>
				{/each}
				{#if scenes.length === 0 && importing === 0}
					<p class="empty-hint" style:left="{ADD_CARD_W + CARD_GAP * 2}px">
						Your scenes line up here, in the order they play.
					</p>
				{/if}
				<button
					type="button"
					class="add-scene"
					style:left="{layout.end + loadingWidth}px"
					style:width="{ADD_CARD_W}px"
					onclick={onaddscene}
				>
					<Plus size={16} strokeWidth={2} aria-hidden="true" />
					Scene
				</button>
			</div>

			<!-- Words lane -->
			<div class="row lane words-lane" role="group" aria-label="Words" style:height="{wordsH}px">
				<WordsLane {pps} rows={wordRows} rowHeight={WORD_ROW_H} />
			</div>

			<!-- Sound lane -->
			<div class="row lane sound-lane" role="group" aria-label="Sound" style:height="{soundH}px">
				<SoundLane {pps} rows={soundRows} rowHeight={SOUND_ROW_H} />
			</div>

			<!-- Playhead -->
			<div class="playhead" style:translate="{editor.time * pps}px 0">
				<button
					type="button"
					class="handle"
					aria-label="Playhead at {formatClock(editor.time)}. Use arrow keys to move."
					onpointerdown={onRulerDown}
					onpointermove={onRulerMove}
					onkeydown={onPlayheadKey}
				></button>
			</div>
		</div>
	</div>
</section>

<style>
	.storyboard {
		--ruler-h: 26px;
		--scenes-h: 104px;
		--words-h: 32px;
		--sound-h: 44px;
		--row-gap: 10px;

		display: grid;
		grid-template-columns: var(--lane-label-w) 1fr;
		padding: var(--space-3) 0 var(--space-4);
		border-top: 1px solid var(--color-border);
		background: var(--color-bg);
	}

	@media (max-width: 1279px) {
		.storyboard {
			--scenes-h: 88px;
			--ruler-h: 24px;
			--row-gap: 8px;
			padding-bottom: var(--space-3);
		}
		.labels {
			padding-left: var(--space-4);
		}
	}

	.labels {
		display: flex;
		flex-direction: column;
		gap: var(--row-gap);
		padding-left: var(--space-5);
	}
	.label {
		display: flex;
		align-items: center;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-muted);
	}
	.ruler-label {
		height: var(--ruler-h);
	}
	.scenes-label {
		height: var(--scenes-h);
	}
	.words-label {
		height: var(--words-h);
	}
	.sound-label {
		height: var(--sound-h);
	}

	.tracks {
		position: relative;
		overflow-x: auto;
		overflow-y: hidden;
		padding-right: var(--space-6);
		scrollbar-width: thin;
	}
	.content {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--row-gap);
		min-width: 100%;
	}

	.ruler {
		position: relative;
		height: var(--ruler-h);
		border-bottom: 1px solid var(--color-border);
		cursor: ew-resize;
		touch-action: none;
	}
	.tick {
		position: absolute;
		top: 4px;
		padding-left: 5px;
		border-left: 1px solid var(--color-border);
		font-size: var(--text-xs);
		color: var(--color-muted);
		line-height: 1;
		height: 14px;
		pointer-events: none;
		user-select: none;
	}

	.row {
		position: relative;
	}
	.scenes-row {
		height: var(--scenes-h);
	}
	.card-slot {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		touch-action: none;
		user-select: none;
		transition:
			left var(--dur) var(--ease-out),
			width var(--dur) var(--ease-out);
	}
	.card-slot.trimming {
		transition: none;
	}
	.card-slot.lifted {
		z-index: 6;
		transition: none;
		cursor: grabbing;
	}
	.card-slot.lifted :global(.card) {
		box-shadow: var(--shadow-float);
		transform: translateY(-4px) rotate(-1deg);
	}

	.trim-handle {
		position: absolute;
		top: 10px;
		bottom: 26px;
		width: 10px;
		border-radius: 4px;
		background: var(--color-accent);
		cursor: ew-resize;
		opacity: 0;
		z-index: 3;
		transition: opacity var(--dur-fast) var(--ease-out);
		touch-action: none;
	}
	.trim-handle::after {
		content: '';
		position: absolute;
		inset: 30% 4px;
		border-radius: 1px;
		background: var(--color-bg);
	}
	.trim-handle.start {
		left: -3px;
	}
	.trim-handle.end {
		right: calc(10px - 3px);
	}
	/* Bigger handles for fingers on tablets. */
	@media (pointer: coarse) {
		.trim-handle {
			width: 18px;
		}
		.trim-handle.end {
			right: calc(10px - 7px);
		}
		.trim-handle.start {
			left: -7px;
		}
	}
	.card-slot:hover .trim-handle,
	.trim-handle.visible {
		opacity: 1;
	}
	.card-slot:hover .trim-handle:not(.visible) {
		background: var(--color-ink);
	}
	.trim-badge {
		position: absolute;
		top: -22px;
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

	.transition-slot {
		position: absolute;
		top: 50%;
		translate: -50% -70%;
		/* Above the trim handles, which stay grabbable above and below the button. */
		z-index: 5;
		animation: fade-in var(--dur) var(--ease-out);
	}
	.add-scene {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 1.5px dashed var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		color: var(--color-muted);
		font-weight: var(--weight-medium);
		transition:
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			left var(--dur) var(--ease-out);
	}
	.add-scene:hover {
		border-color: var(--color-ink);
		color: var(--color-ink);
	}

	.loading-card {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border-radius: var(--radius-card);
		background: var(--color-surface);
		color: var(--color-muted);
		font-size: var(--text-sm);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.loading-card :global(svg) {
		animation: spin 0.9s linear infinite;
	}
	.empty-hint {
		position: absolute;
		top: 50%;
		translate: 0 -50%;
		color: var(--color-muted);
		white-space: nowrap;
	}
	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}
	@keyframes pulse {
		50% {
			opacity: 0.6;
		}
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	.lane {
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}
	.words-lane {
		transition: height var(--dur) var(--ease-out);
	}
	.sound-lane {
		transition: height var(--dur) var(--ease-out);
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--color-accent);
		pointer-events: none;
		z-index: 4;
		will-change: translate;
	}
	.handle {
		position: absolute;
		top: 6px;
		left: 50%;
		width: 14px;
		height: 14px;
		translate: -50% 0;
		padding: 0;
		border: 2px solid var(--color-bg);
		border-radius: 50%;
		background: var(--color-accent);
		box-shadow: var(--shadow-card);
		cursor: ew-resize;
		pointer-events: auto;
		touch-action: none;
	}
	.handle:focus-visible {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-accent);
	}
</style>
