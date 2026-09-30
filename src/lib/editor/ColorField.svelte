<!--
	@component
	Pick a colour: swatches from the card palette, a colour picker, and a hex field.
-->
<script lang="ts">
	import { CARD_COLORS, normalizeHex } from '$lib/model/card';

	interface Props {
		label: string;
		value: string;
		/** `key` merges quick repeats (dragging in the colour picker) into one undo step. */
		onchange: (hex: string, key?: string) => void;
	}

	let { label, value, onchange }: Props = $props();

	// Follows the value, but can be typed into until it's committed.
	let hex = $derived(value);

	const current = $derived(value.toLowerCase());
	let group: HTMLDivElement;

	function commitHex() {
		const v = normalizeHex(hex);
		if (v) onchange(v);
		else hex = value;
	}

	function onkeydown(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		event.preventDefault();
		const i = Math.max(
			0,
			CARD_COLORS.findIndex((c) => c.value === current)
		);
		const next =
			(i + (event.key === 'ArrowRight' ? 1 : -1) + CARD_COLORS.length) % CARD_COLORS.length;
		onchange(CARD_COLORS[next].value);
		group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
	}
</script>

<div class="color-field">
	<div
		bind:this={group}
		class="swatches"
		role="radiogroup"
		aria-label={label}
		tabindex="-1"
		{onkeydown}
	>
		{#each CARD_COLORS as c, i (c.value)}
			{@const checked = c.value === current}
			<button
				type="button"
				role="radio"
				aria-checked={checked}
				aria-label={c.label}
				title={c.label}
				tabindex={checked || (i === 0 && !CARD_COLORS.some((x) => x.value === current)) ? 0 : -1}
				class="swatch"
				class:checked
				style:background={c.value}
				onclick={() => onchange(c.value)}
			></button>
		{/each}
	</div>
	<div class="custom">
		<input
			type="color"
			aria-label="{label}: custom colour"
			{value}
			oninput={(e) => onchange(e.currentTarget.value, `color:${label}`)}
		/>
		<input
			class="hex mono"
			type="text"
			aria-label="{label}: hex code"
			spellcheck="false"
			maxlength="7"
			bind:value={hex}
			onchange={commitHex}
			onkeydown={(e) => e.key === 'Enter' && commitHex()}
		/>
	</div>
</div>

<style>
	.color-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.swatch {
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 18%, transparent);
		transition: transform var(--dur-fast) var(--ease-out);
	}
	.swatch:hover {
		transform: scale(1.08);
	}
	.swatch.checked {
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 18%, transparent),
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-accent);
	}
	.swatch:focus-visible {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-ink);
	}
	.custom {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	input[type='color'] {
		width: 34px;
		height: 30px;
		padding: 2px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		cursor: pointer;
	}
	.hex {
		width: 96px;
		height: 30px;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		text-transform: lowercase;
	}
	.hex:focus-visible {
		border-color: var(--color-ink);
		box-shadow: none;
	}
</style>
