<!--
	@component
	The volume line ("rubber band") across an audio item in the storyboard: music and voiceovers,
	video layers with their sound on, and video scenes. Click the line to add a point there; drag a
	point up or down for the volume (shown in dB while dragging) and left or right for its time,
	snapping like keyframes (Alt: no snapping). Points are selected, deleted, copied and eased like
	keyframes; right-click one for its easing, Copy or Delete. The line is drawn following the
	easing, so it shows exactly what's heard.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { EASINGS, EASING_LABELS, easingPreset } from '$lib/model/keyframes';
	import { VOLUME_EASINGS, formatDb, gainToLevel, levelToGain } from '$lib/model/volume';
	import { useEditor } from '$lib/state/context';
	import { DragScope } from '$lib/ui/drag';
	import { Menu, type MenuItem } from '$lib/ui';
	import { portal } from '$lib/ui/portal';
	import type { LaneServices } from './lanes';

	interface Props {
		itemId: string;
		width: number;
		height: number;
		/** Where a timeline time is, in pixels from the item's left edge. */
		xOf: (t: number) => number;
		/** The timeline time at `px` pixels from the item's left edge. */
		tOf: (px: number) => number;
		services?: LaneServices;
	}

	let { itemId, width, height, xOf, tOf, services }: Props = $props();

	const editor = useEditor();
	const track = $derived(editor.volumeTrack(itemId));
	const PAD = 3;
	const yOf = (gain: number) => PAD + (1 - gainToLevel(gain)) * (height - 2 * PAD);
	const gainOfY = (y: number) => levelToGain(1 - (y - PAD) / (height - 2 * PAD));

	const line = $derived.by(() => {
		if (!track || width <= 0) return '';
		const pts: string[] = [];
		const steps = Math.max(2, Math.min(240, Math.round(width / 3)));
		for (let i = 0; i <= steps; i++) {
			const x = (width * i) / steps;
			pts.push(`${x.toFixed(1)},${yOf(editor.volumeAtTime(itemId, tOf(x))).toFixed(1)}`);
		}
		return `M${pts.join(' L')}`;
	});
	const points = $derived(
		track
			? track.list
					.map((k) => ({ id: k.id, t: track.toTimeline(k.time), gain: (k.values as { gain: number }).gain, easing: k.easing }))
					.filter((p) => p.t >= track.start - 1e-6 && p.t <= track.end + 1e-6)
			: []
	);

	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	let svg = $state<SVGSVGElement>();
	/** The point being dragged and its value, for the dB label. */
	let dragging = $state<{ id: string; x: number; y: number; gain: number } | null>(null);
	const SNAP_PX = 8;

	function local(e: PointerEvent) {
		const r = svg!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	/** Drag a point: up and down for the volume, left and right for its time. */
	function drag(event: PointerEvent, id: string) {
		const key = `volume:${id}:${Math.random()}`;
		const start = local(event);
		let moved = false;
		drags.start(event, {
			move: (e) => {
				const p = local(e);
				if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 2) return;
				moved = true;
				let x = Math.min(width, Math.max(0, p.x));
				if (!e.altKey) {
					const targets = [
						...(services?.snapTargets([]) ?? [editor.time]),
						...editor.keyframeTimes([{ itemId, id, channel: 'volume' }])
					];
					let best = SNAP_PX;
					for (const target of targets) {
						const d = Math.abs(xOf(target) - x);
						if (d < best) {
							best = d;
							x = xOf(target);
						}
					}
				}
				const gain = gainOfY(Math.min(height - PAD, Math.max(PAD, p.y)));
				dragging = { id, x, y: yOf(gain), gain };
				editor.setVolumePoint(itemId, id, tOf(x), gain, key);
			},
			end: () => {
				dragging = null;
			}
		});
	}

	function onlinedown(event: PointerEvent) {
		if (event.button !== 0 || !track) return;
		event.preventDefault();
		event.stopPropagation();
		if (editor.selectedId !== itemId) editor.select(itemId);
		const p = local(event);
		const t = tOf(p.x);
		const id = editor.addVolumePoint(itemId, t, editor.volumeAtTime(itemId, t));
		if (!id) return;
		editor.selectKeyframes([{ itemId, id, channel: 'volume' }]);
		drag(event, id);
	}

	function onpointdown(event: PointerEvent, id: string) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (editor.selectedId !== itemId) editor.select(itemId);
		const ref = { itemId, id, channel: 'volume' as const };
		if (event.shiftKey) {
			editor.toggleKeyframeSelected(ref);
			return;
		}
		if (!editor.isKeyframeSelected(itemId, id)) editor.selectKeyframes([ref]);
		drag(event, id);
	}

	// ─── Right-click ────────────────────────────────────────────────────────────────────────
	let menu = $state<{ anchor: HTMLElement; id: string } | null>(null);

	function oncontextmenu(event: MouseEvent, id: string) {
		event.preventDefault();
		event.stopPropagation();
		if (editor.selectedId !== itemId) editor.select(itemId);
		if (!editor.isKeyframeSelected(itemId, id)) editor.selectKeyframes([{ itemId, id, channel: 'volume' }]);
		menu = { anchor: event.currentTarget as HTMLElement, id };
	}

	function menuItems(id: string): MenuItem[] {
		const current = points.find((p) => p.id === id);
		const name = current ? easingPreset(current.easing) : null;
		return [
			...VOLUME_EASINGS.map((p) => ({
				label: `${name === p ? '✓ ' : ''}${EASING_LABELS[p]}`,
				onselect: () => editor.setSelectedKeyframesEasing(EASINGS[p])
			})),
			{ label: 'Copy', separator: true, onselect: () => void editor.copyKeyframes() },
			{ label: 'Delete', onselect: () => editor.deleteSelectedKeyframes() }
		];
	}
