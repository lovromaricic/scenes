<!--
	@component
	The settings' title for a scene or an item ("Scene 1", "Layer"), with its name once it's been
	renamed ("Scene 1 · Intro"). Click it to rename: the prefix stays and the name becomes a field
	(see NameEditor). The heading keeps just its text; the click target is a button over it.
-->
<script lang="ts">
	import { displayName } from '$lib/model/items';
	import { useEditor } from '$lib/state/context';
	import NameEditor from './NameEditor.svelte';

	interface Props {
		/** What it is, always shown: "Scene 1", "Layer", "Words", "Music"… */
		prefix: string;
		item: { id: string; label?: string } & ({ name: string } | { text: string });
	}

	let { prefix, item }: Props = $props();
	const editor = useEditor();

	// Renaming from here (not on the storyboard, which has its own field).
	let renaming = $state(false);
	const shown = $derived(item.label ? `${prefix} · ${item.label}` : prefix);

	function done(name: string | null) {
		renaming = false;
		if (name !== null) editor.rename(item.id, name);
	}
</script>

<div class="name-title">
	{#if !renaming}
		<!-- Under the heading's text (which lets clicks through to it). -->
		<button
			type="button"
			class="hit"
			title="Rename"
			aria-label="Rename {shown}"
			onclick={() => (renaming = true)}
		></button>
	{/if}
	<h2 class="serif title" class:hidden={renaming}>{shown}</h2>
	{#if renaming}
		<div class="serif title editing">
			<span class="prefix">{prefix} ·</span>
			<NameEditor
				value={displayName(item)}
				label="{prefix} name"
				onsave={(name) => done(name)}
				oncancel={() => done(null)}
			/>
		</div>
	{/if}
</div>

<style>
	.name-title {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.title {
		position: relative;
		pointer-events: none;
		font-size: var(--text-heading);
		line-height: 1;
		/* The same box as the field (its border and padding), so nothing moves. */
		padding: 3px 5px;
		margin: -4px -6px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.title.hidden {
		visibility: hidden;
	}
	.hit {
		position: absolute;
		inset: -4px -6px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		cursor: text;
	}
	.hit:hover {
		background: var(--color-surface);
	}
	.editing {
		position: absolute;
		inset: 0;
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 0.25em;
		padding: 0;
		margin: 0;
		border: none;
		overflow: visible;
	}
	.prefix {
		flex: none;
	}
	.editing :global(.name-editor) {
		flex: 1;
		height: calc(1em + 8px);
		margin: -4px 0;
		font: inherit;
	}
</style>
