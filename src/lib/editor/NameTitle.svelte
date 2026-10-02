<!--
	@component
	The settings' heading for a scene or an item: its name once it's been renamed ("Intro"),
	otherwise what it is ("Scene 2", "Layer"). Click it to rename: the whole heading becomes a
	field, as wide as its text, in the same font and place, with the text selected (typing
	replaces it). Clearing it, or typing the plain heading, brings the plain heading back. The
	heading keeps just its text; the click target is a button behind it.
-->
<script lang="ts">
	import { useEditor } from '$lib/state/context';
	import NameEditor from './NameEditor.svelte';

	interface Props {
		/** The heading without a name: "Scene 2", "Layer", "Words", "Music"… */
		plain: string;
		item: { id: string; label?: string };
	}

	let { plain, item }: Props = $props();
	const editor = useEditor();

	// Renaming from here (not on the storyboard, which has its own field).
	let renaming = $state(false);
	const shown = $derived(item.label || plain);

	function done(name: string | null) {
		renaming = false;
		if (name === null) return;
		editor.rename(item.id, name.trim() === plain ? '' : name);
	}
</script>

<div class="name-title">
	{#if renaming}
		<NameEditor
			fit
			class="serif heading-field"
			value={shown}
			label="{plain} name"
			onsave={(name) => done(name)}
			oncancel={() => done(null)}
		/>
	{:else}
		<!-- Behind the heading's text (which lets clicks through to it). -->
		<button
			type="button"
			class="hit"
			title="Rename"
			aria-label="Rename {shown}"
			onclick={() => (renaming = true)}
		></button>
		<h2 class="serif title">{shown}</h2>
	{/if}
</div>

<style>
	.name-title {
		position: relative;
		/* As wide as the heading (so is its hover), leaving room for buttons beside it. */
		flex: 0 1 auto;
		min-width: 0;
		/* The field's box (its border and padding) around the heading's text, shown or not, so
		   nothing moves when renaming starts. */
		--name-padding: 3px 5px;
	}
	.title,
	.name-title :global(.heading-field) {
		font-size: var(--text-heading);
		line-height: 1;
		margin: -4px -6px;
	}
	.title {
		position: relative;
		pointer-events: none;
		width: fit-content;
		max-width: calc(100% + 12px);
		padding: var(--name-padding);
		border: 1px solid transparent;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
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
</style>
