<!--
	@component
	An item's keyframes as small markers on its card in the storyboard (layers, words, and scene
	cards with Custom framing). Their shape shows the easing that starts there, like Premiere:
	a diamond for Linear, a round mark for eased curves, a square for Hold, a triangle for
	Overshoot and a ring for Bounce.

	Click: select it (and its item) and go there. Shift-click: add to or take from the selection.
	Drag: move the selected keyframes in time, snapping to the playhead, other keyframes, item
	edges and scene boundaries (Alt: no snapping). Right-click: easing presets, Edit curve…, Copy,
	Copy, Delete.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		EASINGS,
		EASING_LABELS,
		easingPreset,
		type Easing,
		type EasingPreset
	} from '$lib/model/keyframes';
	import { useEditor } from '$lib/state/context';
	import { DragScope } from '$lib/ui/drag';
	import { Menu, type MenuItem } from '$lib/ui';
	import CurveEditor from './CurveEditor.svelte';
	import { portal } from '$lib/ui/portal';
	import type { LaneServices } from './lanes';

	interface Props {
		itemId: string;
		/** Where a timeline time is, in pixels from the item's left edge. */
		xOf: (t: number) => number;
		/** The timeline time at `px` pixels from the item's left edge (the inverse of `xOf`). */
		tOf: (px: number) => number;
		services?: LaneServices;
		/** The item's width in pixels (markers outside it aren't shown). */
		width: number;
	}

	let { itemId, xOf, tOf, services, width }: Props = $props();

	const editor = useEditor();
	const track = $derived(editor.keyframeTrack(itemId));
	const markers = $derived(
		track
			? track.list
					.map((k) => ({ k, t: track.toTimeline(k.time) }))
					.filter((m) => m.t >= track.start - 1e-6 && m.t <= track.end + 1e-6)
			: []
	);

	function shape(e: Easing): string {
		const name = easingPreset(e);
		if (name === 'linear') return 'linear';
		if (name === 'hold' || name === 'overshoot' || name === 'bounce') return name;
		return 'eased';
	}

	const drags = new DragScope();
	onDestroy(() => {
		drags.dispose();
		if (editor.keyframeDragDelta !== null) editor.keyframeDragDelta = null;
	});
	const SNAP_PX = 8;

	function onpointerdown(event: PointerEvent, id: string, t: number) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (editor.selectedId !== itemId) editor.select(itemId);
		const ref = { itemId, id };
		if (event.shiftKey) {
			editor.toggleKeyframeSelected(ref);
			return;
		}
		if (!editor.isKeyframeSelected(itemId, id)) editor.selectKeyframes([ref]);
		const x0 = event.clientX;
		let moved = false;
		drags.start(event, {
			move: (e) => {
				const dx = e.clientX - x0;
				if (!moved && Math.abs(dx) < 3) return;
				moved = true;
				const x = xOf(t) + dx;
				let delta = tOf(x) - t;
				let snapped: number | null = null;
				if (!e.altKey) {
					const targets = [
						...(services?.snapTargets([]) ?? [0, editor.duration, editor.time]),
						...editor.keyframeTimes(editor.selectedKeyframes)
					];
					let best = SNAP_PX;
					for (const target of targets) {
						const d = Math.abs(xOf(target) - x);
						if (d < best) {
							best = d;
							snapped = target;
						}
					}
					if (snapped !== null) delta = snapped - t;
				}
				editor.keyframeDragDelta = delta;
				snapLine = snapped;
			},
			end: () => {
				const delta = editor.keyframeDragDelta;
				editor.keyframeDragDelta = null;
				snapLine = null;
				if (moved && delta !== null) {
					editor.moveSelectedKeyframes(delta);
					editor.seek(Math.max(0, Math.min(editor.duration, t + delta)));
				} else editor.seek(t);
			}
		});
	}

	/** Where the dragged keyframe snapped (a timeline time), for a line across the item. */
	let snapLine = $state<number | null>(null);

	// ─── Right-click menu and the curve editor ─────────────────────────────────────────────
	let menu = $state<{ anchor: HTMLElement } | null>(null);
	let curve = $state<{ x: number; y: number } | null>(null);
	/** About how tall the curve editor popover is. */
	const CURVE_H = 360;
	const firstSelected = $derived(
		editor.selectedKeyframes.length
			? track?.list.find((k) => editor.isKeyframeSelected(itemId, k.id))
			: undefined
	);

	function oncontextmenu(event: MouseEvent, id: string) {
		event.preventDefault();
		event.stopPropagation();
		if (editor.selectedId !== itemId) editor.select(itemId);
		if (!editor.isKeyframeSelected(itemId, id)) editor.selectKeyframes([{ itemId, id }]);
		menu = { anchor: event.currentTarget as HTMLElement };
	}

	const presets: EasingPreset[] = [
		'linear',
		'ease-in',
		'ease-out',
		'ease-in-out',
		'hold',
		'overshoot',
		'bounce'
	];
	/** The menu's items (they keep the anchor: the menu closes before an item runs). */
	function menuItems(anchor: HTMLElement): MenuItem[] {
		return [
			...presets.map((p) => ({
				label: `${firstSelected && easingPreset(firstSelected.easing) === p ? '✓ ' : ''}${EASING_LABELS[p]}`,
				onselect: () => editor.setSelectedKeyframesEasing(EASINGS[p])
			})),
			{
				label: 'Edit curve…',
				separator: true,
				onselect: () => {
					const r = anchor.getBoundingClientRect();
					// Below the marker, or above it when there isn't room (the storyboard is low).
					const above = r.bottom + CURVE_H + 16 > innerHeight;
					const x = Math.min(innerWidth - 130, Math.max(130, r.left + r.width / 2));
					curve = { x, y: above ? Math.max(8, r.top - CURVE_H - 8) : r.bottom + 8 };
				}
			},
			{
				label: 'Copy',
				shortcut: navigator.platform.includes('Mac') ? '⌘C' : 'Ctrl+C',
				onselect: () => void editor.copyKeyframes()
			},
			{ label: 'Delete', shortcut: '⌫', onselect: () => editor.deleteSelectedKeyframes() }
		];
	}

	function onWindowPointerDown(event: PointerEvent) {
		if (curve && !(event.target as Element).closest('.curve-popover')) curve = null;
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#each markers as m (m.k.id)}
	{@const selected = editor.isKeyframeSelected(itemId, m.k.id)}
	{@const t = m.t + (selected && editor.keyframeDragDelta !== null ? editor.keyframeDragDelta : 0)}
	{@const x = xOf(t)}
	{#if x >= -6 && x <= width + 6}
		<span
			class="kf {shape(m.k.easing)}"
			class:selected
			style:left="{x}px"
			role="button"
			tabindex="-1"
			aria-label="Keyframe at {t.toFixed(2)} s, {(() => {
				const n = easingPreset(m.k.easing);
				return n === 'custom' ? 'custom curve' : EASING_LABELS[n];
			})()}"
			aria-pressed={selected}
			data-keyframe={m.k.id}
			data-keyframe-item={itemId}
			data-easing={shape(m.k.easing)}
			onpointerdown={(e) => onpointerdown(e, m.k.id, m.t)}
			oncontextmenu={(e) => oncontextmenu(e, m.k.id)}
		></span>
	{/if}
{/each}
{#if snapLine !== null}
	<span class="kf-snap" style:left="{xOf(snapLine)}px" aria-hidden="true"></span>
{/if}

{#if menu}
	<div use:portal>
		<Menu
			label="Keyframe"
			items={menuItems(menu.anchor)}
			anchor={menu.anchor}
			onclose={() => (menu = null)}
		/>
	</div>
{/if}
{#if curve && firstSelected}
	<div
		use:portal
		class="curve-popover"
		role="dialog"
		aria-label="Easing curve"
		style:left="{curve.x}px"
		style:top="{curve.y}px"
	>
		<CurveEditor
			easing={firstSelected.easing}
			onchange={(e, key) => editor.setSelectedKeyframesEasing(e, key)}
			defaultEasing={editor.defaultEasing}
			onsetdefault={(p) => editor.setDefaultEasing(p)}
		/>
	</div>
{/if}

<style>
	.kf {
		position: absolute;
		top: 50%;
		z-index: 4;
		width: 11px;
		height: 11px;
		translate: -50% -50%;
		cursor: ew-resize;
		touch-action: none;
	}
	/* The mark itself, drawn with a white fill and a dark outline so it shows on any picture. */
	.kf::after {
		content: '';
		position: absolute;
		inset: 1px;
		background: var(--color-bg);
		box-shadow: 0 0 0 1.25px var(--color-ink);
	}
	.kf.linear::after {
		inset: 2px;
		rotate: 45deg;
	}
	.kf.eased::after {
		border-radius: 50%;
	}
	.kf.hold::after {
		inset: 1.5px;
		border-radius: 1px;
	}
	/* A triangle (pointing past the target), white with a dark edge like the others. */
	.kf.overshoot {
		filter: drop-shadow(0 0 0.8px var(--color-ink)) drop-shadow(0 0 0.4px var(--color-ink));
	}
	.kf.overshoot::after {
		inset: 0;
		box-shadow: none;
		background: var(--color-bg);
		clip-path: polygon(50% 0, 100% 100%, 0 100%);
	}
	.kf.bounce::after {
		border-radius: 50%;
		background: transparent;
		box-shadow:
			0 0 0 1.25px var(--color-ink),
			inset 0 0 0 2px var(--color-bg),
			inset 0 0 0 10px var(--color-ink);
	}
	.kf.selected::after {
		background: var(--color-accent);
		box-shadow: 0 0 0 1.25px var(--color-accent);
	}
	.kf.overshoot.selected::after {
		background: var(--color-accent);
	}
	.kf-snap {
		position: absolute;
		top: -2px;
		bottom: -2px;
		width: 1px;
		background: var(--color-ink);
		opacity: 0.6;
		pointer-events: none;
		z-index: 3;
	}
	.curve-popover {
		position: fixed;
		z-index: 70;
		translate: -50% 0;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		box-shadow: var(--shadow-float);
	}
</style>