</script>

{#if track && width > 4}
	<svg
		bind:this={svg}
		class="volume-line"
		class:dragging={!!dragging}
		{width}
		{height}
		viewBox="0 0 {width} {height}"
		data-volume-line={itemId}
	>
		<path class="line" d={line} />
		<path
			class="hit"
			d={line}
			role="button"
			tabindex="-1"
			aria-label="Volume line: click to add a point"
			onpointerdown={onlinedown}
		/>
		{#each points as p (p.id)}
			{@const selected = editor.isKeyframeSelected(itemId, p.id)}
			{@const x = dragging?.id === p.id ? dragging.x : xOf(p.t)}
			{@const y = dragging?.id === p.id ? dragging.y : yOf(p.gain)}
			<circle
				class="point"
				class:selected
				class:hold={p.easing.kind === 'hold'}
				cx={x}
				cy={y}
				r="4"
				role="button"
				tabindex="-1"
				aria-label="Volume point at {p.t.toFixed(2)} s, {formatDb(p.gain)}"
				aria-pressed={selected}
				data-volume-point={p.id}
				data-gain={p.gain}
				onpointerdown={(e) => onpointdown(e, p.id)}
				oncontextmenu={(e) => oncontextmenu(e, p.id)}
			/>
		{/each}
	</svg>
	{#if dragging}
		<span
			class="db mono"
			data-testid="volume-db"
			style:left="{dragging.x}px"
			style:top="{Math.max(0, dragging.y - 22)}px">{formatDb(dragging.gain)}</span
		>
	{/if}
{/if}

{#if menu}
	<div use:portal>
		<Menu label="Volume point" items={menuItems(menu.id)} anchor={menu.anchor} onclose={() => (menu = null)} />
	</div>
{/if}

<style>
	.volume-line {
		position: absolute;
		left: 0;
		top: 0;
		z-index: 3;
		overflow: visible;
		pointer-events: none;
	}
	.line {
		fill: none;
		stroke: var(--color-ink);
		stroke-width: 1.25;
		opacity: 0.75;
	}
	.hit {
		fill: none;
		stroke: transparent;
		stroke-width: 10;
		pointer-events: stroke;
		cursor: copy;
		outline: none;
	}
	.point {
		fill: var(--color-bg);
		stroke: var(--color-ink);
		stroke-width: 1.5;
		pointer-events: all;
		cursor: grab;
	}
	.point.hold {
		rx: 1;
	}
	.point.selected {
		fill: var(--color-accent);
		stroke: var(--color-accent);
	}
	.dragging .point {
		cursor: grabbing;
	}
	.db {
		position: absolute;
		z-index: 6;
		translate: -50% 0;
		padding: 1px 6px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: 10px;
		white-space: nowrap;
		pointer-events: none;
	}
</style>
