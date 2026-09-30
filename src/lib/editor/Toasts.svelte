<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { toasts } from '$lib/state/toasts.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<div class="toast" class:error={toast.tone === 'error'}>
			{#if toast.tone === 'error'}<CircleAlert
					size={16}
					strokeWidth={1.8}
					aria-hidden="true"
				/>{/if}
			<p>{toast.message}</p>
			<button type="button" aria-label="Dismiss" onclick={() => toasts.dismiss(toast.id)}>
				<X size={14} strokeWidth={2} aria-hidden="true" />
			</button>
		</div>
	{/each}
</div>

<style>
	/* Near the top, under the top bar, so messages never cover the storyboard you're working in. */
	.toasts {
		position: fixed;
		left: 50%;
		top: calc(var(--topbar-h) + var(--space-3));
		translate: -50% 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		pointer-events: none;
	}
	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		max-width: min(560px, calc(100vw - 32px));
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		box-shadow: var(--shadow-float);
		font-size: var(--text-md);
		/* Clicks go through to whatever is underneath (e.g. the crop box's top edge); only × is clickable. */
		pointer-events: none;
		animation: toast-in var(--dur) var(--ease-out);
	}
	.toast p {
		flex: 1;
	}
	button {
		pointer-events: auto;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--color-on-ink-muted);
	}
	button:hover {
		background: var(--color-ink-line);
		color: var(--color-on-ink);
	}
	button:focus-visible {
		box-shadow: inset 0 0 0 2px var(--color-bg);
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
	}
</style>
