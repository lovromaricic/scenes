<!--
	@component
	The words' shadow: on or off, and (when on) its colour, opacity, blur, distance and angle, with
	quick presets. The style gives the starting shadow; changing it overrides it, and "Reset
	shadow" goes back to the style's own. Sizes are kept relative to the font size (so the shadow
	looks the same on small and very large words) and shown in pixels at the words' current size.
-->
<script lang="ts">
	import { ChipGroup, Field, Slider, Switch } from '$lib/ui';
	import {
		resolveTextStyle,
		SHADOW_PRESET_LABELS,
		SHADOW_PRESETS,
		shadowPreset,
		TEXT_COLORS,
		type ShadowPreset,
		type TextShadow
	} from '$lib/model/textStyle';
	import { shortSide } from '$lib/model/format';
	import type { TextItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import { DragScope } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';
	import ColorField from './ColorField.svelte';

	let { item }: { item: TextItem } = $props();

	const editor = useEditor();
	const shadow = $derived(resolveTextStyle(item).shadow);
	/** The words' font size in project pixels: shadow sizes are shown at it. */
	const fontPx = $derived(resolveTextStyle(item).size * shortSide(editor.project.format));
	const preset = $derived(shadowPreset(shadow));

	function change(patch: Partial<TextShadow>, key?: string) {
		editor.setTextShadow(item.id, { ...shadow, ...patch }, key);
	}

	/** Pixels at the current size → a fraction of the font size. */
	const fraction = (px: number) => Math.max(0, px) / Math.max(1, fontPx);
	const px = (fraction: number) => fraction * fontPx;

	const presetOptions = (Object.keys(SHADOW_PRESETS) as ShadowPreset[]).map((p) => ({
		value: p,
		label: SHADOW_PRESET_LABELS[p]
	}));

	// ─── The angle dial ─────────────────────────────────────────────────────────────────────
	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	const tidyAngle = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

	function ondialdown(event: PointerEvent) {
		if (event.button !== 0) return;
		event.preventDefault();
		const dial = event.currentTarget as HTMLElement;
		dial.focus();
		const at = (e: PointerEvent) => {
			const r = dial.getBoundingClientRect();
			let deg =
				(Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) /
				Math.PI;
			if (e.shiftKey) deg = Math.round(deg / 15) * 15;
			change({ angle: tidyAngle(deg) }, `shadow-angle:${item.id}`);
		};
		at(event);
		drags.start(event, { move: at, end: () => {} });
	}

	function ondialkey(event: KeyboardEvent) {
		const step = event.shiftKey ? 15 : 1;
		const by: Record<string, number> = {
			ArrowRight: step,
			ArrowUp: -step,
			ArrowLeft: -step,
			ArrowDown: step
		};
		if (!(event.key in by)) return;
		event.preventDefault();
		change({ angle: tidyAngle(shadow.angle + by[event.key]) }, `shadow-angle:${item.id}`);
	}

	function setAngle(value: string) {
		const n = Number(value);
		if (value.trim() !== '' && Number.isFinite(n))
			change({ angle: tidyAngle(n) }, `shadow-angle:${item.id}`);
	}
</script>

<section class="shadow" aria-label="Shadow">
	<Switch label="Shadow" checked={shadow.on} onchange={(on) => change({ on })} />

	{#if shadow.on}
		<ChipGroup
			label="Shadow preset"
			size="sm"
			options={presetOptions}
			value={preset ?? ('' as ShadowPreset)}
			onchange={(p: ShadowPreset) => change({ ...SHADOW_PRESETS[p], on: true })}
		/>

		<Field label="Shadow color">
			<ColorField
				label="Shadow color"
				palette={TEXT_COLORS}
				value={shadow.color}
				opacity={shadow.opacity}
				onchange={(color, key) => change({ color }, key)}
				onopacity={(opacity, key) => change({ opacity }, key)}
			/>
		</Field>

		<Field label="Blur">
			<Slider
				label="Shadow blur"
				min={0}
				max={Math.max(100, Math.ceil(px(shadow.blur)))}
				step={1}
				value={px(shadow.blur)}
				format={(v) => `${Math.round(v)} px`}
				oninput={(v) => change({ blur: fraction(v) }, `shadow-blur:${item.id}`)}
			/>
		</Field>

		<Field label="Distance">
			<Slider
				label="Shadow distance"
				min={0}
				max={Math.max(100, Math.ceil(px(shadow.distance)))}
				step={1}
				value={px(shadow.distance)}
				format={(v) => `${Math.round(v)} px`}
				oninput={(v) => change({ distance: fraction(v) }, `shadow-distance:${item.id}`)}
			/>
		</Field>

		<Field label="Angle">
			<div class="angle">
				<span
					class="dial"
					role="slider"
					tabindex="0"
					aria-label="Shadow angle dial"
					aria-valuemin={0}
					aria-valuemax={359}
					aria-valuenow={Math.round(shadow.angle)}
					aria-valuetext="{Math.round(shadow.angle)}°"
					title="Drag to point the shadow (Shift: 15° steps)"
					onpointerdown={ondialdown}
					onkeydown={ondialkey}
				>
					<span class="hand" style:rotate="{shadow.angle}deg"></span>
				</span>
				<label class="num">
					<input
						type="number"
						aria-label="Shadow angle"
						min="0"
						max="360"
						step="1"
						value={Math.round(shadow.angle)}
						oninput={(e) => setAngle(e.currentTarget.value)}
					/>°
				</label>
			</div>
		</Field>
	{/if}

	{#if item.shadow}
		<button type="button" class="link" onclick={() => editor.setTextShadow(item.id, undefined)}>
			Reset shadow
		</button>
	{/if}
</section>

<style>
	.shadow {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: 100%;
	}
	.angle {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.dial {
		position: relative;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-border);
		cursor: grab;
		touch-action: none;
		flex: none;
	}
	.dial:focus-visible {
		box-shadow:
			inset 0 0 0 1px var(--color-border),
			var(--focus-ring);
		outline: none;
	}
	/* A hand from the centre towards where the shadow falls. */
	.hand {
		position: absolute;
		left: 50%;
		top: calc(50% - 1px);
		width: 16px;
		height: 2px;
		border-radius: 1px;
		background: var(--color-ink);
		transform-origin: 0 50%;
	}
	.hand::after {
		content: '';
		position: absolute;
		right: -3px;
		top: -2px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-ink);
	}
	.num {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-sm);
		color: var(--color-muted);
	}
	input {
		width: 64px;
		height: 32px;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--color-ink);
	}
	input:focus-visible {
		border-color: var(--color-ink);
		box-shadow: none;
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
