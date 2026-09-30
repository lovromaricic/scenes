<script lang="ts">
	import Clapperboard from '@lucide/svelte/icons/clapperboard';
	import Type from '@lucide/svelte/icons/type';
	import Music from '@lucide/svelte/icons/music';
	import Palette from '@lucide/svelte/icons/palette';
	import AddButton from './AddButton.svelte';
	import AddPanel from './AddPanel.svelte';
	import type { AddKind } from './types';

	let { onpick }: { onpick: () => void } = $props();

	let open = $state<AddKind | null>(null);

	const items = [
		{ id: 'clips', label: 'Clips', hint: 'Photos & videos', icon: Clapperboard },
		{ id: 'words', label: 'Words', hint: 'Titles & captions', icon: Type },
		{ id: 'sound', label: 'Sound', hint: 'Music & voice', icon: Music },
		{ id: 'looks', label: 'Looks', hint: 'Color moods', icon: Palette }
	] as const;

	function toggle(kind: AddKind) {
		open = open === kind ? null : kind;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			open = null;
		}
	}
</script>

<svelte:window {onkeydown} />

<aside class="add-column" aria-label="Add">
	<h2 class="serif heading">Add</h2>
	<div class="buttons">
		{#each items as item (item.id)}
			<AddButton
				icon={item.icon}
				label={item.label}
				hint={item.hint}
				active={open === item.id}
				onclick={() => toggle(item.id)}
			/>
		{/each}
	</div>

	{#if open}
		<div class="popover">
			<AddPanel
				kind={open}
				onclose={() => (open = null)}
				onpick={() => {
					open = null;
					onpick();
				}}
			/>
		</div>
	{/if}
</aside>

<style>
	.add-column {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-6) var(--space-4) var(--space-6) var(--space-6);
	}
	.heading {
		font-size: var(--text-heading);
		line-height: 1;
	}
	.buttons {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	@media (max-width: 1279px) {
		.add-column {
			padding: var(--space-5) var(--space-3) var(--space-5) var(--space-5);
		}
	}
	.popover {
		position: absolute;
		top: var(--space-6);
		left: calc(100% - var(--space-2));
		z-index: 20;
		width: 320px;
	}
</style>
