<script lang="ts">
	import { dragHasVisual, handleVisualDrop } from '$lib/media/dragTypes';
	import { preventNativeDrag } from '$lib/ui/drag';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import { onMount } from 'svelte';
	import { Button, IconButton } from '$lib/ui';
	import { formatRatio } from '$lib/model/format';
	import { formatClock } from '$lib/model/time';
	import { useEditor } from '$lib/state/context';
	import TextOverlay from './TextOverlay.svelte';
	import OverlayBoxOverlay from './OverlayBoxOverlay.svelte';
	import RecordingOverlay from './RecordingOverlay.svelte';
	import FramingOverlay from './FramingOverlay.svelte';
	import CropOverlay from './CropOverlay.svelte';
	import CardRectOverlay from './CardRectOverlay.svelte';

	interface Props {
		onpick: () => void;
	}

	let { onpick }: Props = $props();

	const editor = useEditor();

	let canvas: HTMLCanvasElement;
	let previewW = $state(0);
	const framing = $derived(editor.selectedScene?.scene.frame?.mode === 'custom');
	let reshaping = $state(false);
	let lastRatio = 0;
	let reshapeTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const r = ratio;
		if (lastRatio && r !== lastRatio) {
			reshaping = true;
			clearTimeout(reshapeTimer);
			reshapeTimer = setTimeout(() => (reshaping = false), 300);
		}
		lastRatio = r;
	});
	let previewH = $state(0);

	const ratio = $derived(formatRatio(editor.project.format));
	const empty = $derived(editor.ready && editor.project.scenes.length === 0);

	/** Drawing-buffer size cap, to keep the preview fast on large screens. */
	const MAX_PREVIEW_WIDTH = 1920;

	/**
	 * A click on the picture that isn't on words, a card's rectangle or the reframe handle, or a
	 * click on the empty stage around it, deselects. (Drags of an item start on the item itself,
	 * so releasing the mouse anywhere never deselects.)
	 */
	function onpreviewpointerdown(event: PointerEvent) {
		if (event.button !== 0 || editor.cropping) return;
		if ((event.target as Element).closest('[data-on-video], button, [role="dialog"], [role="menu"]')) return;
		editor.deselect();
	}

	function onstagepointerdown(event: PointerEvent) {
		if (event.button !== 0 || editor.cropping) return;
		const target = event.target as Element;
		if (target === event.currentTarget || target.matches('.viewport, .controls, .clock')) editor.deselect();
	}

	// ─── Dropping onto the picture: a layer on the scene at the playhead ──────────────────────
	let dropHover = $state(0);
	const dropBox = $derived.by(() => {
		// Where a new layer goes: centred, 40% of the width (shown with the frame's proportions).
		const w = 0.4;
		return { x: (1 - w) / 2, y: (1 - w) / 2, w, h: w };
	});

	function ondragenter(event: DragEvent) {
		if (!dragHasVisual(event) || editor.cropping) return;
		event.preventDefault();
		dropHover++;
	}
	function ondragover(event: DragEvent) {
		if (!dragHasVisual(event) || editor.cropping) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}
	function ondragleave(event: DragEvent) {
		if (!dragHasVisual(event)) return;
		dropHover = Math.max(0, dropHover - 1);
	}
	function ondrop(event: DragEvent) {
		if (!dragHasVisual(event) || editor.cropping) return;
		dropHover = 0;
		const at = editor.time;
		// With no scenes yet there's nothing to put a layer on: it becomes the first scene.
		const noScenes = editor.project.scenes.length === 0;
		const placed = handleVisualDrop(event, {
			media: (id) => (noScenes ? editor.addSceneFromMedia(id) : editor.addOverlayFromMedia(id, at)),
			card: () => (noScenes ? editor.addCard() : editor.addCardOverlay(at)),
			files: (files) => void editor.importAsOverlays(files, at)
		});
		// Handled here, so the page doesn't also add it as a scene. (A project file isn't a
		// picture: it's left for the page to open.)
		if (placed) event.preventDefault();
	}

	onMount(() => {
		editor.player.attach(canvas);
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			// The overlays use the same measurement as the picture, so they always line up with it.
			previewW = entry.contentRect.width;
			previewH = entry.contentRect.height;
			const box = entry.devicePixelContentBoxSize?.[0];
			let w = box ? box.inlineSize : entry.contentRect.width * devicePixelRatio;
			let h = box ? box.blockSize : entry.contentRect.height * devicePixelRatio;
			if (w > MAX_PREVIEW_WIDTH) {
				h = (h * MAX_PREVIEW_WIDTH) / w;
				w = MAX_PREVIEW_WIDTH;
			}
			editor.player.resize(canvas, w, h);
		});
		observer.observe(canvas);
		return () => {
			observer.disconnect();
			editor.player.detach(canvas);
		};
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Esc deselects from the keyboard) -->
<section class="stage" aria-label="Preview" onpointerdown={onstagepointerdown}>
	<div class="viewport" class:framing>
		<div
			class="preview"
			class:empty
			class:reshaping
			class:cropping={!!editor.cropping}
			role="presentation"
			onpointerdown={onpreviewpointerdown}
			ondragstart={preventNativeDrag}
			{ondragenter}
			{ondragover}
			{ondragleave}
			{ondrop}
			class:drop-hover={dropHover > 0}
			ondblclick={() => {
				// Double-click the picture to crop the scene under the playhead.
				if (!editor.cropping && !empty) editor.enterCrop();
			}}
			style:--ar={ratio}
		>
			<div class="clip">
				<canvas bind:this={canvas} class="frame" aria-label="Video preview" data-testid="preview"
				></canvas>
				{#if !editor.ready}
					<div class="empty-state loading" role="status">
						<p class="muted">Opening your project…</p>
					</div>
				{:else if empty}
					<div class="empty-state">
						<span class="glyph"><ImagePlus size={28} strokeWidth={1.5} aria-hidden="true" /></span>
						{#if editor.importing > 0}
							<p class="serif big">Adding your clips…</p>
							<p class="muted">This only takes a moment.</p>
						{:else}
							<p class="serif big">Start with your photos & videos</p>
							<p class="muted">
								Drop them anywhere on this page, or choose them from your device. Each one becomes a
								scene.
							</p>
							<Button variant="ink" onclick={onpick}>Choose photos & videos</Button>
							<ol class="steps" aria-label="How it works">
								<li><span class="num mono">1</span>Add your clips</li>
								<li><span class="num mono">2</span>Put them in order, add words & music</li>
								<li><span class="num mono">3</span>Save your video</li>
							</ol>
						{/if}
					</div>
				{/if}
			</div>
			{#if editor.cropping}
				<CropOverlay width={previewW} height={previewH} />
			{:else if !empty}
				<FramingOverlay width={previewW} height={previewH} />
				<CardRectOverlay width={previewW} height={previewH} />
				<OverlayBoxOverlay width={previewW} height={previewH} />
				<TextOverlay width={previewW} height={previewH} />
			{/if}
			<RecordingOverlay />
			{#if dropHover > 0}
				<div class="drop-target" aria-hidden="true">
					<span
						class="drop-box"
						style:left="{dropBox.x * 100}%"
						style:top="{dropBox.y * 100}%"
						style:width="{dropBox.w * 100}%"
						style:height="{dropBox.h * 100}%"
					></span>
					<span class="drop-label">
						{editor.project.scenes.length ? 'Drop to place on top of this scene' : 'Drop to add a scene'}
					</span>
				</div>
			{/if}
		</div>
	</div>

	<div class="controls">
		<IconButton
			label={editor.playing ? 'Pause' : 'Play'}
			shortcut="Space"
			icon={editor.playing ? Pause : Play}
			variant="ink"
			size="lg"
			disabled={empty}
			onclick={() => editor.togglePlay()}
		/>
		<p class="clock mono" data-testid="clock">
			<span class="now">{formatClock(editor.time)}</span>
			<span class="of">of</span>
			<span class="total">{formatClock(editor.duration)}</span>
		</p>
	</div>
</section>

<style>
	/* Dropping onto the picture: where the new layer will go. */
	.drop-target {
		position: absolute;
		inset: 0;
		z-index: 12;
		border-radius: inherit;
		background: color-mix(in srgb, var(--color-ink) 18%, transparent);
		pointer-events: none;
	}
	.drop-box {
		position: absolute;
		border: 2px dashed var(--color-bg);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-bg) 22%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-ink) 40%, transparent);
	}
	.drop-label {
		position: absolute;
		left: 50%;
		bottom: var(--space-4);
		translate: -50% 0;
		padding: 6px 12px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.stage {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		min-height: 0;
		padding: var(--space-4) var(--space-3) var(--space-3);
	}
	@media (max-width: 1279px) {
		.stage {
			padding: var(--space-5) var(--space-2) var(--space-3);
			gap: var(--space-3);
		}
	}
	/* The preview grows to fill this area in the project's shape, with a margin all round. */
	/* The reframe view's faded picture may extend past the preview, but not past this area. */
	.viewport.framing {
		overflow: clip;
	}
	.viewport {
		flex: 1;
		min-height: 0;
		display: grid;
		place-items: center;
		padding: var(--space-2) var(--space-4);
		container-type: size;
	}
	.preview {
		position: relative;
		width: min(100cqw, 100cqh * var(--ar));
		height: min(100cqh, 100cqw / var(--ar));
		border-radius: var(--radius-preview);
		box-shadow: var(--shadow-preview);
		background: var(--color-ink);
		container-type: inline-size;
	}
	/* Animate only when the project's shape changes, so window resizing stays immediate. */
	.preview.reshaping {
		transition:
			width var(--dur) var(--ease-out),
			height var(--dur) var(--ease-out);
	}
	.clip {
		position: absolute;
		z-index: 1;
		inset: 0;
		border-radius: inherit;
		overflow: hidden;
	}
	.frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.preview.empty {
		background: var(--color-surface);
		box-shadow: none;
		border: 1.5px dashed var(--color-border);
	}
	.preview.empty .frame {
		visibility: hidden;
	}
	.empty-state {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-6);
		text-align: center;
		animation: fade-in var(--dur) var(--ease-out);
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 60px;
		height: 60px;
		margin-bottom: var(--space-1);
		border-radius: 50%;
		background: var(--color-bg);
	}
	.loading {
		background: var(--color-surface);
	}
	.steps {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2) var(--space-5);
		margin: var(--space-5) 0 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
		color: var(--color-muted);
	}
	.steps li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.num {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--color-bg);
		color: var(--color-ink);
		font-size: var(--text-xs);
	}
	.big {
		font-size: clamp(24px, 4.2cqw, 38px);
		line-height: 1.05;
	}
	.muted {
		max-width: 40ch;
		margin-bottom: var(--space-2);
		color: var(--color-muted);
	}

	/* Play and time, centred under the preview. */
	.controls {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
	}
	.clock {
		display: flex;
		gap: 0.5ch;
		font-size: var(--text-md);
	}
	.of,
	.total {
		color: var(--color-muted);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
