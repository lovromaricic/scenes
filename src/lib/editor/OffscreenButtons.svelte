<!--
	@component
	"Move off-screen": puts a layer or words just outside one edge of the frame, at its current
	height (left, right) or across position (top, bottom). A clean start for sliding in; with
	keyframes it sets the keyframe at the playhead, like any other change.
-->
<script lang="ts">
	import ArrowLeftToLine from '@lucide/svelte/icons/arrow-left-to-line';
	import ArrowRightToLine from '@lucide/svelte/icons/arrow-right-to-line';
	import ArrowUpToLine from '@lucide/svelte/icons/arrow-up-to-line';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import { Button } from '$lib/ui';
	import type { OffscreenSide } from '$lib/model/offscreen';
	import { useEditor } from '$lib/state/context';

	let { id }: { id: string } = $props();

	const editor = useEditor();

	const sides: { side: OffscreenSide; label: string; icon: typeof ArrowLeftToLine }[] = [
		{ side: 'left', label: 'Left', icon: ArrowLeftToLine },
		{ side: 'right', label: 'Right', icon: ArrowRightToLine },
		{ side: 'top', label: 'Top', icon: ArrowUpToLine },
		{ side: 'bottom', label: 'Bottom', icon: ArrowDownToLine }
	];
</script>

<div class="offscreen" role="group" aria-label="Move off-screen">
	<p class="label">Move off-screen</p>
	<div class="buttons">
		{#each sides as s (s.side)}
			<Button
				variant="soft"
				size="sm"
				icon={s.icon}
				title="Just outside the frame’s {s.side} edge"
				onclick={() => editor.moveOffscreen(id, s.side)}>{s.label}</Button
			>
		{/each}
	</div>
</div>

<style>
	.offscreen {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.label {
		font-size: var(--text-sm);
		color: var(--color-muted);
	}
	.buttons {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-1);
	}
</style>
