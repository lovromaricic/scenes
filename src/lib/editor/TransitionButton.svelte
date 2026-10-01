<script lang="ts">
	import { TRANSITIONS } from '$lib/model/catalog';
	import { TRANSITION_BUTTON_ICONS } from './transitionIcons';
	import type { TransitionKind } from '$lib/model/types';

	interface Props {
		kind: TransitionKind;
		/** 1-based number of the scene before this transition. */
		after: number;
		active?: boolean;
		onclick?: (event: MouseEvent) => void;
	}

	let { kind, after, active = false, onclick }: Props = $props();

	const Icon = $derived(TRANSITION_BUTTON_ICONS[kind]);
	const label = $derived(TRANSITIONS.find((t) => t.id === kind)?.label ?? 'Cut');
</script>

<button
	type="button"
	class="transition"
	class:set={kind !== 'cut'}
	class:active
	aria-label="Transition between scene {after} and {after + 1}: {label}"
	title="Transition: {label}"
	aria-expanded={active}
	aria-haspopup="dialog"
	{onclick}
>
	<Icon size={12} strokeWidth={2} aria-hidden="true" />
</button>

<style>
	.transition {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-bg);
		color: var(--color-muted);
		transition:
			transform var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}
	@media (pointer: coarse) {
		.transition {
			width: 32px;
			height: 32px;
		}
	}
	.transition:hover {
		transform: scale(1.12);
		color: var(--color-ink);
		border-color: var(--color-ink);
	}
	.set {
		border-color: var(--color-ink);
		background: var(--color-ink);
		color: var(--color-on-ink);
	}
	.set:hover {
		color: var(--color-on-ink);
	}
	/* Open (its picker showing): a thin border isn't enough on its own, so a ring around it. */
	.active {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}
</style>
