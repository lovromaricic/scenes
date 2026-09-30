<!--
	@component
	A small question with two or three answers, e.g. "Delete this video?". The last action is the
	main one; `danger` makes it look like something that can't be undone.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Button from './Button.svelte';

	interface Action {
		label: string;
		onclick: () => void;
	}

	interface Props {
		title: string;
		message: string;
		/** Actions from least to most important; the last one is focused and drawn strongest. */
		actions: Action[];
		cancelLabel?: string;
		danger?: boolean;
		oncancel: () => void;
	}

	let { title, message, actions, cancelLabel = 'Cancel', danger = false, oncancel }: Props = $props();

	let dialog: HTMLDialogElement;
	onMount(() => dialog.showModal());

	function pick(action: () => void) {
		dialog.close();
		action();
	}
</script>

<dialog
	bind:this={dialog}
	class="confirm"
	class:danger
	aria-labelledby="confirm-title"
	aria-describedby="confirm-message"
	oncancel={(e) => {
		e.preventDefault();
		pick(oncancel);
	}}
	onkeydown={(e) => e.stopPropagation()}
	onclick={(e) => e.target === dialog && pick(oncancel)}
>
	<h2 id="confirm-title" class="serif">{title}</h2>
	<p id="confirm-message">{message}</p>
	<div class="actions">
		<Button variant="ghost" onclick={() => pick(oncancel)}>{cancelLabel}</Button>
		{#each actions as action, i (action.label)}
			<Button
				variant={i === actions.length - 1 ? 'ink' : 'outline'}
				autofocus={i === actions.length - 1}
				onclick={() => pick(action.onclick)}>{action.label}</Button
			>
		{/each}
	</div>
</dialog>

<style>
	.confirm {
		width: min(440px, calc(100vw - 32px));
		padding: var(--space-6);
		border: none;
		border-radius: var(--radius-card-lg);
		background: var(--color-bg);
		color: var(--color-ink);
		box-shadow: var(--shadow-float);
	}
	.confirm[open] {
		animation: dialog-in var(--dur) var(--ease-out);
	}
	.confirm::backdrop {
		background: var(--color-scrim);
	}
	h2 {
		font-size: var(--text-heading);
		line-height: 1.1;
		margin-bottom: var(--space-2);
	}
	p {
		color: var(--color-muted);
		font-size: var(--text-md);
		line-height: 1.5;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-6);
	}
	@keyframes dialog-in {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
</style>
