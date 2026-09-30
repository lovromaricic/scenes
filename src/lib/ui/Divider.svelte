<script lang="ts">
	let { orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' } = $props();
</script>

<span class="divider {orientation}" role="separator" aria-orientation={orientation}></span>

<style>
	.divider {
		display: block;
		flex: none;
		background: var(--color-border);
	}
	.vertical {
		width: 1px;
		height: 24px;
	}
	.horizontal {
		width: 100%;
		height: 1px;
	}
</style>
