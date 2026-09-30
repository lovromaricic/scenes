<!--
	@component
	A layer's look: corners, border (colour and thickness), shadow and opacity. Used in the right
	column and in the Style popover on the preview.
-->
<script lang="ts">
	import { ChipGroup, Field, Slider } from '$lib/ui';
	import type { Overlay, OverlayShadow, OverlayStyle } from '$lib/model/overlay';
	import { useEditor } from '$lib/state/context';
	import ColorField from './ColorField.svelte';

	let { overlay }: { overlay: Overlay } = $props();

	const editor = useEditor();
	const style = $derived(overlay.style);

	function set(change: Partial<OverlayStyle>, key?: string) {
		editor.setOverlayStyle(overlay.id, { ...style, ...change }, key);
	}

	const shadows: { value: OverlayShadow; label: string }[] = [
		{ value: 'off', label: 'Off' },
		{ value: 'soft', label: 'Soft' },
		{ value: 'strong', label: 'Strong' }
	];
</script>

<div class="fields">
	<Field label="Corners">
		<Slider
			label="Corner radius"
			value={style.radius}
			format={(v) => (v === 0 ? 'Square' : v >= 1 ? 'Round' : `${Math.round(v * 100)}%`)}
			oninput={(v) => set({ radius: v }, `radius:${overlay.id}`)}
		/>
	</Field>
	<Field label="Border">
		<Slider
			label="Border thickness"
			value={style.borderWidth}
			min={0}
			max={40}
			step={1}
			format={(v) => (v === 0 ? 'None' : `${v} px`)}
			oninput={(v) => set({ borderWidth: v }, `border:${overlay.id}`)}
		/>
		{#if style.borderWidth > 0}
			<ColorField
				label="Border color"
				value={style.borderColor}
				onchange={(hex, key) => set({ borderColor: hex }, key ?? `border-color:${overlay.id}`)}
			/>
		{/if}
	</Field>
	<Field label="Shadow">
		<ChipGroup
			label="Shadow"
			size="sm"
			options={shadows}
			value={style.shadow}
			onchange={(v: OverlayShadow) => set({ shadow: v })}
		/>
	</Field>
	<Field label="Opacity">
		<Slider
			label="Layer opacity"
			value={style.opacity}
			min={0.05}
			oninput={(v) => set({ opacity: v }, `opacity:${overlay.id}`)}
		/>
	</Field>
</div>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
