<!--
	@component
	A simple labelled range slider (used for volume). Native input, styled with tokens.
-->
<script lang="ts">
	interface Props {
		value: number;
		label: string;
		min?: number;
		max?: number;
		step?: number;
		format?: (value: number) => string;
		onchange?: (value: number) => void;
		/** Fires continuously while dragging. */
		oninput?: (value: number) => void;
	}

	let {
		value = $bindable(),
		label,
		min = 0,
		max = 1,
		step = 0.01,
		format = (v) => `${Math.round(v * 100)}%`,
		onchange,
		oninput
	}: Props = $props();

	const fill = $derived(((value - min) / (max - min)) * 100);
</script>

<div class="slider">
	<input
		type="range"
		aria-label={label}
		aria-valuetext={format(value)}
		{min}
		{max}
		{step}
		bind:value
		style:--fill="{fill}%"
		oninput={() => oninput?.(value)}
		onchange={() => onchange?.(value)}
	/>
	<output class="mono">{format(value)}</output>
</div>

<style>
	.slider {
		display: flex;
		width: 100%;
		align-items: center;
		gap: var(--space-3);
	}
	input {
		flex: 1;
		height: 20px;
		margin: 0;
		background: transparent;
		appearance: none;
		cursor: pointer;
	}
	input::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: var(--radius-pill);
		background: linear-gradient(
			to right,
			var(--color-ink) var(--fill),
			var(--color-border) var(--fill)
		);
	}
	input::-moz-range-track {
		height: 4px;
		border-radius: var(--radius-pill);
		background: var(--color-border);
	}
	input::-moz-range-progress {
		height: 4px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
	}
	input::-webkit-slider-thumb {
		appearance: none;
		width: 16px;
		height: 16px;
		margin-top: -6px;
		border: 2px solid var(--color-bg);
		border-radius: 50%;
		background: var(--color-ink);
		box-shadow: var(--shadow-card);
	}
	input::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-bg);
		border-radius: 50%;
		background: var(--color-ink);
	}
	input:focus-visible {
		box-shadow: none;
	}
	input:focus-visible::-webkit-slider-thumb {
		box-shadow: var(--focus-ring);
	}
	output {
		min-width: 40px;
		text-align: right;
		font-size: var(--text-sm);
		color: var(--color-muted);
	}
</style>
