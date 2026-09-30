<!--
	@component
	A labelled row inside a panel: a small label above a control.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		/** Optional value or hint shown on the right of the label. */
		hint?: string;
		children: Snippet;
	}

	let { label, hint, children }: Props = $props();
</script>

<div class="field">
	<div class="label-row">
		<span class="label">{label}</span>
		{#if hint}<span class="hint" class:mono={/\d/.test(hint)}>{hint}</span>{/if}
	</div>
	{@render children()}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.field > :global(*) {
		max-width: 100%;
	}
	.label-row {
		align-self: stretch;
	}
	.label-row {
		display: flex;
		width: 100%;
		align-items: baseline;
		justify-content: space-between;
	}
	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-ink);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
</style>
