<!--
	@component
	Pick one colour swatch from a small grid, each with its name underneath (a radio group).
-->
<script lang="ts" generics="T extends string">
	import type { Swatch } from './types';

	interface Props {
		options: Swatch<T>[];
		value: T;
		label: string;
		onchange?: (value: T) => void;
	}

	let { options, value = $bindable(), label, onchange }: Props = $props();

	let group: HTMLDivElement;

	function select(next: T) {
		if (next === value) return;
		value = next;
		onchange?.(next);
	}

	function onkeydown(event: KeyboardEvent) {
		const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		const index = options.findIndex((o) => o.value === value);
		const n = options.length;
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? n - 1
					: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
						? (index - 1 + n) % n
						: (index + 1) % n;
		select(options[next].value);
		group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
	}
</script>

<div
	bind:this={group}
	class="swatches"
	role="radiogroup"
	aria-label={label}
	tabindex="-1"
	{onkeydown}
>
	{#each options as option (option.value)}
		{@const checked = option.value === value}
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			tabindex={checked ? 0 : -1}
			class="swatch"
			class:checked
			title={option.description}
			onclick={() => select(option.value)}
		>
			<span class="chip" style:background={option.background}></span>
			<span class="name">{option.label}</span>
		</button>
	{/each}
</div>

<style>
	.swatches {
		display: grid;
		width: 100%;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-3) var(--space-2);
	}
	.swatch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
	}
	.chip {
		width: 100%;
		aspect-ratio: 2 / 1;
		border-radius: var(--radius-md);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 8%, transparent);
		transition:
			box-shadow var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.swatch:hover .chip {
		transform: translateY(-1px);
	}
	.checked .chip {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-accent);
	}
	.name {
		font-size: var(--text-sm);
		color: var(--color-muted);
	}
	.checked .name {
		color: var(--color-ink);
		font-weight: var(--weight-medium);
	}
	.swatch:focus-visible {
		box-shadow: none;
	}
	.swatch:focus-visible .chip {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-ink);
	}
</style>
