<!--
	@component
	The easing of one stretch between keyframes (or several at once): the presets, and the curve
	with two handles to drag (for the cubic-bezier ones). Shows the preset's name when the curve is
	one, otherwise "Custom". Hold, Overshoot and Bounce are fixed shapes, drawn but not editable.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		EASINGS,
		EASING_LABELS,
		ease,
		easingPreset,
		type Easing,
		type EasingPreset
	} from '$lib/model/keyframes';
	import { DragScope } from '$lib/ui/drag';

	interface Props {
		easing: Easing;
		onchange: (easing: Easing, key?: string) => void;
		/** Presets offered (volume points have fewer). */
		presets?: EasingPreset[];
		/** The default for new keyframes, and a way to change it. */
		defaultEasing?: EasingPreset;
		onsetdefault?: (preset: EasingPreset) => void;
	}

	let {
		easing,
		onchange,
		presets = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'overshoot', 'bounce'],
		defaultEasing,
		onsetdefault
	}: Props = $props();

	const SIZE = 168;
	/** Room above and below the 0–1 box, for handles and overshoot. */
	const PAD = 36;
	const H = SIZE + PAD * 2;
	const name = $derived(easingPreset(easing));
	const label = $derived(name === 'custom' ? 'Custom' : EASING_LABELS[name]);

	const sx = (x: number) => x * SIZE;
	const sy = (y: number) => PAD + (1 - y) * SIZE;

	const path = $derived.by(() => {
		const points: string[] = [];
		for (let i = 0; i <= 64; i++) {
			const p = i / 64;
			points.push(`${sx(p).toFixed(1)},${sy(easing.kind === 'hold' && i === 64 ? 1 : ease(easing, p)).toFixed(1)}`);
		}
		// Hold: a step at the end.
		if (easing.kind === 'hold') points.splice(64, 0, `${sx(1)},${sy(0)}`);
		return `M${points.join(' L')}`;
	});

	const bez = $derived(easing.kind === 'bezier' ? easing : null);

	let svg = $state<SVGSVGElement>();
	const drags = new DragScope();
	onDestroy(() => drags.dispose());

	function onhandle(event: PointerEvent, which: 1 | 2) {
		if (!bez || event.button !== 0) return;
		event.preventDefault();
		const key = `curve:${Math.random()}`;
		drags.start(event, {
			move: (e) => {
				if (!svg || !bez) return;
				const r = svg.getBoundingClientRect();
				const x = Math.min(1, Math.max(0, (e.clientX - r.left) / SIZE));
				const y = Math.min(1.6, Math.max(-0.6, 1 - (e.clientY - r.top - PAD) / SIZE));
				const round = (v: number) => Math.round(v * 100) / 100;
				onchange(
					which === 1 ? { ...bez, x1: round(x), y1: round(y) } : { ...bez, x2: round(x), y2: round(y) },
					key
				);
			},
			end: () => {}
		});
	}

	function onhandlekey(event: KeyboardEvent, which: 1 | 2) {
		if (!bez) return;
		const step = event.shiftKey ? 0.1 : 0.01;
		const d: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, step],
			ArrowDown: [0, -step]
		};
		const m = d[event.key];
		if (!m) return;
		event.preventDefault();
		event.stopPropagation();
		const r = (v: number) => Math.round(v * 100) / 100;
		const clampX = (v: number) => Math.min(1, Math.max(0, v));
		onchange(
			which === 1
				? { ...bez, x1: r(clampX(bez.x1 + m[0])), y1: r(bez.y1 + m[1]) }
				: { ...bez, x2: r(clampX(bez.x2 + m[0])), y2: r(bez.y2 + m[1]) },
			`curve-key:${which}`
		);
	}
</script>

<div class="curve-editor">
	<div class="head">
		<span class="name" data-testid="easing-name">{label}</span>
	</div>
	<svg
		bind:this={svg}
		width={SIZE}
		height={H}
		viewBox="0 0 {SIZE} {H}"
		role="img"
		aria-label="Easing curve: {label}"
		data-testid="easing-curve"
	>
		<rect class="box" x="0" y={PAD} width={SIZE} height={SIZE} />
		<path class="curve" d={path} />
		{#if bez}
			<line class="arm" x1={sx(0)} y1={sy(0)} x2={sx(bez.x1)} y2={sy(bez.y1)} />
			<line class="arm" x1={sx(1)} y1={sy(1)} x2={sx(bez.x2)} y2={sy(bez.y2)} />
			{#each [1, 2] as const as which (which)}
				{@const x = which === 1 ? bez.x1 : bez.x2}
				{@const y = which === 1 ? bez.y1 : bez.y2}
				<circle
					class="handle"
					cx={sx(x)}
					cy={sy(y)}
					r="7"
					role="slider"
					tabindex="0"
					aria-label="Curve handle {which}"
					aria-valuetext="{x.toFixed(2)}, {y.toFixed(2)}"
					aria-valuenow={x}
					data-curve-handle={which}
					onpointerdown={(e) => onhandle(e, which)}
					onkeydown={(e) => onhandlekey(e, which)}
				/>
			{/each}
		{/if}
	</svg>
	<div class="presets" role="radiogroup" aria-label="Easing">
		{#each presets as p (p)}
			<button
				type="button"
				role="radio"
				aria-checked={name === p}
				class="preset"
				onclick={() => onchange(EASINGS[p])}
			>
				{EASING_LABELS[p]}
			</button>
		{/each}
	</div>
	{#if name !== 'custom' && onsetdefault}
		<button
		type="button"
		class="link"
		disabled={defaultEasing === name}
		onclick={() => onsetdefault?.(name)}
		>
		{defaultEasing === name ? 'Default for new keyframes' : 'Use for new keyframes'}
		</button>
	{/if}
</div>

<style>
	.curve-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 196px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
	}
	.name {
		font-weight: var(--weight-medium);
	}
	.link {
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-muted);
		font: inherit;
		font-size: var(--text-xs);
		text-decoration: underline;
		cursor: pointer;
	}
	.link:disabled {
		text-decoration: none;
		cursor: default;
	}
	svg {
		align-self: center;
		overflow: visible;
		touch-action: none;
	}
	.box {
		fill: var(--color-surface);
		stroke: var(--color-border);
	}
	.curve {
		fill: none;
		stroke: var(--color-ink);
		stroke-width: 2;
	}
	.arm {
		stroke: var(--color-muted);
		stroke-width: 1;
	}
	.handle {
		fill: var(--color-bg);
		stroke: var(--color-ink);
		stroke-width: 1.5;
		cursor: grab;
	}
	.handle:focus-visible {
		outline: none;
		stroke: var(--color-accent);
		stroke-width: 2.5;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.preset {
		padding: 3px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-ink);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.preset[aria-checked='true'] {
		border-color: var(--color-ink);
		background: var(--color-ink);
		color: var(--color-on-ink);
	}
</style>
