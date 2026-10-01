<!--
	@component
	A dark pill toolbar that floats next to whatever is selected (for example text on the preview).
	Arrow keys move between its buttons. Position it with `style` or a wrapping element. `compact`
	shows icons only (with the names as tooltips), for narrow spaces.
-->
<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { ToolbarAction } from './types';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		label: string;
		actions: ToolbarAction[];
		/** Icons only, named by their tooltips. */
		compact?: boolean;
	}

	let { label, actions, compact = false, class: className = '', ...rest }: Props = $props();

	let focusIndex = $state(0);
	let root: HTMLDivElement;

	function onkeydown(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const n = actions.length;
		if (event.key === 'Home') focusIndex = 0;
		else if (event.key === 'End') focusIndex = n - 1;
		else focusIndex = (focusIndex + (event.key === 'ArrowLeft' ? -1 : 1) + n) % n;
		root.querySelectorAll<HTMLButtonElement>('button')[focusIndex]?.focus();
	}
</script>

<div
	bind:this={root}
	class="toolbar {className}"
	class:compact
	role="toolbar"
	aria-label={label}
	tabindex="-1"
	{onkeydown}
	{...rest}
>
	{#each actions as action, i (action.id)}
		<button
			type="button"
			tabindex={i === focusIndex ? 0 : -1}
			onfocus={() => (focusIndex = i)}
			onclick={action.onclick}
			aria-label={compact ? action.label : undefined}
			title={compact ? action.label : undefined}
		>
			<action.icon size={15} strokeWidth={1.8} aria-hidden="true" />
			{#if !compact}<span>{action.label}</span>{/if}
		</button>
		{#if i < actions.length - 1}<span class="sep" aria-hidden="true"></span>{/if}
	{/each}
</div>

<style>
	.toolbar {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		box-shadow: var(--shadow-float);
		animation: toolbar-in var(--dur-fast) var(--ease-out);
		white-space: nowrap;
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 var(--space-3);
		border: none;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-on-ink);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.compact button {
		padding: 0 var(--space-2);
	}
	button:hover {
		background: var(--color-ink-line);
	}
	button:focus-visible {
		box-shadow: inset 0 0 0 2px var(--color-bg);
	}
	.sep {
		width: 1px;
		height: 16px;
		background: var(--color-ink-line);
	}

	@keyframes toolbar-in {
		from {
			opacity: 0;
			transform: translateY(4px) scale(0.97);
		}
	}
</style>
