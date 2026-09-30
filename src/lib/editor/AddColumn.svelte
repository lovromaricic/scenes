<script lang="ts">
	import Clapperboard from '@lucide/svelte/icons/clapperboard';
	import Type from '@lucide/svelte/icons/type';
	import Music from '@lucide/svelte/icons/music';
	import RectangleHorizontal from '@lucide/svelte/icons/rectangle-horizontal';
	import { CARD_DRAG_TYPE } from '$lib/media/dragTypes';
	import { useEditor } from '$lib/state/context';
	import AddButton from './AddButton.svelte';
	import AddPanel from './AddPanel.svelte';
	import MediaLibrary from './MediaLibrary.svelte';
	import type { AddKind } from './types';

	let { onpick }: { onpick: () => void } = $props();

	const editor = useEditor();

	let open = $state<AddKind | null>(null);

	function onCardDragStart(event: DragEvent) {
		event.dataTransfer?.setData(CARD_DRAG_TYPE, 'card');
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
		open = null;
	}

	const items = [
		{ id: 'clips', label: 'Clips', hint: 'Photos & videos', icon: Clapperboard },
		{ id: 'cards', label: 'Cards', hint: 'Blank & color screens', icon: RectangleHorizontal },
		{ id: 'words', label: 'Words', hint: 'Titles & captions', icon: Type },
		{ id: 'sound', label: 'Sound', hint: 'Music & voice', icon: Music }
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
	<!-- Short windows (or many tracks below): this part scrolls; the panel beside it doesn't. -->
	<div class="scroll">
		<h2 class="serif heading">Add</h2>
		<div class="buttons">
			{#each items as item (item.id)}
				{#if item.id === 'cards'}
					<!-- Cards is an action, not a panel: click adds one; drag it onto the storyboard. -->
					<AddButton
						icon={item.icon}
						label={item.label}
						hint={item.hint}
						togglesPanel={false}
						onclick={() => {
							open = null;
							editor.addCard();
						}}
						ondragstart={onCardDragStart}
					/>
				{:else}
					<AddButton
						icon={item.icon}
						label={item.label}
						hint={item.hint}
						active={open === item.id}
						onclick={() => toggle(item.id as AddKind)}
					/>
				{/if}
			{/each}
		</div>

		<MediaLibrary />
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
		min-height: 0;
		padding: var(--space-5) var(--space-4) var(--space-4) var(--space-6);
	}
	.scroll {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-4);
		min-height: 0;
		/* Room for focus rings at the edges. */
		margin: -4px;
		padding: 4px;
		overflow-y: auto;
		scrollbar-width: thin;
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
