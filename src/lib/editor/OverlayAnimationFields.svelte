<!--
	@component
	How a layer comes in and goes out: the same animations as words (none, fade, slide up, pop).
-->
<script lang="ts">
	import { ChipGroup, Field } from '$lib/ui';
	import { TEXT_ANIMATIONS } from '$lib/model/catalog';
	import type { Overlay } from '$lib/model/overlay';
	import type { TextAnimation } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';

	let { overlay }: { overlay: Overlay } = $props();

	const editor = useEditor();
	const options = TEXT_ANIMATIONS.map((a) => ({ value: a.id, label: a.label }));
</script>

<div class="fields">
	<Field label="Comes in">
		<ChipGroup
			label="Entrance"
			size="sm"
			{options}
			value={overlay.enter}
			onchange={(v: TextAnimation) => editor.setOverlayAnimation(overlay.id, 'enter', v)}
		/>
	</Field>
	<Field label="Goes out">
		<ChipGroup
			label="Exit"
			size="sm"
			{options}
			value={overlay.exit}
			onchange={(v: TextAnimation) => editor.setOverlayAnimation(overlay.id, 'exit', v)}
		/>
	</Field>
</div>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
