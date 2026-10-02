<!--
	@component
	An item's keyframes as small red diamonds in a thin strip along the bottom of its card in the
	storyboard (layers, words, and scene cards with Custom framing), clear of the item's name. Every
	keyframe has the same diamond; its easing is in the tooltip ("0:02.40 · Ease in and out") and
	the right-click menu, and on the selected item a faint line between keyframes draws it
	(straight, curved, stepped or wavy).

	Click: select it (the nearest one, when several overlap) and go there. Shift-click: add to or
	take from the selection. Drag: move the selected keyframes in time, snapping to the playhead,
	other keyframes, item edges and scene boundaries (Alt: no snapping). Right-click: easing
	presets, Edit curve…, Copy, Delete.
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
	import { Snapper, toFrame } from './snap';
	import { frameBatch } from '$lib/ui/frameBatch';
	import { portal } from '$lib/ui/portal';
	import type { LaneServices } from './lanes';
	import { easingPath } from './easingPath';

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

	/** The kind of easing (for tests and styling hooks; every keyframe looks the same). */
	function kind(e: Easing): string {
		const name = easingPreset(e);
		if (name === 'linear') return 'linear';
		if (name === 'hold' || name === 'overshoot' || name === 'bounce') return name;
		return 'eased';
	}

	function easingName(e: Easing): string {
		const n = easingPreset(e);
		return n === 'custom' ? 'Custom curve' : EASING_LABELS[n];
	}

	/** Half a diamond's width: markers at an item's very start or end are kept fully inside it. */
	const HALF = 7;
	/** Where a marker at time `t` is drawn (inside the item, however close to its edges). */
	const drawnX = (t: number) => Math.max(HALF, Math.min(width - HALF, xOf(t)));
	/** The strip's height and the line's low and high points in it. */
	const STRIP = 12;

	/** On the selected item: the easing between each keyframe and the next, as a faint line. */
	const curves = $derived.by(() => {
		if (editor.selectedId !== itemId || markers.length < 2) return [];
		const sorted = [...markers].sort((a, b) => a.t - b.t);
		return sorted.slice(0, -1).map((m, i) => ({
			id: m.k.id,
			d: easingPath(m.k.easing, drawnX(m.t), drawnX(sorted[i + 1].t), STRIP - 3, 3)
		}));
	});

	let strip = $state<HTMLDivElement>();

	/** The marker nearest to the pointer (several can overlap when zoomed out). */
	function nearestAt(clientX: number, fallback: { id: string; t: number }) {
		if (!strip) return fallback;
		const px = clientX - strip.getBoundingClientRect().left;
		let best = fallback;
		let dist = Infinity;
		for (const m of markers) {
			const d = Math.abs(drawnX(m.t) - px);
			if (d < dist) {
				dist = d;
				best = { id: m.k.id, t: m.t };
			}
		}
		return best;
	}

	const drags = new DragScope();
	onDestroy(() => {
		drags.dispose();
		if (editor.keyframeDragDelta !== null) editor.keyframeDragDelta = null;
	});

	function onpointerdown(event: PointerEvent, clickedId: string, clickedT: number) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const { id, t } = nearestAt(event.clientX, { id: clickedId, t: clickedT });
		if (editor.selectedId !== itemId) editor.select(itemId);
		const ref = { itemId, id };
		if (event.shiftKey) {
			editor.toggleKeyframeSelected(ref);
			return;
		}
		if (!editor.isKeyframeSelected(itemId, id)) editor.selectKeyframes([ref]);
		const x0 = event.clientX;
		let moved = false;
		const snapper = new Snapper();
		const fps = editor.project.format.fps;
		// Applied once per animation frame; the keyframes move once, at the end.
		const batch = frameBatch((e: PointerEvent) => {
			const dx = e.clientX - x0;
			if (!moved && Math.abs(dx) < 3) return;
			moved = true;
			const x = xOf(t) + dx;
			// Whole frames, unless snapped onto a target.
			const at = toFrame(tOf(x), fps);
			const targets = e.altKey
				? []
				: [...(services?.snapTargets([]) ?? [0, editor.duration, editor.time]), ...editor.keyframeTimes(editor.selectedKeyframes)];
			const s = snapper.snap([at], targets, xOf, e.altKey);
			editor.keyframeDragDelta = at + s.shift - t;
			snapLine = s.target;
		});
		drags.start(event, {
			move: (e) => batch.push(e),
			end: () => {
				batch.flush();
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

<!-- The strip along the bottom of the item: the easing lines (selected item) and the diamonds. -->
<div class="kf-strip" bind:this={strip} style:height="{STRIP}px">
	{#if curves.length}
		<svg class="kf-curves" {width} height={STRIP} aria-hidden="true" data-testid="keyframe-curves">
			{#each curves as c (c.id)}
				<path d={c.d} data-curve-from={c.id} />
			{/each}
		</svg>
	{/if}
	{#each markers as m (m.k.id)}
		{@const selected = editor.isKeyframeSelected(itemId, m.k.id)}
		{@const t = m.t + (selected && editor.keyframeDragDelta !== null ? editor.keyframeDragDelta : 0)}
		{@const x = xOf(t)}
		{#if x >= -6 && x <= width + 6}
			<span
				class="kf"
				class:selected
				style:left="{drawnX(t)}px"
				role="button"
				tabindex="-1"
				title="{editor.formatTime(t)} · {easingName(m.k.easing)}"
				aria-label="Keyframe at {t.toFixed(2)} s, {easingName(m.k.easing).toLowerCase()}"
				aria-pressed={selected}
				data-keyframe={m.k.id}
				data-keyframe-item={itemId}
				data-easing={kind(m.k.easing)}
				onpointerdown={(e) => onpointerdown(e, m.k.id, m.t)}
				oncontextmenu={(e) => oncontextmenu(e, m.k.id)}
			></span>
		{/if}
	{/each}
</div>
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
	/* A thin strip along the item's bottom edge (the item keeps room for it: see TrackLane). */
	.kf-strip {
		position: absolute;
		z-index: 4;
		left: 0;
		right: 0;
		bottom: 1px;
		pointer-events: none;
	}
	.kf-curves {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
	.kf-curves path {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 1.25;
		opacity: 0.45;
	}
	/* Every keyframe: a red diamond with a thin white edge, readable on any item. */
	.kf {
		position: absolute;
		top: 50%;
		z-index: 1;
		width: 14px;
		height: 14px;
		translate: -50% -50%;
		cursor: ew-resize;
		touch-action: none;
		pointer-events: auto;
	}
	.kf::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 7px;
		height: 7px;
		translate: -50% -50%;
		rotate: 45deg;
		border-radius: 1px;
		background: var(--color-accent);
		box-shadow: 0 0 0 1.25px #fff;
		transition: scale var(--dur-fast) var(--ease-out);
	}
	/* Selected: a little larger, a thicker white edge and a soft shadow. */
	.kf.selected {
		z-index: 2;
	}
	.kf.selected::after {
		scale: 1.2;
		box-shadow:
			0 0 0 2px #fff,
			0 1px 3px rgb(0 0 0 / 0.45);
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
