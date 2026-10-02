<!--
	@component
	Renaming a scene or an item in place (on the storyboard or as the settings' title): the
	same quiet outline as renaming the video (`.inline-edit`). It opens with the whole name
	selected; Enter or clicking elsewhere saves, Esc cancels. An empty name brings the default back
	(see `EditorStore.rename`).
-->
<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		value: string;
		/** What's being renamed, for screen readers (e.g. "Scene name"). */
		label: string;
		onsave: (name: string) => void;
		oncancel: () => void;
		class?: string;
		/** As wide as the text (the settings' heading), instead of filling its space. */
		fit?: boolean;
	}

	let { value, label, onsave, oncancel, class: className = '', fit = false }: Props = $props();

	// The name as it was when renaming began; typing doesn't follow later changes to it.
	// svelte-ignore state_referenced_locally
	let draft = $state(value);
	let input = $state<HTMLInputElement>();
	let done = false;

	onMount(() => {
		// After whatever opened it (a menu closing, a double-click) has settled its focus.
		const frame = requestAnimationFrame(() => {
			input?.focus();
			input?.select();
		});
		return () => cancelAnimationFrame(frame);
	});

	function finish(save: boolean) {
		if (done) return;
		done = true;
		if (save) onsave(draft);
		else oncancel();
	}
</script>

{#if fit}
	<!-- The text, invisible, sizes the field (both in one grid cell). -->
	<span class="fit {className}">
		<span class="mirror inline-edit" aria-hidden="true">{draft}<span class="room"></span></span>
		<input
			bind:this={input}
			class="inline-edit name-editor"
			size="1"
			aria-label={label}
			maxlength="80"
			spellcheck="false"
			bind:value={draft}
			onblur={() => finish(true)}
			onkeydown={(e) => {
				// Typing here never reaches the editor's shortcuts.
				e.stopPropagation();
				if (e.key === 'Enter') finish(true);
				else if (e.key === 'Escape') finish(false);
			}}
			onpointerdown={(e) => e.stopPropagation()}
			onclick={(e) => e.stopPropagation()}
			ondblclick={(e) => e.stopPropagation()}
		/>
	</span>
{:else}
	<input
		bind:this={input}
		class="inline-edit name-editor {className}"
		aria-label={label}
		maxlength="80"
		spellcheck="false"
		bind:value={draft}
		onblur={() => finish(true)}
		onkeydown={(e) => {
			// Typing here never reaches the editor's shortcuts.
			e.stopPropagation();
			if (e.key === 'Enter') finish(true);
			else if (e.key === 'Escape') finish(false);
		}}
		onpointerdown={(e) => e.stopPropagation()}
		onclick={(e) => e.stopPropagation()}
		ondblclick={(e) => e.stopPropagation()}
	/>
{/if}

<style>
	.name-editor {
		min-width: 0;
		padding: var(--name-padding, 0 4px);
		font: inherit;
	}
	.fit {
		display: inline-grid;
		max-width: 100%;
		vertical-align: top;
	}
	.fit > * {
		grid-area: 1 / 1;
		width: 100%;
	}
	/* Room for the caret and italic letters leaning past their width. */
	.room {
		display: inline-block;
		width: 0.4em;
	}
	.mirror {
		visibility: hidden;
		padding: var(--name-padding, 0 4px);
		/* At least a little room to type into. */
		min-width: 2ch;
		white-space: pre;
		overflow: hidden;
	}
</style>
