<!--
	@component
	Popover for choosing the transition between two scenes. Positioned in the viewport next to
	the round button that opened it.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { TRANSITIONS } from '$lib/model/catalog';
	import type { TransitionKind } from '$lib/model/types';
	import { TRANSITION_ICONS } from './transitionIcons';

	interface Props {
		/** Viewport position of the button that opened the picker (its top centre). */
		x: number;
		y: number;
		after: number;
		value: TransitionKind;
		onchange: (kind: TransitionKind) => void;
		onclose: () => void;
	}

	let { x, y, after, value, onchange, onclose }: Props = $props();

	let panel: HTMLDivElement;

	onMount(() => {
		panel.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onclose();
			return;
		}
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
		const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next =
			buttons[(i + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
		next.focus();
	}

	function onWindowPointerDown(event: PointerEvent) {
		const target = event.target as HTMLElement;
		if (!panel.contains(target) && !target.closest('.transition')) onclose();
	}

	const left = $derived(Math.min(Math.max(12, x - 130), window.innerWidth - 272));
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div
	bind:this={panel}
	class="picker"
	style:left="{left}px"
	style:bottom="{window.innerHeight - y + 10}px"
	role="dialog"
	aria-label="Transition between scene {after} and {after + 1}"
	tabindex="-1"
	{onkeydown}
>
	<p class="serif heading">Transition</p>
	<div role="radiogroup" aria-label="Transition" class="options">
		{#each TRANSITIONS as t (t.id)}
			{@const Icon = TRANSITION_ICONS[t.id]}
			{@const checked = t.id === value}
			<button
				type="button"
				role="radio"
				aria-checked={checked}
				tabindex={checked ? 0 : -1}
				class="option"
				class:checked
				onclick={() => onchange(t.id)}
			>
				<span class="glyph"><Icon size={16} strokeWidth={1.8} aria-hidden="true" /></span>
				<span class="text">
					<span class="label">{t.label}</span>
					<span class="hint">{t.description}</span>
				</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.picker {
		position: fixed;
		z-index: 60;
		width: 260px;
		padding: var(--space-3);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		box-shadow: var(--shadow-float);
		animation: pop-in var(--dur-fast) var(--ease-out);
	}
	.heading {
		padding: var(--space-1) var(--space-2) var(--space-2);
		font-size: 22px;
		line-height: 1;
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.option {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2);
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		text-align: left;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.option:hover {
		background: var(--color-surface);
	}
	.glyph {
		display: grid;
		place-items: center;
		flex: none;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--color-surface);
	}
	.checked .glyph {
		background: var(--color-ink);
		color: var(--color-on-ink);
	}
	.text {
		display: flex;
		flex-direction: column;
	}
	.label {
		font-weight: var(--weight-medium);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	@keyframes pop-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
</style>
