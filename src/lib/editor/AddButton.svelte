<script lang="ts">
	import type { Icon } from '$lib/ui';

	interface Props {
		icon: Icon;
		label: string;
		hint: string;
		active?: boolean;
		onclick?: () => void;
	}

	let { icon: IconComponent, label, hint, active = false, onclick }: Props = $props();
</script>

<button type="button" class="add" class:active aria-expanded={active} {onclick}>
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
		padding: var(--space-3);
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
		width: 48px;
		height: 48px;
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
		gap: 2px;
		min-width: 0;
	}
	.label {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--color-muted);
	}
</style>
