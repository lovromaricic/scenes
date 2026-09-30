<!--
	@component
	Round icon-only button. `label` is required and becomes the accessible name and tooltip.
-->
<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { Icon } from './types';

	interface Props extends Omit<HTMLButtonAttributes, 'children'> {
		label: string;
		icon: Icon;
		variant?: 'ghost' | 'soft' | 'ink' | 'on-ink';
		size?: 'sm' | 'md' | 'lg' | 'xl';
		/** Keyboard shortcut shown in the tooltip, e.g. "⌘Z". */
		shortcut?: string;
	}

	let {
		label,
		icon: IconComponent,
		variant = 'ghost',
		size = 'md',
		shortcut,
		type = 'button',
		class: className = '',
		...rest
	}: Props = $props();

	const iconSize = $derived({ sm: 15, md: 18, lg: 20, xl: 24 }[size]);
</script>

<button
	{type}
	class="icon-btn {variant} {size} {className}"
	aria-label={label}
	title={shortcut ? `${label} (${shortcut})` : label}
	{...rest}
>
	<IconComponent size={iconSize} strokeWidth={1.8} aria-hidden="true" />
</button>

<style>
	.icon-btn {
		display: inline-grid;
		place-items: center;
		flex: none;
		padding: 0;
		border: none;
		border-radius: var(--radius-pill);
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.icon-btn:active:not(:disabled) {
		transform: scale(0.94);
	}
	.icon-btn:disabled {
		opacity: 0.35;
	}

	.sm {
		width: 28px;
		height: 28px;
	}
	.md {
		width: 36px;
		height: 36px;
	}
	.lg {
		width: 44px;
		height: 44px;
	}
	.xl {
		width: 56px;
		height: 56px;
	}

	.ghost {
		background: transparent;
		color: var(--color-ink);
	}
	.ghost:hover:not(:disabled) {
		background: var(--color-surface);
	}
	.soft {
		background: var(--color-surface);
		color: var(--color-ink);
	}
	.soft:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}
	.ink {
		background: var(--color-ink);
		color: var(--color-on-ink);
	}
	.ink:hover:not(:disabled) {
		background: var(--color-ink-hover);
	}
	.on-ink {
		background: transparent;
		color: var(--color-on-ink);
	}
	.on-ink:hover:not(:disabled) {
		background: var(--color-ink-line);
	}
	.on-ink:focus-visible {
		box-shadow:
			0 0 0 2px var(--color-ink),
			0 0 0 4px var(--color-bg);
	}
</style>
