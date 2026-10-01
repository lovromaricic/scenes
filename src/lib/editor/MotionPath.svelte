<!--
	@component
	The selected layer's or words' motion path on the preview: a thin line through where it goes
	between its keyframes (following their easing), with a dot at each keyframe. Click a dot to go
	to that keyframe. Drag the line to move the whole animation; once selected, the arrow keys
	nudge it (Shift for bigger steps).
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { sortKeyframes, type ItemValues, type Keyframe } from '$lib/model/keyframes';
	import { useEditor } from '$lib/state/context';
	import { DragScope } from '$lib/ui/drag';

	let { width, height }: { width: number; height: number } = $props();

	const editor = useEditor();
	const format = $derived(editor.project.format);

	/** The selected overlay or words, with its keyframes, while not playing. */
	const item = $derived.by(() => {
		if (editor.playing || editor.cropping || !editor.selectedId) return null;
		const id = editor.selectedId;
		const o = editor.project.overlays.find((x) => x.id === id) ?? editor.project.texts.find((x) => x.id === id);
		if (!o || !o.keyframes || o.keyframes.length < 2) return null;
		const track = editor.track(o.trackId);
		if (track?.hidden || track?.locked) return null;
		return { id, start: o.start, keyframes: sortKeyframes(o.keyframes) as Keyframe<ItemValues>[] };
	});

	const points = $derived.by(() => {
		if (!item) return [];
		const first = item.keyframes[0].time;
		const last = item.keyframes[item.keyframes.length - 1].time;
		const out: string[] = [];
		const steps = 96;
		for (let i = 0; i <= steps; i++) {
			const v = editor.itemValues(item.id, item.start + first + ((last - first) * i) / steps);
			if (v) out.push(`${(v.x * width).toFixed(1)},${(v.y * height).toFixed(1)}`);
		}
		return out;
	});
	const d = $derived(points.length ? `M${points.join(' L')}` : '');

	let selected = $state(false);
	const itemId = $derived(item?.id ?? null);
	$effect(() => {
		// A different item (or none): the path isn't selected any more.
		void itemId;
		selected = false;
	});

	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	let pathEl = $state<SVGPathElement>();

	function onpointerdown(event: PointerEvent) {
		if (!item || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		selected = true;
		pathEl?.focus();
		const from = item.keyframes.map((k) => ({ ...k, values: { ...k.values } }));
		const id = item.id;
		const x0 = event.clientX;
		const y0 = event.clientY;
		let moved = false;
		drags.start(event, {
			move: (e) => {
				if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < 3) return;
				if (!moved) editor.beginGesture();
				moved = true;
				editor.liveMoveAnimation(id, from, (e.clientX - x0) / width, (e.clientY - y0) / height);
			},
			end: () => {
				if (moved) editor.endGesture('Move animation');
			}
		});
	}

	function onkeydown(event: KeyboardEvent) {
		if (!item) return;
		if (event.key === 'Escape') {
			selected = false;
			pathEl?.blur();
			return;
		}
		const step = event.shiftKey ? 10 : 1;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		};
		const m = moves[event.key];
		if (!m) return;
		event.preventDefault();
		event.stopPropagation();
		editor.moveAnimation(item.id, m[0] / format.width, m[1] / format.height, `path-nudge:${item.id}`);
	}
</script>

{#if item && d}
	<svg class="motion-path" class:selected {width} {height} viewBox="0 0 {width} {height}" data-on-video>
		<path class="line" {d} />
		<!-- A wider, invisible line that's easy to grab. -->
		<path
			bind:this={pathEl}
			class="hit"
			{d}
			role="button"
			tabindex="0"
			aria-label="Motion path. Drag, or select it and use the arrow keys, to move the whole animation."
			aria-pressed={selected}
			data-testid="motion-path"
			{onpointerdown}
			{onkeydown}
			onblur={() => (selected = false)}
		/>
		{#each item.keyframes as k (k.id)}
			{@const t = item.start + k.time}
			<circle
				class="dot"
				cx={k.values.x * width}
				cy={k.values.y * height}
				r="4.5"
				role="button"
				tabindex="-1"
				aria-label="Keyframe at {t.toFixed(2)} s"
				data-path-dot={k.id}
				onpointerdown={(e) => {
					e.stopPropagation();
					editor.seek(t);
				}}
			/>
		{/each}
	</svg>
{/if}

<style>
	.motion-path {
		position: absolute;
		inset: 0;
		z-index: 3;
		overflow: visible;
		pointer-events: none;
	}
	.line {
		fill: none;
		stroke: var(--color-bg);
		stroke-width: 1.5;
		stroke-dasharray: 4 3;
		filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.7));
	}
	.selected .line {
		stroke: var(--color-accent);
		stroke-dasharray: none;
		stroke-width: 2;
	}
	.hit {
		fill: none;
		stroke: transparent;
		stroke-width: 14;
		pointer-events: stroke;
		cursor: move;
		outline: none;
	}
	.dot {
		fill: var(--color-bg);
		stroke: var(--color-ink);
		stroke-width: 1.5;
		pointer-events: all;
		cursor: pointer;
	}
	.selected .dot {
		stroke: var(--color-accent);
	}
</style>
