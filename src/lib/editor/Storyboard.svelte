<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { formatClock } from '$lib/model/time';
	import { placeScenes, totalDuration } from '$lib/model/timeline';
	import type { Scene, SoundItem, TextItem } from '$lib/model/types';
	import SceneCard from './SceneCard.svelte';
	import TransitionButton from './TransitionButton.svelte';
	import Waveform from './Waveform.svelte';
	import { fitPxPerSec, ticks } from './scale';

	interface Props {
		scenes: Scene[];
		texts: TextItem[];
		sounds: SoundItem[];
		time: number;
		selectedId: string | null;
		/** Thumbnail background per scene id. */
		thumbnails: Record<string, string>;
		/** Waveform peaks per sound id. */
		peaks: Record<string, number[]>;
		/** Files still being added; shown as loading cards at the end. */
		importing?: number;
		onselect?: (id: string) => void;
		onseek?: (time: number) => void;
		onaddscene?: () => void;
	}

	let {
		scenes,
		texts,
		sounds,
		time,
		selectedId,
		thumbnails,
		peaks,
		importing = 0,
		onselect,
		onseek,
		onaddscene
	}: Props = $props();

	const CARD_GAP = 10;
	const LOADING_CARD_W = 120;
	/** Matches the right padding of `.tracks`. */
	const TRACK_PAD = 24;
	const ADD_CARD_W = 104;
	const END_PAD = 24;

	let trackWidth = $state(0);

	const duration = $derived(totalDuration(scenes));
	const placed = $derived(placeScenes(scenes));
	const pps = $derived(
		fitPxPerSec(trackWidth - TRACK_PAD - ADD_CARD_W - END_PAD - CARD_GAP, duration)
	);
	const loadingWidth = $derived(importing * (LOADING_CARD_W + CARD_GAP));
	const contentWidth = $derived(duration * pps + loadingWidth + CARD_GAP + ADD_CARD_W);
	const rulerTicks = $derived(ticks(duration, pps));

	let tracks: HTMLDivElement;

	function timeFromPointer(event: PointerEvent): number {
		const rect = tracks.getBoundingClientRect();
		const x = event.clientX - rect.left + tracks.scrollLeft;
		return Math.min(duration, Math.max(0, x / pps));
	}

	function onRulerDown(event: PointerEvent) {
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		onseek?.(timeFromPointer(event));
	}

	function onRulerMove(event: PointerEvent) {
		const target = event.currentTarget as HTMLElement;
		if (!target.hasPointerCapture(event.pointerId)) return;
		onseek?.(timeFromPointer(event));
	}

	function onPlayheadKey(event: KeyboardEvent) {
		const step = event.shiftKey ? 1 : 0.1;
		if (event.key === 'ArrowLeft') onseek?.(Math.max(0, time - step));
		else if (event.key === 'ArrowRight') onseek?.(Math.min(duration, time + step));
		else if (event.key === 'Home') onseek?.(0);
		else if (event.key === 'End') onseek?.(duration);
		else return;
		event.preventDefault();
	}
</script>

<section class="storyboard" aria-label="Storyboard">
	<div class="labels" aria-hidden="true">
		<span class="label ruler-label"></span>
		<span class="label scenes-label">Scenes</span>
		<span class="label words-label">Words</span>
		<span class="label sound-label">Sound</span>
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
			<div class="row scenes-row">
				{#each placed as p (p.scene.id)}
					<div class="card-slot" style:left="{p.start * pps}px" style:width="{p.duration * pps}px">
						<SceneCard
							index={p.index}
							name={p.scene.name}
							duration={p.duration}
							width={Math.max(24, p.duration * pps - CARD_GAP)}
							thumbnail={thumbnails[p.scene.id] ?? 'none'}
							selected={selectedId === p.scene.id}
							onselect={() => onselect?.(p.scene.id)}
						/>
					</div>
					{#if p.index < placed.length - 1}
						<div class="transition-slot" style:left="{p.end * pps - CARD_GAP / 2}px">
							<TransitionButton kind={p.scene.transition.kind} after={p.index + 1} />
						</div>
					{/if}
				{/each}
				{#each { length: importing } as _, i (i)}
					<div
						class="loading-card"
						style:left="{duration * pps + i * (LOADING_CARD_W + CARD_GAP)}px"
						style:width="{LOADING_CARD_W}px"
						aria-label="Adding a clip"
						role="img"
					>
						<LoaderCircle size={18} strokeWidth={1.8} aria-hidden="true" />
						<span>Adding…</span>
					</div>
				{/each}
				{#if placed.length === 0 && importing === 0}
					<p class="empty-hint" style:left="{ADD_CARD_W + CARD_GAP * 2}px">
						Your scenes line up here, in the order they play.
					</p>
				{/if}
				<button
					type="button"
					class="add-scene"
					style:left="{duration * pps + loadingWidth}px"
					style:width="{ADD_CARD_W}px"
					onclick={onaddscene}
				>
					<Plus size={16} strokeWidth={2} aria-hidden="true" />
					Scene
				</button>
			</div>

			<!-- Words lane -->
			<div class="row lane words-lane" role="group" aria-label="Words">
				{#each texts as text (text.id)}
					<button
						type="button"
						class="caption"
						class:selected={selectedId === text.id}
						style:left="{text.start * pps}px"
						style:width="{Math.max(20, text.duration * pps - 4)}px"
						title={text.text}
						onclick={() => onselect?.(text.id)}
					>
						<span>{text.text}</span>
					</button>
				{/each}
			</div>

			<!-- Sound lane -->
			<div class="row lane sound-lane" role="group" aria-label="Sound">
				{#each sounds as sound (sound.id)}
					<button
						type="button"
						class="sound"
						class:selected={selectedId === sound.id}
						style:left="{sound.start * pps}px"
						style:width="{Math.max(20, sound.duration * pps - 4)}px"
						onclick={() => onselect?.(sound.id)}
					>
						<Waveform peaks={peaks[sound.id] ?? []} />
						<span class="sound-name">{sound.name}</span>
					</button>
				{/each}
			</div>

			<!-- Playhead -->
			<div class="playhead" style:translate="{time * pps}px 0">
				<button
					type="button"
					class="handle"
					aria-label="Playhead at {formatClock(time)}. Use arrow keys to move."
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
		transition:
			left var(--dur) var(--ease-out),
			width var(--dur) var(--ease-out);
	}
	.transition-slot {
		position: absolute;
		top: 50%;
		translate: -50% -70%;
		z-index: 2;
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
			color var(--dur-fast) var(--ease-out);
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

	.lane {
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}
	.words-lane {
		height: var(--words-h);
	}
	.sound-lane {
		height: var(--sound-h);
	}

	.caption {
		position: absolute;
		top: 4px;
		bottom: 4px;
		display: flex;
		align-items: center;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		overflow: hidden;
	}
	.caption span {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.caption:hover {
		border-color: var(--color-muted);
	}

	.sound {
		position: absolute;
		top: 4px;
		bottom: 4px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		overflow: hidden;
		text-align: left;
	}
	.sound:hover {
		border-color: var(--color-muted);
	}
	.sound-name {
		position: absolute;
		top: 3px;
		left: 8px;
		padding: 0 4px;
		border-radius: 4px;
		background: var(--color-bg);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}

	.caption.selected,
	.sound.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
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
