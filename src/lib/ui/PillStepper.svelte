<!--
	@component
	A pill with − and + buttons around a value, e.g. "Length  − 4.0 sec +".
	Holding a button repeats the step.
-->
<script lang="ts">
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';

	interface Props {
		value: number;
		min?: number;
		max?: number;
		step?: number;
		/** Accessible name of the whole control, e.g. "Length". */
		label: string;
		decreaseLabel?: string;
		increaseLabel?: string;
		format?: (value: number) => string;
		onchange?: (value: number) => void;
		disabled?: boolean;
	}

	let {
		value = $bindable(),
		min = -Infinity,
		max = Infinity,
		step = 1,
		label,
		decreaseLabel = `Less ${label.toLowerCase()}`,
		increaseLabel = `More ${label.toLowerCase()}`,
		format = (v) => String(v),
		onchange,
		disabled = false
	}: Props = $props();

	let repeatTimer: ReturnType<typeof setTimeout> | undefined;
	/** Set once a held button has auto-repeated, so the release click doesn't add one more step. */
	let repeated = false;

	function nudge(direction: -1 | 1) {
		// Round to the step grid so repeated nudges never accumulate float error.
		const next = Math.round((value + direction * step) / step) * step;
		const clamped = Math.min(max, Math.max(min, Number(next.toFixed(6))));
		if (clamped === value) return;
		value = clamped;
		onchange?.(clamped);
	}

	function click(direction: -1 | 1) {
		if (repeated) {
			repeated = false;
			return;
		}
		nudge(direction);
	}

	function startRepeat(direction: -1 | 1) {
		stopRepeat();
		repeated = false;
		const tick = (delay: number) => {
			repeatTimer = setTimeout(() => {
				repeated = true;
				nudge(direction);
				tick(60);
			}, delay);
		};
		tick(400);
	}

	function stopRepeat() {
		clearTimeout(repeatTimer);
		repeatTimer = undefined;
	}
</script>

<div class="stepper" role="group" aria-label={label} class:disabled>
	<button
		type="button"
		aria-label={decreaseLabel}
		disabled={disabled || value <= min}
		onclick={() => click(-1)}
		onpointerdown={() => startRepeat(-1)}
		onpointerup={stopRepeat}
		onpointerleave={stopRepeat}
		onpointercancel={stopRepeat}
	>
		<Minus size={16} strokeWidth={2} aria-hidden="true" />
	</button>
	<output class="value mono" aria-live="polite">{format(value)}</output>
	<button
		type="button"
		aria-label={increaseLabel}
		disabled={disabled || value >= max}
		onclick={() => click(1)}
		onpointerdown={() => startRepeat(1)}
		onpointerup={stopRepeat}
		onpointerleave={stopRepeat}
		onpointercancel={stopRepeat}
	>
		<Plus size={16} strokeWidth={2} aria-hidden="true" />
	</button>
</div>

<style>
	.stepper {
		display: inline-flex;
		align-items: center;
		height: 40px;
		padding: 3px;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
	}
	.stepper.disabled {
		opacity: 0.5;
	}
	button {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		padding: 0;
		border: none;
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		box-shadow: var(--shadow-card);
		transition:
			transform var(--dur-fast) var(--ease-out),
			opacity var(--dur-fast) var(--ease-out);
	}
	button:active:not(:disabled) {
		transform: scale(0.92);
	}
	button:disabled {
		opacity: 0.4;
		box-shadow: none;
	}
	button:focus-visible {
		box-shadow: var(--focus-ring);
	}
	.value {
		min-width: 84px;
		padding: 0 var(--space-2);
		text-align: center;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
	}
</style>
