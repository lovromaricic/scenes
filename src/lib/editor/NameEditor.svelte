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
	}

	let { value, label, onsave, oncancel, class: className = '' }: Props = $props();

	// The name as it was when renaming began; typing doesn't follow later changes to it.
	// svelte-ignore state_referenced_locally
	let draft = $state(value);
	let input: HTMLInputElement;
	let done = false;

	onMount(() => {
		// After whatever opened it (a menu closing, a double-click) has settled its focus.
		const frame = requestAnimationFrame(() => {
			input.focus();
			input.select();
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

<style>
	.name-editor {
		min-width: 0;
		padding: 0 4px;
		font: inherit;
	}
</style>
