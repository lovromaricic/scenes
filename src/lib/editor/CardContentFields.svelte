<!--
	@component
	What a card shows: its background and an optional rectangle (colour, size and position in
	pixels, corners, Center / Fill). Used for card scenes and card layers. `frame` is the card's
	own size in project pixels (the video's size for a scene, the layer's box for a layer).
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import AlignCenter from '@lucide/svelte/icons/align-center';
	import Maximize from '@lucide/svelte/icons/maximize';
	import { Button, Field, Slider } from '$lib/ui';
	import {
		defaultRect,
		rectFromPixels,
		rectToPixels,
		type CardContent
	} from '$lib/model/card';
	import type { Size } from '$lib/model/crop';
	import ColorField from './ColorField.svelte';

	interface Props {
		card: CardContent;
		frame: Size;
		/** Identifies the card, so quick repeats (typing, sliders) merge into one undo step. */
		id: string;
		onchange: (card: CardContent, key?: string) => void;
	}

	let { card, frame, id, onchange: update }: Props = $props();

	const format = $derived(frame);
	const scene = $derived({ id });
	const px = $derived(card.rect ? rectToPixels(card.rect, format) : null);

	function setPixels(field: 'x' | 'y' | 'w' | 'h', value: string) {
		if (!card.rect || !px || value.trim() === '') return;
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		update(
			{ ...card, rect: rectFromPixels(card.rect, { ...px, [field]: Math.round(n) }, format) },
			`rect-${field}:${scene.id}`
		);
	}

	const fields = [
		{ key: 'w', label: 'Width' },
		{ key: 'h', label: 'Height' },
		{ key: 'x', label: 'X' },
		{ key: 'y', label: 'Y' }
	] as const;
</script>

<Field label="Background">
	<ColorField
		label="Background"
		value={card.background}
		onchange={(background, key) => update({ ...card, background }, key)}
	/>
</Field>

{#if card.rect}
	{@const rect = card.rect}
	<section class="rect" aria-label="Rectangle">
		<h3 class="section-title">Rectangle</h3>
		<Field label="Colour">
			<ColorField
				label="Rectangle colour"
				value={rect.color}
				onchange={(color, key) => update({ ...card, rect: { ...rect, color } }, key)}
			/>
		</Field>
		<div class="grid">
			{#each fields as f (f.key)}
				<label class="num">
					<span>{f.label}</span>
					<input
						type="number"
						step="1"
						aria-label="Rectangle {f.label.toLowerCase()}"
						value={px ? px[f.key] : 0}
						oninput={(e) => setPixels(f.key, e.currentTarget.value)}
					/>
				</label>
			{/each}
		</div>
		<Field label="Corners">
			<Slider
				label="Corner radius"
				value={rect.radius}
				format={(v) => (v === 0 ? 'Square' : v >= 1 ? 'Round' : `${Math.round(v * 100)}%`)}
				oninput={(radius) => update({ ...card, rect: { ...rect, radius } }, `radius:${scene.id}`)}
			/>
		</Field>
		<div class="row">
			<Button
				variant="soft"
				size="sm"
				icon={AlignCenter}
				onclick={() =>
					update({ ...card, rect: { ...rect, x: (1 - rect.w) / 2, y: (1 - rect.h) / 2 } })}
				>Center</Button
			>
			<Button
				variant="soft"
				size="sm"
				icon={Maximize}
				onclick={() => update({ ...card, rect: { ...rect, x: 0, y: 0, w: 1, h: 1 } })}
				>Fill frame</Button
			>
		</div>
		<button type="button" class="link" onclick={() => update({ ...card, rect: null })}
			>Remove rectangle</button
		>
	</section>
{:else}
	<Button
		variant="soft"
		size="sm"
		icon={Plus}
		onclick={() => update({ ...card, rect: defaultRect(card.background) })}
	>
		Add rectangle
	</Button>
{/if}

<style>
	.rect {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: 100%;
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.section-title {
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-2);
	}
	.num {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.num input {
		width: 100%;
		min-width: 0;
		height: 34px;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--color-ink);
	}
	.num input:focus-visible {
		border-color: var(--color-ink);
		box-shadow: none;
	}
	.row {
		display: flex;
		gap: var(--space-2);
	}
	.link {
		align-self: flex-start;
		padding: 0;
		border: none;
		background: none;
		color: var(--color-ink);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		text-decoration: underline;
		text-underline-offset: 3px;
		border-radius: 4px;
	}
</style>
