<!--
	@component
	Project format: the video's shape, size and frame rate. Changes apply straight away and can be
	undone.
-->
<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import { ChipGroup, IconButton } from '$lib/ui';
	import {
		clampCustom,
		FORMAT_PRESETS,
		FRAME_RATES,
		MAX_SIDE,
		MIN_SIDE,
		RESOLUTIONS,
		resolutionOf,
		shortSide,
		sizeFor,
		type FormatPresetId,
		type FrameRate
	} from '$lib/model/format';
	import { useEditor } from '$lib/state/context';

	interface Props {
		/** Viewport position to hang the panel from (below the top-bar button). */
		x: number;
		y: number;
		onclose: () => void;
	}

	let { x, y, onclose }: Props = $props();

	const editor = useEditor();
	const format = $derived(editor.project.format);
	const resolution = $derived(resolutionOf(format));

	let panel: HTMLDivElement;
	let customW = $state(0);
	let customH = $state(0);

	$effect.pre(() => {
		customW = format.width;
		customH = format.height;
	});

	onMount(() => {
		panel.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
	});

	/** Snap the current short side to a standard resolution, for switching between presets. */
	function currentResolution(): number {
		if (resolution) return resolution;
		const s = shortSide(format);
		return s >= 2160 ? 2160 : s >= 1080 ? 1080 : 720;
	}

	function pickShape(id: FormatPresetId | 'custom') {
		if (id === 'custom') {
			editor.setFormat({ ...format, preset: 'custom' });
			return;
		}
		editor.setFormat({ ...format, preset: id, ...sizeFor(id, currentResolution()) });
	}

	function pickResolution(side: number) {
		if (format.preset === 'custom') return;
		editor.setFormat({ ...format, ...sizeFor(format.preset, side) });
	}

	function commitCustom() {
		const size = clampCustom(customW, customH);
		customW = size.width;
		customH = size.height;
		editor.setFormat({ ...format, preset: 'custom', ...size });
	}

	const shapes = $derived([
		...FORMAT_PRESETS.map((p) => ({ ...p, id: p.id as FormatPresetId | 'custom' })),
		{
			id: 'custom' as const,
			label: 'Custom',
			ratio: [format.width, format.height] as [number, number],
			hint: 'Any size'
		}
	]);

	function onkeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
			return;
		}
		const target = event.target as HTMLElement;
		if (!target.matches('.shape[role="radio"]')) return;
		const keys: Record<string, number> = {
			ArrowRight: 1,
			ArrowDown: 1,
			ArrowLeft: -1,
			ArrowUp: -1
		};
		if (!(event.key in keys)) return;
		event.preventDefault();
		const all = [...panel.querySelectorAll<HTMLButtonElement>('.shape[role="radio"]')];
		const next =
			all[(all.indexOf(target as HTMLButtonElement) + keys[event.key] + all.length) % all.length];
		next.focus();
		next.click();
	}

	function onWindowPointerDown(event: PointerEvent) {
		const target = event.target as HTMLElement;
		if (!panel.contains(target) && !target.closest('[data-format-button]')) onclose();
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div
	bind:this={panel}
	class="panel"
	style:left="{Math.max(12, x)}px"
	style:top="{y + 8}px"
	role="dialog"
	aria-label="Project format"
	tabindex="-1"
	{onkeydown}
>
	<header>
		<h2 class="serif">Project format</h2>
		<IconButton label="Close" icon={X} size="sm" onclick={onclose} />
	</header>

	<div class="shapes" role="radiogroup" aria-label="Shape">
		{#each shapes as shape (shape.id)}
			{@const checked = format.preset === shape.id}
			{@const r =
				shape.id === 'custom' ? format.width / format.height : shape.ratio[0] / shape.ratio[1]}
			<button
				type="button"
				role="radio"
				aria-checked={checked}
				tabindex={checked ? 0 : -1}
				class="shape"
				class:checked
				onclick={() => pickShape(shape.id)}
			>
				<span class="frame-box" aria-hidden="true">
					<span class="frame" class:custom={shape.id === 'custom'} style:--r={r}></span>
				</span>
				<span class="name">
					{shape.label}
					{#if shape.id !== 'custom'}<span class="ratio mono"
							>{shape.ratio[0]}:{shape.ratio[1]}</span
						>{/if}
				</span>
				<span class="hint">{shape.hint}</span>
			</button>
		{/each}
	</div>

	{#if format.preset === 'custom'}
		<div class="row">
			<span class="label">Size</span>
			<div class="custom">
				<label>
					<span class="visually-hidden">Width</span>
					<input
						type="number"
						aria-label="Width"
						min={MIN_SIDE}
						max={MAX_SIDE}
						step="2"
						bind:value={customW}
						onchange={commitCustom}
						onkeydown={(e) => e.key === 'Enter' && commitCustom()}
					/>
				</label>
				<span aria-hidden="true">×</span>
				<label>
					<span class="visually-hidden">Height</span>
					<input
						type="number"
						aria-label="Height"
						min={MIN_SIDE}
						max={MAX_SIDE}
						step="2"
						bind:value={customH}
						onchange={commitCustom}
						onkeydown={(e) => e.key === 'Enter' && commitCustom()}
					/>
				</label>
				<span class="unit">px</span>
			</div>
			<p class="note">Even numbers from {MIN_SIDE} to {MAX_SIDE}.</p>
		</div>
	{:else}
		<div class="row">
			<span class="label">Size</span>
			<ChipGroup
				label="Size"
				size="sm"
				options={RESOLUTIONS.map((r) => ({ value: r.shortSide as number, label: r.label }))}
				value={resolution ?? 0}
				onchange={pickResolution}
			/>
			<p class="note mono">{format.width} × {format.height}</p>
		</div>
	{/if}

	<div class="row">
		<span class="label">Frame rate</span>
		<ChipGroup
			label="Frame rate"
			size="sm"
			options={FRAME_RATES.map((f) => ({ value: f, label: `${f} fps` }))}
			value={format.fps}
			onchange={(fps: FrameRate) => editor.setFormat({ ...format, fps })}
		/>
	</div>
</div>

<style>
	.panel {
		position: fixed;
		z-index: 70;
		width: 440px;
		max-width: calc(100vw - 24px);
		padding: var(--space-5);
		border-radius: var(--radius-card-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-float);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		animation: pop-in var(--dur-fast) var(--ease-out);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h2 {
		font-size: var(--text-heading);
		line-height: 1;
	}
	.shapes {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-2);
	}
	.shape {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--space-2) var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		text-align: center;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out);
	}
	.shape:hover {
		border-color: var(--color-muted);
	}
	.shape.checked {
		border-color: var(--color-ink);
		background: var(--color-surface);
	}
	.frame-box {
		display: grid;
		place-items: center;
		width: 44px;
		height: 40px;
		margin-bottom: 4px;
	}
	/* The shape, drawn to fit a 44×40 box. */
	.frame {
		width: min(44px, calc(40px * var(--r)));
		height: min(40px, calc(44px / var(--r)));
		border: 1.5px solid var(--color-ink);
		border-radius: 4px;
	}
	.checked .frame {
		background: var(--color-ink);
	}
	.frame.custom {
		border-style: dashed;
	}
	.name {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		line-height: 1.2;
	}
	.ratio {
		display: block;
		font-size: var(--text-xs);
		font-weight: var(--weight-regular);
		color: var(--color-muted);
	}
	.hint {
		font-size: 11px;
		color: var(--color-muted);
		line-height: 1.2;
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.note {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.custom {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.custom input {
		width: 96px;
		height: 36px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
	}
	.custom input:focus-visible {
		border-color: var(--color-ink);
		box-shadow: none;
	}
	.unit {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	@keyframes pop-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
