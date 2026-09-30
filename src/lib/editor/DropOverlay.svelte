<script lang="ts">
	import ImagePlus from '@lucide/svelte/icons/image-plus';
</script>

<div class="overlay" aria-hidden="true">
	<div class="message">
		<ImagePlus size={32} strokeWidth={1.5} />
		<p class="serif">Drop to add scenes</p>
		<p class="hint">Photos and videos go to the end of your storyboard.</p>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: var(--space-3);
		z-index: 90;
		display: grid;
		place-items: center;
		border: 2px dashed var(--color-ink);
		border-radius: var(--radius-preview);
		background: color-mix(in srgb, var(--color-bg) 88%, transparent);
		backdrop-filter: blur(2px);
		pointer-events: none;
		animation: fade-in var(--dur-fast) var(--ease-out);
	}
	.message {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
	}
	.serif {
		font-size: 44px;
		line-height: 1;
	}
	.hint {
		color: var(--color-muted);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
