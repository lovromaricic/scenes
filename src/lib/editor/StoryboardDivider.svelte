<!--
	@component
	The line between the preview and the storyboard. Drag it up for a taller storyboard, down for a
	bigger preview; double-click to go back to the default. Arrow keys move it too. The height is
	remembered on this device.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { DragScope } from '$lib/ui/drag';

	interface Props {
		/** The storyboard's height now. */
		height: number;
		min: number;
		max: number;
		/** A new height (already within the limits' reach; the parent clamps). */
		onresize: (height: number) => void;
		/** Back to the default. */
		onreset: () => void;
	}

	let { height, min, max, onresize, onreset }: Props = $props();

	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	let dragging = $state(false);

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		event.preventDefault();
		const y0 = event.clientY;
		const h0 = height;
		dragging = true;
		drags.start(event, {
			move: (e) => onresize(Math.min(max, Math.max(min, h0 - (e.clientY - y0)))),
			end: () => (dragging = false)
		});
	}

	function onkeydown(event: KeyboardEvent) {
		const step = event.shiftKey ? 64 : 16;
		if (event.key === 'ArrowUp') onresize(Math.min(max, height + step));
		else if (event.key === 'ArrowDown') onresize(Math.max(min, height - step));
		else if (event.key === 'Home') onresize(max);
		else if (event.key === 'End') onresize(min);
		else if (event.key === 'Enter') onreset();
		else return;
		event.preventDefault();
		event.stopPropagation();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (a focusable separator is the ARIA pattern for a resizer) -->
<div
	class="divider"
	class:dragging
	role="separator"
	aria-orientation="horizontal"
	aria-label="Resize the storyboard"
	aria-valuenow={height}
	aria-valuemin={min}
	aria-valuemax={max}
	title="Drag to share the space between the preview and the storyboard · double-click to reset"
	tabindex="0"
	{onpointerdown}
	ondblclick={onreset}
	{onkeydown}
>
	<span class="grip" aria-hidden="true"></span>
</div>

<style>
	.divider {
		position: relative;
		z-index: 5;
		display: grid;
		place-items: center;
		height: 8px;
		cursor: ns-resize;
		touch-action: none;
	}
	.divider::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 1px;
		background: var(--color-border);
	}
	/* A taller invisible area, easier to grab. */
	.divider::after {
		content: '';
		position: absolute;
		inset: -4px 0;
	}
	.grip {
		position: relative;
		width: 36px;
		height: 4px;
		border-radius: var(--radius-pill);
		background: var(--color-border);
		opacity: 0;
		transition:
			opacity var(--dur-fast) var(--ease-out),
			background var(--dur-fast) var(--ease-out);
	}
	.divider:hover .grip,
	.divider:focus-visible .grip,
	.dragging .grip {
		opacity: 1;
	}
	.divider:hover::before,
	.dragging::before {
		background: var(--color-muted);
	}
	.dragging .grip,
	.divider:focus-visible .grip {
		background: var(--color-ink);
	}
	.divider:focus-visible {
		outline: none;
	}
</style>
