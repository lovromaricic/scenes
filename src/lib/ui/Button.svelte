<!--
	@component
	Pill-shaped text button. `accent` is reserved for the single main action on screen
	("Save video"); `ink` is the strong default, `outline` and `soft` are secondary.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { Icon } from './types';

	interface Props extends HTMLButtonAttributes {
		variant?: 'accent' | 'ink' | 'outline' | 'soft' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		icon?: Icon;
		/** Place the icon after the label instead of before it. */
		iconEnd?: boolean;
		children: Snippet;
	}

	let {
		variant = 'ink',
		size = 'md',
		icon: IconComponent,
		iconEnd = false,
		type = 'button',
		class: className = '',
		children,
		...rest
	}: Props = $props();

	const iconSize = $derived(size === 'sm' ? 14 : size === 'lg' ? 18 : 16);
</script>

<button {type} class="btn {variant} {size} {className}" {...rest}>
	{#if IconComponent && !iconEnd}<IconComponent
			size={iconSize}
			strokeWidth={1.8}
			aria-hidden="true"
		/>{/if}
	<span>{@render children()}</span>
	{#if IconComponent && iconEnd}<IconComponent
			size={iconSize}
			strokeWidth={1.8}
			aria-hidden="true"
		/>{/if}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.btn:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn:disabled {
		opacity: 0.45;
	}

	.sm {
		height: 30px;
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
	}
	.md {
		height: 38px;
		padding: 0 var(--space-4);
		font-size: var(--text-md);
	}
	.lg {
		height: 46px;
		padding: 0 var(--space-6);
		font-size: var(--text-lg);
	}

	.accent {
		background: var(--color-accent);
		color: var(--color-on-ink);
	}
	.accent:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}
	.accent:focus-visible {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-accent);
	}

	.ink {
		background: var(--color-ink);
		color: var(--color-on-ink);
	}
	.ink:hover:not(:disabled) {
		background: var(--color-ink-hover);
	}

	.outline {
		background: var(--color-bg);
		border-color: var(--color-ink);
		color: var(--color-ink);
	}
	.outline:hover:not(:disabled) {
		background: var(--color-surface);
	}

	.soft {
		background: var(--color-surface);
		color: var(--color-ink);
	}
	.soft:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}

	.ghost {
		background: transparent;
		color: var(--color-ink);
	}
	.ghost:hover:not(:disabled) {
		background: var(--color-surface);
	}
</style>
