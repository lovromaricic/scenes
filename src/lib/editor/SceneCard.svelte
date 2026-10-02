<script lang="ts">
	import { formatShort } from '$lib/model/time';
	import type { Scene } from '$lib/model/types';
	import Filmstrip from './Filmstrip.svelte';
	import NameEditor from './NameEditor.svelte';

	interface Props {
		index: number;
		name: string;
		duration: number;
		/** Pixel width, proportional to duration. */
		width: number;
		/** CSS background shown while the filmstrip loads (an image URL or gradient). */
		thumbnail: string;
		/** When given, the card shows a filmstrip of this scene. */
		scene?: Scene;
		/** Width ÷ height of the video, for filmstrip tiles. */
		tileAspect?: number;
		/** The source file's picture size (for the crop). */
		sourceSize?: { width: number; height: number };
		selected?: boolean;
		onselect?: () => void;
		onkeydown?: (event: KeyboardEvent) => void;
		/** While dragging: the filmstrip stretches instead of being made again. */
		frozen?: boolean;
		/** Being renamed: the name is a field (the number stays). */
		renaming?: boolean;
		/** Double-click on the name: start renaming. */
		onrenamestart?: () => void;
		/** Renaming done: the new name, or null when cancelled. */
		onrename?: (name: string | null) => void;
	}

	let {
		index,
		name,
		duration,
		width,
		thumbnail,
		scene,
		tileAspect = 16 / 9,
		sourceSize,
		selected = false,
		onselect,
		onkeydown,
		frozen = false,
		renaming = false,
		onrenamestart,
		onrename
	}: Props = $props();
</script>

<button
	type="button"
	class="card"
	class:selected
	class:narrow={width < 88}
	class:tiny={width < 64}
	title="{index + 1} · {name} · {formatShort(duration)}"
	style:width="{width}px"
	aria-pressed={selected}
	aria-label="Scene {index + 1}, {name}, {formatShort(duration)}"
	aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
	onclick={onselect}
	{onkeydown}
>
	<span class="thumb" style:background-image={thumbnail}>
		{#if scene}
			<Filmstrip
				mediaId={scene.mediaId}
				sourceStart={scene.sourceStart}
				sourceEnd={scene.sourceEnd}
				{tileAspect}
				{frozen}
				frame={scene.frame}
				crop={scene.crop}
				card={scene.card}
				{sourceSize}
			/>
		{/if}
	</span>
	<span class="meta">
		<span
			class="name"
			class:hidden={renaming}
			role="presentation"
			ondblclick={(e) => {
				e.stopPropagation();
				onrenamestart?.();
			}}><span class="num">{index + 1}</span> · {name}</span
		>
		<span class="dur mono">{formatShort(duration)}</span>
	</span>
</button>
{#if renaming}
	<!-- Over the name, outside the card's button (a field can't be inside one). -->
	<span class="renaming" style:width="{width - 10}px">
		<span class="num" aria-hidden="true">{index + 1} ·</span>
		<NameEditor
			value={name}
			label="Scene {index + 1} name"
			onsave={(v) => onrename?.(v)}
			oncancel={() => onrename?.(null)}
		/>
	</span>
{/if}

<style>
	.renaming {
		position: absolute;
		left: 5px;
		bottom: 3px;
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 4px;
		padding-left: 4px;
		font-size: var(--text-sm);
	}
	.renaming :global(.name-editor) {
		flex: 1;
		height: 22px;
	}
	.name.hidden {
		visibility: hidden;
	}
	.card {
		position: relative;
		cursor: grab;
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
			box-shadow var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
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
		/* The import thumbnail shows until the filmstrip's frames arrive. */
		position: relative;
		overflow: hidden;
		background-size: cover;
		background-position: center;
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
	/* Very short scenes show only their number; the name is in the tooltip. */
	.tiny .name {
		font-size: 0;
	}
	.tiny .num {
		font-size: var(--text-xs);
	}
</style>
