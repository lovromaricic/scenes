<!--
	@component
	Places a selected object's floating toolbar (its actions and the keyframe buttons, as one unit)
	inside the video frame: above the object if it fits, else below, else pinned at the top; at the
	nearest edge for an object entirely outside the frame (see toolbarPlacement.ts). It never goes
	on the pasteboard or over the panels around the stage. When the frame is too narrow for it, the
	toolbar shows icons only, and if even that is too wide, the keyframe buttons go on a second
	row (the rows wrap within the frame's width).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { placeToolbar, type Box } from './toolbarPlacement';
	import { useStageView } from './stageView.svelte';

	interface Props {
		/** The object's on-screen bounds (turned, scaled, where it is now), in preview pixels. */
		bounds: Box;
		/** The preview (the video frame) size. */
		width: number;
		height: number;
		/** The toolbar; `compact`: icons only. `up`: open popovers upwards (it's low in the frame). */
		children: Snippet<[{ compact: boolean; up: boolean }]>;
	}

	let { bounds, width, height, children }: Props = $props();

	const stage = useStageView();
	const MARGIN = 8;

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

	let measuredWidth = $state(0);
	let measuredHeight = $state(0);
	/** Its width with names on the buttons (measured while it shows them). */
	let fullWidth = $state(0);
	let compact = $state(false);

	$effect(() => {
		if (!compact && measuredWidth) fullWidth = measuredWidth;
	});
	$effect(() => {
		if (fullWidth) compact = fullWidth > frame.right - frame.left - 2 * MARGIN;
	});

	const place = $derived(
		placeToolbar(
			bounds,
			frame,
			{ width: measuredWidth, height: measuredHeight },
			{ margin: MARGIN }
		)
	);
	const up = $derived(place.top + measuredHeight / 2 > (frame.top + frame.bottom) / 2);
</script>

<div
	class="selection-toolbar"
	data-testid="selection-toolbar"
	data-placement={place.placement}
	style:left="{place.left}px"
	style:top="{place.top}px"
	style:visibility={measuredWidth ? 'visible' : 'hidden'}
	style:max-width={compact ? `${Math.max(0, frame.right - frame.left - 2 * MARGIN)}px` : undefined}
	bind:offsetWidth={measuredWidth}
	bind:offsetHeight={measuredHeight}
>
	{@render children({ compact, up })}
</div>

<style>
	/* Above the words and layers; only the toolbar itself takes clicks. */
	.selection-toolbar {
		position: absolute;
		z-index: 7;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: max-content;
		font-size: var(--text-md);
	}
</style>
