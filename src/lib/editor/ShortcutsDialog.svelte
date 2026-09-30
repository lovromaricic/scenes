<!--
	@component
	Keyboard shortcuts overview, opened with "?".
-->
<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import { IconButton } from '$lib/ui';

	let { onclose }: { onclose: () => void } = $props();

	let dialog: HTMLDialogElement;
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const mod = isMac ? '⌘' : 'Ctrl';

	const groups: { title: string; items: [string[], string][] }[] = [
		{
			title: 'Watching',
			items: [
				[['Space'], 'Play or pause'],
				[['←', '→'], 'Back or forward one frame'],
				[['Shift', '←'], 'Back one second (Shift + → forward)'],
				[['Home'], 'Go to the start'],
				[['End'], 'Go to the end']
			]
		},
		{
			title: 'Editing',
			items: [
				[['S'], 'Split the scene at the playhead'],
				[['C'], 'Crop the scene (Enter to finish, Esc to cancel)'],
				[['Delete'], 'Remove what’s selected'],
				[['Alt', '←'], 'Move the selected scene earlier (Alt + → later)'],
				[['Esc'], 'Deselect']
			]
		},
		{
			title: 'Words',
			items: [
				[['Enter'], 'Type into the selected words'],
				[['Shift', 'Enter'], 'New line while typing'],
				[['↑', '↓'], 'Nudge the selected words (Shift for bigger steps)']
			]
		},
		{
			title: 'Anytime',
			items: [
				[[mod, 'Z'], 'Undo'],
				[[mod, 'Shift', 'Z'], 'Redo'],
				[['?'], 'Show these shortcuts']
			]
		}
	];

	onMount(() => dialog.showModal());

	function close() {
		dialog.close();
		onclose();
	}
</script>

<dialog
	bind:this={dialog}
	class="dialog"
	aria-labelledby="shortcuts-title"
	oncancel={(e) => {
		e.preventDefault();
		close();
	}}
	onkeydown={(e) => {
		e.stopPropagation();
		if (e.key === '?') close();
	}}
	onclick={(e) => e.target === dialog && close()}
>
	<header>
		<h2 id="shortcuts-title" class="serif">Keyboard shortcuts</h2>
		<IconButton label="Close" icon={X} size="sm" onclick={close} />
	</header>
	<div class="groups">
		{#each groups as group (group.title)}
			<section>
				<h3>{group.title}</h3>
				<dl>
					{#each group.items as [keys, label] (label)}
						<div class="row">
							<dt>
								{#each keys as key, i (i)}<kbd>{key}</kbd>{/each}
							</dt>
							<dd>{label}</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/each}
	</div>
</dialog>

<style>
	.dialog {
		width: min(720px, calc(100vw - 32px));
		padding: var(--space-6);
		border: none;
		border-radius: var(--radius-card-lg);
		background: var(--color-bg);
		color: var(--color-ink);
		box-shadow: var(--shadow-float);
	}
	.dialog[open] {
		animation: dialog-in var(--dur) var(--ease-out);
	}
	.dialog::backdrop {
		background: var(--color-scrim);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--space-5);
	}
	h2 {
		font-size: 34px;
		line-height: 1;
	}
	.groups {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-6) var(--space-8);
	}
	h3 {
		margin-bottom: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		color: var(--color-muted);
	}
	dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	dt {
		display: flex;
		gap: 4px;
		flex: none;
		min-width: 96px;
	}
	dd {
		margin: 0;
		font-size: var(--text-sm);
	}
	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 26px;
		height: 26px;
		padding: 0 7px;
		border: 1px solid var(--color-border);
		border-bottom-width: 2px;
		border-radius: 6px;
		background: var(--color-bg);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	@keyframes dialog-in {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
	@media (max-width: 640px) {
		.groups {
			grid-template-columns: 1fr;
		}
	}
</style>
