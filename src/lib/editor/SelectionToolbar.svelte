<!--
	@component
	The selected object's floating toolbar (its actions and the keyframe buttons, one bar) at a
	fixed spot: centred at the bottom of the video frame (the part in view), 16 px in. It doesn't
	follow the object; if the object covers that spot, it's at the top of the frame instead (decided
	when the object isn't being dragged, so it doesn't jump during a drag). When the frame is too
	narrow, the buttons show icons only (with tooltips); if even that is too wide, the keyframe
	buttons wrap onto a second row.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		TOOLBAR_MARGIN,
		toolbarSide,
		toolbarSpot,
		type Box,
		type ToolbarSide
	} from './toolbarPlacement';
	import { useStageView } from './stageView.svelte';

	interface Props {
		/** The object's on-screen bounds (turned, scaled, where it is now), in preview pixels. */
		bounds: Box;
		/** The preview (the video frame) size. */
		width: number;
		height: number;
		/** While the object is dragged: keep the side it's on (it's checked again after). */
		frozen?: boolean;
		/** The bar's buttons; `compact`: icons only. */
		bar: Snippet<[{ compact: boolean }]>;
		/** A popover opened from the bar; `up`: open it upwards (the bar is at the bottom). */
		panel?: Snippet<[{ up: boolean }]>;
	}

	let { bounds, width, height, frozen = false, bar, panel }: Props = $props();

	const stage = useStageView();

	/** The part of the video frame in view (zoomed in, it can be larger than the stage). */
	const frame = $derived.by(() => {
		const v = stage.visible;
		return {
			left: Math.max(0, v?.x0 ?? 0),
			top: Math.max(0, v?.y0 ?? 0),
			right: Math.min(width, v?.x1 ?? width),
			bottom: Math.min(height, v?.y1 ?? height)
		};
	});
	const room = $derived(Math.max(0, frame.right - frame.left - 2 * TOOLBAR_MARGIN));

	let measuredWidth = $state(0);
	let measuredHeight = $state(0);
	/** Its width with names on the buttons (measured while it shows them). */
	let fullWidth = $state(0);
	let compact = $state(false);
	$effect(() => {
		if (!compact && measuredWidth) fullWidth = measuredWidth;
	});
	$effect(() => {
		if (fullWidth) compact = fullWidth > room;
	});

	const size = $derived({ width: measuredWidth, height: measuredHeight });
	let side = $state<ToolbarSide>('bottom');
	$effect(() => {
		if (frozen || !measuredWidth) return;
		const want = toolbarSide(bounds, frame, size);
		if (want !== side) side = want;
	});
	const spot = $derived(toolbarSpot(frame, size, side));
</script>

<div
	class="selection-toolbar"
	data-testid="selection-toolbar"
	data-toolbar
	data-side={side}
	style:left="{spot.left}px"
	style:top="{spot.top}px"
	style:visibility={measuredWidth ? 'visible' : 'hidden'}
>
	<div
		class="bar"
		class:compact
		style:max-width={compact ? `${room}px` : undefined}
		bind:offsetWidth={measuredWidth}
		bind:offsetHeight={measuredHeight}
	>
		{@render bar({ compact })}
	</div>
	{@render panel?.({ up: side === 'bottom' })}
</div>

<style>
	/* Above the words and layers. */
	.selection-toolbar {
		position: absolute;
		z-index: 7;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: max-content;
		font-size: var(--text-md);
	}
	/* One bar for the actions and the keyframe buttons: dark, with a light edge and a soft
	   shadow, so it reads on black, white and busy video alike. */
	.bar {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 2px;
		padding: 4px;
		border: 1px solid rgb(255 255 255 / 0.15);
		border-radius: 22px;
		background: var(--color-ink);
		box-shadow:
			0 6px 20px rgb(0 0 0 / 0.28),
			0 1px 3px rgb(0 0 0 / 0.3);
		animation: bar-in var(--dur-fast) var(--ease-out);
	}
	.bar :global(.toolbar),
	.bar :global(.keyframe-buttons.dark) {
		padding: 0;
		background: transparent;
		box-shadow: none;
		animation: none;
	}
	/* A thin line between the actions and the keyframe buttons. */
	.bar :global(.keyframe-buttons.dark)::before {
		content: '';
		width: 1px;
		height: 16px;
		margin: 0 4px;
		background: var(--color-ink-line);
	}
	.bar.compact :global(.keyframe-buttons.dark)::before {
		display: none;
	}
	@keyframes bar-in {
		from {
			opacity: 0;
			transform: translateY(4px) scale(0.97);
		}
	}
</style>
