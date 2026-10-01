<!--
	@component
	Settings for a card scene: length, background, an optional rectangle, duplicate and remove.
-->
<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button, Field, PillStepper } from '$lib/ui';
	import { defaultCard, type CardContent } from '$lib/model/card';
	import { MAX_PHOTO, MIN_SCENE } from '$lib/model/edits';
	import { formatClock, formatSeconds } from '$lib/model/time';
	import type { PlacedScene } from '$lib/model/timeline';
	import { useEditor } from '$lib/state/context';
	import CardContentFields from './CardContentFields.svelte';

	let { placed }: { placed: PlacedScene } = $props();

	const editor = useEditor();

	const scene = $derived(placed.scene);
	const card = $derived<CardContent>(scene.card ?? defaultCard());
	const format = $derived(editor.project.format);
</script>

<div class="head">
	<h2 class="serif title">Scene {placed.index + 1}</h2>
	<p class="subtitle">Card · starts at <span class="mono">{formatClock(placed.start)}</span></p>
</div>

<div class="fields">
	<Field label="Length">
		<PillStepper
			label="Length"
			decreaseLabel="Shorter"
			increaseLabel="Longer"
			value={Math.round(placed.duration * 10) / 10}
			min={MIN_SCENE}
			max={MAX_PHOTO}
			step={0.5}
			format={formatSeconds}
			onchange={(v) => editor.setSceneLength(scene.id, v)}
		/>
	</Field>

	<CardContentFields
		{card}
		frame={format}
		id={scene.id}
		onchange={(next, key) => editor.setCard(scene.id, next, key)}
	/>
</div>

<div class="actions">
	<Button variant="soft" size="sm" icon={Copy} onclick={() => editor.duplicateScene(scene.id)}
		>Duplicate</Button
	>
	<Button variant="ghost" size="sm" icon={Trash2} onclick={() => editor.deleteScene(scene.id)}
		>Remove</Button
	>
</div>

<style>
	.title {
		font-size: var(--text-heading);
		line-height: 1;
	}
	.subtitle {
		margin-top: var(--space-2);
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.head,
	.fields,
	.actions {
		animation: fade-in var(--dur) var(--ease-out);
	}
	.fields {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-5);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
