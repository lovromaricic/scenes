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
	import { VOLUME_EASINGS, formatDb, gainToLevel, levelToGain, volumeAt, type VolumePoint } from '$lib/model/volume';
	import { Snapper, toFrame } from './snap';
	import { frameBatch } from '$lib/ui/frameBatch';
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

	/**
	 * While a point is dragged (or a new one is being placed), where it is: shown here only, and
	 * written to the project once, when the drag ends.
	 */
	let preview = $state<{ id: string | null; t: number; gain: number } | null>(null);

	/** The points as shown: the project's, with the dragged one where it is now. */
	const shownList = $derived.by(() => {
		if (!track) return [];
		const list = track.list as VolumePoint[];
		if (!preview) return list;
		const time = track.fromTimeline(preview.t);
		const moved = { id: preview.id ?? 'new', time, values: { gain: preview.gain }, easing: list.find((k) => k.id === preview!.id)?.easing ?? EASINGS.linear };
		return [...list.filter((k) => k.id !== preview!.id), moved].sort((x, y) => x.time - y.time);
	});

	const line = $derived.by(() => {
		if (!track || width <= 0) return '';
		const pts: string[] = [];
		const steps = Math.max(2, Math.min(240, Math.round(width / 3)));
		for (let i = 0; i <= steps; i++) {
			const x = (width * i) / steps;
			pts.push(`${x.toFixed(1)},${yOf(volumeAt(shownList, track.fromTimeline(tOf(x)))).toFixed(1)}`);
		}
		return `M${pts.join(' L')}`;
	});
	const points = $derived(
		track
			? shownList
					.map((k) => ({ id: k.id, t: track.toTimeline(k.time), gain: (k.values as { gain: number }).gain, easing: k.easing }))
					.filter((p) => p.t >= track.start - 1e-6 && p.t <= track.end + 1e-6)
			: []
	);

	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	let svg = $state<SVGSVGElement>();

	function local(e: PointerEvent) {
		const r = svg!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	/**
	 * Drag a point (or place a new one, `id` null): up and down for the volume, left and right for
	 * its time, snapping steadily (Alt: freely). Shown once per frame; one undo step at the end.
	 */
	function drag(event: PointerEvent, id: string | null, from: { t: number; gain: number }) {
		const start = local(event);
		const snapper = new Snapper();
		const fps = editor.project.format.fps;
		let moved = false;
		preview = { id, ...from };
		const batch = frameBatch((e: PointerEvent) => {
			const p = local(e);
			if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 2) return;
			moved = true;
			const t = toFrame(tOf(Math.min(width, Math.max(0, p.x))), fps);
			const targets = e.altKey
				? []
				: [...(services?.snapTargets([]) ?? [editor.time]), ...editor.keyframeTimes(id ? [{ itemId, id, channel: 'volume' }] : [])];
			const s = snapper.snap([t], targets, xOf, e.altKey);
			preview = { id, t: t + s.shift, gain: gainOfY(Math.min(height - PAD, Math.max(PAD, p.y))) };
		});
		drags.start(event, {
			move: (e) => batch.push(e),
			end: () => {
				batch.flush();
				const done = preview;
				preview = null;
				if (!done) return;
				if (id === null) {
					// A click (or drag) on the line: one new point, where it ended up.
					const newId = editor.addVolumePoint(itemId, done.t, done.gain);
					if (newId) editor.selectKeyframes([{ itemId, id: newId, channel: 'volume' }]);
				} else if (moved) editor.setVolumePoint(itemId, id, done.t, done.gain);
			}
		});
	}

	function onlinedown(event: PointerEvent) {
		if (event.button !== 0 || !track) return;
		event.preventDefault();
		event.stopPropagation();
		if (editor.selectedId !== itemId) editor.select(itemId);
		const t = tOf(local(event).x);
		drag(event, null, { t, gain: editor.volumeAtTime(itemId, t) });
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
		const p = points.find((x) => x.id === id);
		if (p) drag(event, id, { t: p.t, gain: p.gain });
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
		class:dragging={!!preview}
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
			{@const x = xOf(p.t)}
			{@const y = yOf(p.gain)}
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
	{#if preview}
		<span
			class="db mono"
			data-testid="volume-db"
			style:left="{xOf(preview.t)}px"
			style:top="{Math.max(0, yOf(preview.gain) - 22)}px">{formatDb(preview.gain)}</span
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
