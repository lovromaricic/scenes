<script lang="ts">
	import type { Icon } from '$lib/ui';

	interface Props {
		icon: Icon;
		label: string;
		hint: string;
		active?: boolean;
		/** Whether it opens a panel (announced to screen readers as expanded/collapsed). */
		togglesPanel?: boolean;
		onclick?: () => void;
		/** When given, the button can be dragged (e.g. Cards onto the storyboard). */
		ondragstart?: (event: DragEvent) => void;
	}

	let {
		icon: IconComponent,
		label,
		hint,
		active = false,
		togglesPanel = true,
		onclick,
		ondragstart
	}: Props = $props();
</script>

<button
	type="button"
	class="add"
	class:active
	aria-expanded={togglesPanel ? active : undefined}
	draggable={ondragstart ? 'true' : undefined}
	{onclick}
	{ondragstart}
>
	<span class="glyph"><IconComponent size={22} strokeWidth={1.7} aria-hidden="true" /></span>
	<span class="text">
		<span class="label">{label}</span>
		<span class="hint">{hint}</span>
	</span>
</button>

<style>
	.add {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		text-align: left;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.add:hover {
		border-color: var(--color-muted);
	}
	.add:active {
		transform: scale(0.98);
	}
	.add.active {
		border-color: var(--color-ink);
		background: var(--color-surface);
	}
	.glyph {
		display: grid;
		place-items: center;
		flex: none;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-md);
		background: var(--color-surface);
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.active .glyph {
		background: var(--color-ink);
		color: var(--color-on-ink);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 0;
		min-width: 0;
	}
	.label {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		line-height: 1.2;
	}
	.hint {
		font-size: var(--text-sm);
		line-height: 1.25;
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	@media (max-width: 1279px) {
		.add {
			gap: var(--space-2);
			padding: 6px var(--space-2);
		}
		.glyph {
			width: 32px;
			height: 32px;
		}
		.label {
			font-size: var(--text-md);
		}
		.hint {
			font-size: var(--text-xs);
		}
	}
</style>
