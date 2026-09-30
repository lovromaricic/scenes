<!-- @component A small progress card at the bottom of the screen, for opening and saving files. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, fraction, children }: { label: string; fraction: number; children: Snippet } =
		$props();

	const percent = $derived(Math.round(fraction * 100));
</script>

<div class="progress" role="status" aria-live="polite">
	<p>{@render children()}</p>
	<div
		class="bar"
		role="progressbar"
		aria-label={label}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={percent}
	>
		<span style:width="{percent}%"></span>
	</div>
</div>

<style>
	.progress {
		position: fixed;
		left: 50%;
		bottom: var(--space-6);
		z-index: 70;
		width: min(360px, calc(100vw - 32px));
		padding: var(--space-4);
		border-radius: var(--radius-card);
		background: var(--color-ink);
		color: var(--color-on-ink);
		box-shadow: var(--shadow-float);
		transform: translateX(-50%);
		font-size: var(--text-md);
		pointer-events: none;
	}
	p {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	p :global(strong) {
		font-weight: var(--weight-medium);
	}
	.bar {
		height: 4px;
		margin-top: var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--color-ink-line);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--color-on-ink);
		transition: width var(--dur-fast) linear;
	}
</style>
