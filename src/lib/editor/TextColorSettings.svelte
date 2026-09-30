<!--
	@component
	Colour, opacity and outline for a text item. The style gives the starting colours; changing one
	overrides just that colour, and "Reset colors" goes back to the style's own.
-->
<script lang="ts">
	import { Field, Slider } from '$lib/ui';
	import {
		resolveTextStyle,
		styleHasBox,
		styleHasOutline,
		TEXT_COLORS,
		type TextColors
	} from '$lib/model/textStyle';
	import type { TextItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import ColorField from './ColorField.svelte';

	let { item }: { item: TextItem } = $props();

	const editor = useEditor();
	const resolved = $derived(resolveTextStyle(item));
	const boxPaint = $derived(resolved.box ?? resolved.band);

	function change(patch: TextColors, key?: string) {
		editor.setTextColors(item.id, { ...(item.colors ?? {}), ...patch }, key);
	}
</script>

<section class="colors" aria-label="Color">
	<Field label="Text color">
		<ColorField
			label="Text color"
			palette={TEXT_COLORS}
			value={resolved.fill.color}
			opacity={resolved.fill.opacity}
			onchange={(color, key) => change({ fill: { ...resolved.fill, color } }, key)}
			onopacity={(opacity, key) => change({ fill: { ...resolved.fill, opacity } }, key)}
		/>
	</Field>

	{#if styleHasBox(item.style) && boxPaint}
		<Field label={item.style === 'highlight' ? 'Highlight color' : 'Box color'}>
			<ColorField
				label="Box color"
				palette={TEXT_COLORS}
				value={boxPaint.color}
				opacity={boxPaint.opacity}
				onchange={(color, key) => change({ box: { color, opacity: boxPaint.opacity } }, key)}
				onopacity={(opacity, key) => change({ box: { color: boxPaint.color, opacity } }, key)}
			/>
		</Field>
	{/if}

	{#if styleHasOutline(item.style) && resolved.stroke}
		{@const stroke = resolved.stroke}
		<Field label="Outline color">
			<ColorField
				label="Outline color"
				palette={TEXT_COLORS}
				value={stroke.color}
				onchange={(color, key) => change({ outline: { ...stroke, color } }, key)}
			/>
		</Field>
		<Field label="Outline thickness">
			<Slider
				label="Outline thickness"
				min={0}
				max={0.4}
				step={0.01}
				value={stroke.width}
				format={(v) => (v === 0 ? 'None' : `${Math.round(v * 100)}%`)}
				oninput={(width) => change({ outline: { ...stroke, width } }, `outline-width:${item.id}`)}
			/>
		</Field>
	{/if}

	{#if item.colors}
		<button type="button" class="link" onclick={() => editor.setTextColors(item.id, undefined)}>
			Reset colors
		</button>
	{/if}
</section>

<style>
	.colors {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: 100%;
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
