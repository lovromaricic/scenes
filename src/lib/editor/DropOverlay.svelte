<script lang="ts">
	import ImagePlus from '@lucide/svelte/icons/image-plus';
</script>

<!-- While files are dragged over the page: where they can go (each target highlights itself). -->
<div class="overlay" aria-hidden="true">
	<p class="message">
		<ImagePlus size={16} strokeWidth={1.8} />
		Drop on the picture or an overlay track to place on top · anywhere else adds scenes
	</p>
</div>

<style>
	.overlay {
		position: fixed;
		inset: var(--space-2);
		z-index: 90;
		border: 2px dashed color-mix(in srgb, var(--color-ink) 45%, transparent);
		border-radius: var(--radius-preview);
		pointer-events: none;
		animation: fade-in var(--dur-fast) var(--ease-out);
	}
	.message {
		position: absolute;
		top: var(--space-3);
		left: 50%;
		translate: -50% 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 8px 14px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: var(--text-md);
		white-space: nowrap;
		box-shadow: var(--shadow-float);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
