<!--
	@component
	Six ready-made text styles, each previewed as "Aa" on a dark tile (a radio group).
-->
<script lang="ts">
	import { TEXT_STYLES } from '$lib/model/catalog';
	import type { TextStyleId } from '$lib/model/types';
	import { textCss } from '$lib/render/textCss';

	interface Props {
		value: TextStyleId;
		onchange: (style: TextStyleId) => void;
		compact?: boolean;
	}

	let { value, onchange, compact = false }: Props = $props();

	let group: HTMLDivElement;

	function onkeydown(event: KeyboardEvent) {
		const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		const i = TEXT_STYLES.findIndex((s) => s.id === value);
		const n = TEXT_STYLES.length;
		const step =
			event.key === 'ArrowLeft'
				? -1
				: event.key === 'ArrowRight'
					? 1
					: event.key === 'ArrowUp'
						? -3
						: 3;
		const next = (i + step + n) % n;
		onchange(TEXT_STYLES[next].id);
		group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
	}
</script>

<div
	bind:this={group}
	class="styles"
	class:compact
	role="radiogroup"
	aria-label="Text style"
	tabindex="-1"
	{onkeydown}
>
	{#each TEXT_STYLES as style (style.id)}
		{@const checked = style.id === value}
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			tabindex={checked ? 0 : -1}
			class="tile"
			class:checked
			onclick={() => onchange(style.id)}
		>
			<span class="sample">
				<span style={textCss(style.id, style.id === 'title' ? 26 : style.id === 'serif' ? 20 : 15)}
					>Aa</span
				>
			</span>
			<span class="name">{style.label}</span>
		</button>
	{/each}
</div>

<style>
	.styles {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-3) var(--space-2);
		width: 100%;
	}
	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 0;
		border: none;
		background: none;
		border-radius: var(--radius-sm);
	}
	.sample {
		display: grid;
		place-items: center;
		width: 100%;
		aspect-ratio: 16 / 10;
		border-radius: var(--radius-md);
		/* A neutral "video" backdrop so white styles are visible. */
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--color-ink) 70%, var(--color-muted)),
			var(--color-ink)
		);
		overflow: hidden;
		transition: box-shadow var(--dur-fast) var(--ease-out);
	}
	.compact .sample {
		aspect-ratio: 16 / 9;
	}
	.checked .sample {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-accent);
	}
	.tile:focus-visible {
		box-shadow: none;
	}
	.tile:focus-visible .sample {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-ink);
	}
	.name {
		font-size: var(--text-sm);
		color: var(--color-muted);
		white-space: nowrap;
	}
	.checked .name {
		color: var(--color-ink);
		font-weight: var(--weight-medium);
	}
</style>
