<!--
	@component
	A message about one item, as a small bubble next to it in the storyboard, pointing at it
	(see messages.svelte.ts). Above the item when there's room under the ruler (so it never covers
	the playhead's handle), otherwise below; always inside the storyboard. It follows the item
	while it's shown and goes when the item scrolls out of view, after about 4 seconds, on any
	click (or the start of a drag), or on Esc.
-->
<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { messages } from '$lib/state/messages.svelte';

	let { container }: { container: HTMLElement | undefined } = $props();

	const bubble = $derived(messages.bubble);
	let el = $state<HTMLDivElement>();
	let pos = $state<{ left: number; top: number; arrow: number; below: boolean } | null>(null);
	const GAP = 10;
	const MARGIN = 6;

	/** The item's element in the storyboard (a layer, words or sound; a scene card; a collapsed bar). */
	function itemElement(id: string): HTMLElement | null {
		const q = (sel: string) => container?.querySelector<HTMLElement>(sel) ?? null;
		return (
			q(`[data-item-id="${id}"]`) ?? q(`[data-scene-id="${id}"]`) ?? q(`[data-bar-id="${id}"]`)
		);
	}

	// Place it every frame while it's shown (the item may move, scroll or resize).
	$effect(() => {
		const b = bubble;
		if (!b || !container) {
			pos = null;
			return;
		}
		let frame = 0;
		const place = () => {
			frame = requestAnimationFrame(place);
			const target = itemElement(b.itemId);
			const tracks = container!.querySelector<HTMLElement>('.tracks');
			const ruler = container!.querySelector<HTMLElement>('.ruler-row');
			if (!target || !tracks || !el) {
				pos = null;
				return;
			}
			const r = target.getBoundingClientRect();
			const view = tracks.getBoundingClientRect();
			const box = container!.getBoundingClientRect();
			// Under the ruler (and the playhead's handle on it), right of the track headers.
			const top = ruler ? ruler.getBoundingClientRect().bottom : view.top;
			const left =
				container!.querySelector('.ruler-row .corner')?.getBoundingClientRect().right ?? view.left;
			const visible = {
				left: Math.max(r.left, left),
				right: Math.min(r.right, view.right),
				top: Math.max(r.top, top),
				bottom: Math.min(r.bottom, view.bottom)
			};
			if (visible.left >= visible.right || visible.top >= visible.bottom) {
				// Scrolled out of view: it goes.
				messages.dismissBubble(b.id);
				return;
			}
			const w = el.offsetWidth;
			const h = el.offsetHeight;
			const below = visible.top - GAP - h < top;
			let y = below ? visible.bottom + GAP : visible.top - GAP - h;
			y = Math.max(top, Math.min(box.bottom - MARGIN - h, y));
			const cx = (visible.left + visible.right) / 2;
			const x = Math.max(box.left + MARGIN, Math.min(box.right - MARGIN - w, cx - w / 2));
			pos = { left: x, top: y, arrow: Math.max(12, Math.min(w - 12, cx - x)), below };
		};
		place();
		return () => cancelAnimationFrame(frame);
	});

	function onWindowPointerDown(event: PointerEvent) {
		if (bubble && !(event.target as Element).closest?.('.item-bubble button'))
			messages.dismissBubble();
	}
	function onWindowKeydown(event: KeyboardEvent) {
		if (bubble && event.key === 'Escape') messages.dismissBubble();
	}
</script>

<svelte:window onpointerdowncapture={onWindowPointerDown} onkeydowncapture={onWindowKeydown} />

{#if bubble}
	<div
		bind:this={el}
		class="item-bubble"
		class:error={bubble.tone === 'error'}
		class:below={pos?.below}
		role="status"
		aria-live="polite"
		data-testid="item-bubble"
		data-item={bubble.itemId}
		style:left="{pos?.left ?? -9999}px"
		style:top="{pos?.top ?? -9999}px"
		style:visibility={pos ? 'visible' : 'hidden'}
		style:--arrow="{pos?.arrow ?? 0}px"
	>
		{#if bubble.tone === 'error'}<CircleAlert size={14} strokeWidth={1.8} aria-hidden="true" />{/if}
		<p>{bubble.message}</p>
		<button type="button" aria-label="Close" onclick={() => messages.dismissBubble()}>
			<X size={12} strokeWidth={2} aria-hidden="true" />
		</button>
	</div>
{/if}

<style>
	.item-bubble {
		position: fixed;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		max-width: 320px;
		padding: 6px 6px 6px 12px;
		border-radius: var(--radius-sm);
		background: var(--color-ink);
		color: var(--color-on-ink);
		box-shadow: var(--shadow-float);
		font-size: var(--text-sm);
		line-height: 1.35;
		animation: bubble-in var(--dur-fast) var(--ease-out);
	}
	/* The pointer toward the item: under the bubble, or above it when it's below the item. */
	.item-bubble::after {
		content: '';
		position: absolute;
		left: var(--arrow);
		top: 100%;
		width: 10px;
		height: 6px;
		translate: -50% 0;
		background: inherit;
		clip-path: polygon(0 0, 100% 0, 50% 100%);
	}
	.item-bubble.below::after {
		top: auto;
		bottom: 100%;
		clip-path: polygon(50% 0, 100% 100%, 0 100%);
	}
	.item-bubble p {
		flex: 1;
	}
	button {
		display: grid;
		place-items: center;
		flex: none;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--color-on-ink-muted);
	}
	button:hover {
		background: var(--color-ink-line);
		color: var(--color-on-ink);
	}
	@keyframes bubble-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
</style>
