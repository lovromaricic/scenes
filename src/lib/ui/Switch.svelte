<!--
	@component
	An on/off switch with a label (role="switch").
-->
<script lang="ts">
	interface Props {
		checked: boolean;
		label: string;
		/** Small line under the label. */
		hint?: string;
		onchange?: (checked: boolean) => void;
	}

	let { checked = $bindable(), label, hint, onchange }: Props = $props();

	function toggle() {
		checked = !checked;
		onchange?.(checked);
	}
</script>

<button type="button" role="switch" aria-checked={checked} class="switch" onclick={toggle}>
	<span class="text">
		<span class="label">{label}</span>
		{#if hint}<span class="hint">{hint}</span>{/if}
	</span>
	<span class="track" aria-hidden="true"><span class="thumb"></span></span>
</button>

<style>
	.switch {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		text-align: left;
		border-radius: var(--radius-sm);
	}
	.text {
		display: flex;
		flex-direction: column;
	}
	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.track {
		position: relative;
		flex: none;
		width: 38px;
		height: 22px;
		border-radius: var(--radius-pill);
		background: var(--color-border);
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-bg);
		box-shadow: var(--shadow-card);
		transition: translate var(--dur-fast) var(--ease-out);
	}
	[aria-checked='true'] .track {
		background: var(--color-ink);
	}
	[aria-checked='true'] .thumb {
		translate: 16px 0;
	}
	.switch:focus-visible {
		box-shadow: none;
	}
	.switch:focus-visible .track {
		box-shadow: var(--focus-ring);
	}
</style>
