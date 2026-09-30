<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Paintbrush from '@lucide/svelte/icons/paintbrush';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { ChipGroup, FloatingToolbar, IconButton } from '$lib/ui';
	import { ASPECTS, aspectRatioValue } from '$lib/model/catalog';
	import { formatClock } from '$lib/model/time';
	import type { AspectRatio, TextItem } from '$lib/model/types';

	interface Props {
		aspect: AspectRatio;
		time: number;
		duration: number;
		playing?: boolean;
		/** Background of the placeholder frame (Phase 1 only). */
		frameBackground?: string;
		texts?: TextItem[];
		selectedTextId?: string | null;
		onaspectchange?: (aspect: AspectRatio) => void;
		ontoggleplay?: () => void;
	}

	let {
		aspect = $bindable(),
		time,
		duration,
		playing = false,
		frameBackground = 'var(--color-ink)',
		texts = [],
		selectedTextId = null,
		onaspectchange,
		ontoggleplay
	}: Props = $props();

	const ratio = $derived(aspectRatioValue(aspect));
	const aspectOptions = ASPECTS.map((a) => ({ value: a.id, label: a.label }));
	const visibleTexts = $derived(
		texts.filter((t) => time >= t.start && time < t.start + t.duration)
	);

	const toolbarActions = [
		{ id: 'edit', label: 'Edit words', icon: Pencil },
		{ id: 'style', label: 'Style', icon: Paintbrush },
		{ id: 'animate', label: 'Animate', icon: Sparkles },
		{ id: 'remove', label: 'Remove', icon: Trash2 }
	];
</script>

<section class="stage" aria-label="Preview">
	<div class="viewport">
		<div class="preview" style:--ar={ratio}>
			<div class="frame" style:background={frameBackground}></div>
			{#each visibleTexts as text (text.id)}
				{@const selected = text.id === selectedTextId}
				<div
					class="text-item style-{text.style}"
					class:selected
					style:left="{text.x * 100}%"
					style:top="{text.y * 100}%"
				>
					<span class="words">{text.text}</span>
					{#if selected}
						<div class="toolbar-anchor">
							<FloatingToolbar label="Text options" actions={toolbarActions} />
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<div class="controls">
		<div class="left"></div>
		<div class="transport">
			<IconButton
				label={playing ? 'Pause' : 'Play'}
				shortcut="Space"
				icon={playing ? Pause : Play}
				variant="ink"
				size="lg"
				onclick={ontoggleplay}
			/>
			<p class="clock mono" aria-live="off">
				<span class="now">{formatClock(time)}</span>
				<span class="of">of</span>
				<span class="total">{formatClock(duration)}</span>
			</p>
		</div>
		<div class="right">
			<ChipGroup
				label="Video shape"
				variant="segmented"
				size="sm"
				options={aspectOptions}
				bind:value={aspect}
				onchange={onaspectchange}
			/>
		</div>
	</div>
</section>

<style>
	.stage {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		min-height: 0;
		padding: var(--space-6) var(--space-4) var(--space-4);
	}
	.viewport {
		flex: 1;
		min-height: 0;
		display: grid;
		place-items: center;
		container-type: size;
	}
	.preview {
		position: relative;
		width: min(100cqw, 100cqh * var(--ar));
		aspect-ratio: var(--ar);
		border-radius: var(--radius-preview);
		box-shadow: var(--shadow-preview);
		container-type: inline-size;
		transition: width var(--dur) var(--ease-out);
	}
	.frame {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		overflow: hidden;
	}

	.text-item {
		position: absolute;
		translate: -50% -50%;
		max-width: 86%;
		padding: 0.2em 0.35em;
		border-radius: 6px;
		text-align: center;
		white-space: pre-wrap;
		color: var(--color-bg);
		font-size: 4.2cqw;
		line-height: 1.15;
		cursor: move;
	}
	.text-item.selected {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.toolbar-anchor {
		position: absolute;
		bottom: calc(100% + 14px);
		left: 50%;
		translate: -50% 0;
		font-size: var(--text-md);
		z-index: 5;
	}

	/* Placeholder text styles; the WebGL compositor draws the real ones from Phase 4 on. */
	.style-title .words {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 2.3em;
		line-height: 1;
	}
	.style-boxed .words {
		padding: 0.15em 0.45em;
		border-radius: 0.2em;
		background: var(--color-ink);
		font-weight: var(--weight-semibold);
	}
	.style-serif .words {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.3em;
	}

	.controls {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: var(--space-4);
	}
	.transport {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.clock {
		display: flex;
		gap: 0.5ch;
		min-width: 13ch;
		font-size: var(--text-md);
	}
	.of,
	.total {
		color: var(--color-muted);
	}
	.right {
		display: flex;
		justify-content: flex-end;
	}
</style>
