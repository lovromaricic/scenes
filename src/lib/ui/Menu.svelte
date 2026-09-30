<!--
	@component
	A small drop-down menu under (or above) an anchor button. Arrow keys move, Enter picks,
	Esc or a click outside closes it and returns focus to the anchor.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { MenuItem } from './types';

	interface Props {
		label: string;
		items: MenuItem[];
		anchor: HTMLElement;
		/** Line the menu up with the anchor's left or right edge. */
		align?: 'start' | 'end';
		onclose: () => void;
	}

	let { label, items, anchor, align = 'start', onclose }: Props = $props();

	let menu: HTMLDivElement;
	let pos = $state({ left: 0, top: 0 });

	function place() {
		const a = anchor.getBoundingClientRect();
		const m = menu.getBoundingClientRect();
		const margin = 8;
		let left = align === 'end' ? a.right - m.width : a.left;
		left = Math.min(Math.max(margin, left), innerWidth - m.width - margin);
		// Below the anchor, or above it when there isn't room.
		let top = a.bottom + 6;
		if (top + m.height > innerHeight - margin) top = Math.max(margin, a.top - m.height - 6);
		pos = { left, top };
	}

	const buttons = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));

	onMount(() => {
		place();
		void tick().then(() => buttons()[0]?.focus());
	});

	function close(restoreFocus = true) {
		onclose();
		if (restoreFocus) anchor.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		const all = buttons();
		const i = all.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			all[(i + step + all.length) % all.length]?.focus();
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			all[event.key === 'Home' ? 0 : all.length - 1]?.focus();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
		} else if (event.key === 'Tab') {
			close(false);
		}
		event.stopPropagation();
	}

	function onWindowPointerDown(event: PointerEvent) {
		const target = event.target as Node;
		if (!menu.contains(target) && !anchor.contains(target)) close(false);
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onresize={() => close(false)} />

<div
	bind:this={menu}
	class="menu"
	role="menu"
	aria-label={label}
	tabindex="-1"
	style:left="{pos.left}px"
	style:top="{pos.top}px"
	{onkeydown}
>
	{#each items as item (item.label)}
		{#if item.separator}<div class="sep" role="separator"></div>{/if}
		<button
			type="button"
			role="menuitem"
			disabled={item.disabled}
			onclick={() => {
				close(false);
				item.onselect();
			}}
		>
			{#if item.icon}<item.icon size={15} strokeWidth={1.8} aria-hidden="true" />{/if}
			<span class="label">{item.label}</span>
			{#if item.shortcut}<kbd class="mono" aria-hidden="true">{item.shortcut}</kbd>{/if}
		</button>
	{/each}
</div>

<style>
	.menu {
		position: fixed;
		z-index: 60;
		min-width: 200px;
		padding: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		box-shadow: var(--shadow-float);
		animation: menu-in var(--dur-fast) var(--ease-out);
	}
	.menu:focus {
		outline: none;
	}
	button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		height: 34px;
		padding: 0 var(--space-3);
		border: none;
		border-radius: 6px;
		background: none;
		color: var(--color-ink);
		font-size: var(--text-md);
		text-align: left;
		white-space: nowrap;
	}
	button:hover:not(:disabled),
	button:focus-visible {
		background: var(--color-surface);
		outline: none;
	}
	button:disabled {
		color: var(--color-muted);
		opacity: 0.6;
	}
	.label {
		flex: 1;
	}
	kbd {
		color: var(--color-muted);
		font-size: var(--text-xs);
	}
	.sep {
		height: 1px;
		margin: var(--space-1) var(--space-2);
		background: var(--color-border);
	}
	@keyframes menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
