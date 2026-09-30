<!--
	@component
	A single-choice row of chips (a radio group). Arrow keys move between chips.
	`segmented` draws the chips inside one soft track, used for switches like the aspect ratio.
-->
<script lang="ts" generics="T extends string | number">
	import type { Choice } from './types';

	interface Props {
		options: Choice<T>[];
		value: T;
		label: string;
		variant?: 'chips' | 'segmented';
		size?: 'sm' | 'md';
		onchange?: (value: T) => void;
	}

	let {
		options,
		value = $bindable(),
		label,
		variant = 'chips',
		size = 'md',
		onchange
	}: Props = $props();

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
		let next = index;
		if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = options.length - 1;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
			next = (index - 1 + options.length) % options.length;
		else next = (index + 1) % options.length;
		select(options[next].value);
		group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
	}
</script>

<div
	bind:this={group}
	class="group {variant} {size}"
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
			title={option.description}
			class="chip"
			class:checked
			onclick={() => select(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.group {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-ink);
		font-weight: var(--weight-medium);
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}
	.md .chip {
		height: 34px;
		padding: 0 var(--space-4);
		font-size: var(--text-md);
	}
	.sm .chip {
		height: 28px;
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
	}
	.chip:hover:not(.checked) {
		border-color: var(--color-muted);
	}
	.chip.checked {
		background: var(--color-ink);
		border-color: var(--color-ink);
		color: var(--color-on-ink);
	}

	.segmented {
		gap: 2px;
		padding: 3px;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
	}
	.segmented .chip {
		border-color: transparent;
		background: transparent;
		color: var(--color-muted);
	}
	.segmented .chip:hover:not(.checked) {
		border-color: transparent;
		color: var(--color-ink);
	}
	.segmented .chip.checked {
		background: var(--color-bg);
		border-color: transparent;
		color: var(--color-ink);
		box-shadow: var(--shadow-card);
	}
	.segmented.sm .chip {
		height: 26px;
	}
</style>
