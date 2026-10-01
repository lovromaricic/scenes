<!--
	@component
	The keyframe diamond with previous / next arrows, for the selected item (as in CapCut). The
	diamond adds a keyframe at the playhead with the item's values there; when the playhead is on a
	keyframe it's filled, and clicking it removes that keyframe. The arrows move the playhead to the
	item's previous or next keyframe.
-->
<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { useEditor } from '$lib/state/context';

	interface Props {
		id: string;
		/** On the dark floating toolbar over the preview. */
		dark?: boolean;
	}

	let { id, dark = false }: Props = $props();

	const editor = useEditor();
	const track = $derived(editor.keyframeTrack(id));
	const on = $derived(!!editor.keyframeAtPlayhead(id));
	const times = $derived(
		track
			? track.list.map((k) => track.toTimeline(k.time)).filter((t) => t >= track.start - 1e-6 && t <= track.end + 1e-6)
			: []
	);
	const hasPrev = $derived(times.some((t) => t < editor.time - 1 / 240));
	const hasNext = $derived(times.some((t) => t > editor.time + 1 / 240));
</script>

{#if track}
	<div class="keyframe-buttons" class:dark role="group" aria-label="Keyframes">
		<button
			type="button"
			class="arrow"
			aria-label="Previous keyframe"
			title="Previous keyframe"
			disabled={!hasPrev}
			onclick={() => editor.seekKeyframe(id, -1)}
		>
			<ChevronLeft size={14} aria-hidden="true" />
		</button>
		<button
			type="button"
			class="diamond"
			class:on
			aria-pressed={on}
			aria-label={on ? 'Remove keyframe at the playhead' : 'Add keyframe at the playhead'}
			title={on ? 'Remove this keyframe' : 'Add a keyframe here'}
			data-testid="keyframe-diamond"
			onclick={() => editor.toggleKeyframe(id)}
		>
			<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
				<path d="M7 1.5 L12.5 7 L7 12.5 L1.5 7 Z" />
			</svg>
		</button>
		<button
			type="button"
			class="arrow"
			aria-label="Next keyframe"
			title="Next keyframe"
			disabled={!hasNext}
			onclick={() => editor.seekKeyframe(id, 1)}
		>
			<ChevronRight size={14} aria-hidden="true" />
		</button>
	</div>
{/if}

<style>
	.keyframe-buttons {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	button {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-ink);
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--color-surface);
	}
	button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.diamond path {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linejoin: round;
	}
	.diamond.on path {
		fill: currentColor;
	}
	.dark {
		padding: 4px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		box-shadow: var(--shadow-float);
	}
	.dark button {
		color: var(--color-on-ink);
	}
	.dark button:hover:not(:disabled) {
		background: var(--color-ink-hover);
	}
</style>
