<!--
	@component
	A card with a serif heading. Used for the "Add" pickers and inspector sections.
	Fades in when it appears.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import X from '@lucide/svelte/icons/x';
	import IconButton from './IconButton.svelte';

	interface Props extends HTMLAttributes<HTMLElement> {
		title: string;
		/** Small line under the heading. */
		subtitle?: string;
		/** Shows a close button when given. */
		onclose?: () => void;
		/** `floating` adds a shadow for panels that sit above other content. */
		elevation?: 'flat' | 'floating';
		headingLevel?: 2 | 3;
		actions?: Snippet;
		children: Snippet;
	}

	let {
		title,
		subtitle,
		onclose,
		elevation = 'flat',
		headingLevel = 2,
		actions,
		children,
		class: className = '',
		...rest
	}: Props = $props();

	const headingId = $props.id();
</script>

<section class="panel {elevation} {className}" aria-labelledby={headingId} {...rest}>
	<header>
		<div class="titles">
			<svelte:element this={`h${headingLevel}`} id={headingId} class="serif title">
				{title}
			</svelte:element>
			{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
		</div>
		{#if actions}{@render actions()}{/if}
		{#if onclose}
			<IconButton label="Close" icon={X} size="sm" onclick={onclose} />
		{/if}
	</header>
	<div class="body">
		{@render children()}
	</div>
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card-lg);
		background: var(--color-bg);
		animation: panel-in var(--dur) var(--ease-out);
	}
	.floating {
		border-color: transparent;
		box-shadow: var(--shadow-float);
	}
	header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.titles {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-size: var(--text-heading);
		line-height: 1.05;
	}
	.subtitle {
		margin-top: var(--space-1);
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	@keyframes panel-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
</style>
