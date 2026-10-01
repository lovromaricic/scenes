<!--
	@component
	An item's keyframes in its settings: how many, and the easing of the stretch at the playhead
	(from the keyframe before it to the next), with the curve editor in a popover.
-->
<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { EASING_LABELS, easingPreset, sortKeyframes } from '$lib/model/keyframes';
	import { useEditor } from '$lib/state/context';
	import CurveEditor from './CurveEditor.svelte';
	import { ConfirmDialog } from '$lib/ui';

	let { id }: { id: string } = $props();

	const editor = useEditor();
	const track = $derived(editor.keyframeTrack(id));
	const list = $derived(track ? sortKeyframes(track.list) : []);
	/** The stretch the playhead is in: its first keyframe (the one that holds the easing). */
	const stretch = $derived.by(() => {
		if (!track || list.length < 2) return null;
		const now = track.fromTimeline(editor.time);
		for (let i = list.length - 2; i >= 0; i--) if (list[i].time <= now + 1e-6) return list[i];
		return null;
	});
	let open = $state(false);
	let confirming = $state(false);
	let anchor = $state<HTMLElement>();

	function onWindowPointerDown(event: PointerEvent) {
		if (open && anchor && !anchor.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#if track && list.length}
	<section class="keyframes" aria-label="Keyframes">
		<h3 class="section-title">Keyframes</h3>
		<p class="count">{list.length === 1 ? '1 keyframe' : `${list.length} keyframes`}</p>
		<div class="easing" bind:this={anchor}>
			{#if stretch}
				{@const name = easingPreset(stretch.easing)}
				<span class="label">Easing here</span>
				<button
					type="button"
					class="pick"
					aria-haspopup="dialog"
					aria-expanded={open}
					onclick={() => (open = !open)}
				>
					{name === 'custom' ? 'Custom' : EASING_LABELS[name]}
					<ChevronDown size={14} aria-hidden="true" />
				</button>
				{#if open}
					<div class="popover" role="dialog" aria-label="Easing curve">
						<CurveEditor
							easing={stretch.easing}
							onchange={(e, key) => editor.setKeyframeEasing(id, [stretch.id], e, key)}
							defaultEasing={editor.defaultEasing}
							onsetdefault={(p) => editor.setDefaultEasing(p)}
						/>
					</div>
				{/if}
			{:else}
				<span class="hint">Move the playhead between two keyframes to change how it moves there.</span>
			{/if}
		</div>
		<button type="button" class="remove" onclick={() => (confirming = true)}>Remove all keyframes</button>
	</section>
{/if}

{#if confirming}
	<ConfirmDialog
		title="Remove all keyframes?"
		message="It stays as it is at the playhead, without moving. You can undo this."
		actions={[
			{
				label: 'Remove all',
				onclick: () => {
					editor.removeAllKeyframes(id);
					confirming = false;
				}
			}
		]}
		danger
		oncancel={() => (confirming = false)}
	/>
{/if}

<style>
	.keyframes {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.section-title {
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
	}
	.count,
	.hint {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.easing {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.label {
		font-size: var(--text-sm);
	}
	.pick {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 30px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-ink);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.remove {
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-muted);
		font: inherit;
		font-size: var(--text-xs);
		text-decoration: underline;
		cursor: pointer;
	}
	.remove:hover {
		color: var(--color-ink);
	}
	.popover {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 30;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		box-shadow: var(--shadow-float);
	}
</style>
