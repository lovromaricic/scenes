<!--
	@component
	Settings for the selected overlay (a video, photo or card on the Layers track).
-->
<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/ui';
	import { formatClock, formatShort } from '$lib/model/time';
	import type { PlacedOverlay } from '$lib/model/overlay';
	import { useEditor } from '$lib/state/context';

	let { placed }: { placed: PlacedOverlay } = $props();

	const editor = useEditor();
	const o = $derived(placed.overlay);
	const kindLabel = $derived({ video: 'Video', photo: 'Photo', card: 'Card' }[o.kind]);
</script>

<div class="head">
	<h2 class="serif title">Layer</h2>
	<p class="subtitle">
		{kindLabel} · {o.name} · from <span class="mono">{formatClock(placed.start)}</span> for
		<span class="mono">{formatShort(o.duration)}</span>
	</p>
</div>

<div class="actions">
	<Button variant="ghost" size="sm" icon={Trash2} onclick={() => editor.deleteOverlay(o.id)}
		>Remove</Button
	>
</div>

<style>
	.head {
		margin-bottom: var(--space-5);
	}
	.title {
		font-size: var(--text-heading);
		line-height: 1.1;
	}
	.subtitle {
		margin-top: 4px;
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
</style>
