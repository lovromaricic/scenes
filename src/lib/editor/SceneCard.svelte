<script lang="ts">
	import { formatShort } from '$lib/model/time';

	interface Props {
		index: number;
		name: string;
		duration: number;
		/** Pixel width, proportional to duration. */
		width: number;
		/** CSS background for the thumbnail (an image URL or gradient). */
		thumbnail: string;
		selected?: boolean;
		onselect?: () => void;
	}

	let { index, name, duration, width, thumbnail, selected = false, onselect }: Props = $props();
</script>

<button
	type="button"
	class="card"
	class:selected
	class:narrow={width < 88}
	style:width="{width}px"
	aria-pressed={selected}
	aria-label="Scene {index + 1}, {name}, {formatShort(duration)}"
	onclick={onselect}
>
	<span class="thumb" style:background-image={thumbnail}></span>
	<span class="meta">
		<span class="name"><span class="num">{index + 1}</span> · {name}</span>
		<span class="dur mono">{formatShort(duration)}</span>
	</span>
</button>

<style>
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: none;
		gap: 6px;
		height: 100%;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		text-align: left;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out);
	}
	.card:hover {
		border-color: var(--color-muted);
	}
	.card.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}
	.card:focus-visible {
		box-shadow: var(--focus-ring);
	}
	.thumb {
		flex: 1;
		min-height: 0;
		border-radius: calc(var(--radius-card) - 4px);
		background-color: var(--color-surface);
		/* Repeat the thumbnail along long cards, like a filmstrip. */
		background-size: auto 100%;
		background-repeat: repeat-x;
		background-position: left center;
	}
	.meta {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 0 4px 2px;
		font-size: var(--text-sm);
		min-width: 0;
	}
	.name {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-weight: var(--weight-medium);
	}
	.num {
		font-family: var(--font-mono);
	}
	.dur {
		flex: none;
		color: var(--color-muted);
		font-size: var(--text-xs);
	}
	.narrow .dur {
		display: none;
	}
</style>
