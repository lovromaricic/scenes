<script lang="ts">
	import { dragHasVisual, handleVisualDrop } from '$lib/media/dragTypes';
	import { preventNativeDrag } from '$lib/ui/drag';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import Repeat from '@lucide/svelte/icons/repeat';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import { onMount } from 'svelte';
	import { Button, IconButton, Menu, type MenuItem } from '$lib/ui';
	import { formatRatio } from '$lib/model/format';
	import { useEditor } from '$lib/state/context';
	import TextOverlay from './TextOverlay.svelte';
	import OverlayBoxOverlay from './OverlayBoxOverlay.svelte';
	import MotionPath from './MotionPath.svelte';
	import RecordingOverlay from './RecordingOverlay.svelte';
	import FramingOverlay from './FramingOverlay.svelte';
	import CropOverlay from './CropOverlay.svelte';
	import CardRectOverlay from './CardRectOverlay.svelte';
	import { DragScope } from '$lib/ui/drag';
	import { setStageView, StageView } from './stageView.svelte';

	interface Props {
		onpick: () => void;
	}

	let { onpick }: Props = $props();

	const editor = useEditor();
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

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
		if (target === event.currentTarget || target.matches('.viewport, .pasteboard, .controls, .clock'))
			editor.deselect();
	}

	// ─── The pasteboard: panning and zooming the stage ──────────────────────────────────────
	/*
	 * Objects may sit anywhere, also outside the frame. The stage around the preview is a
	 * pasteboard showing them faded (drawn by the player on a canvas behind the preview), and it
	 * can be panned (scroll, or Space + drag) and zoomed (Ctrl/Cmd + scroll, or the zoom menu).
	 */
	const stageView = new StageView();
	setStageView(stageView);

	let viewportEl = $state<HTMLDivElement>();
	let previewEl = $state<HTMLDivElement>();
	let pasteboard = $state<HTMLCanvasElement>();
	const format = $derived(editor.project.format);

	/**
	 * How the frame is shown: null is Fit (as large as the stage allows, following its size);
	 * otherwise its zoom (screen pixels per project pixel) and its centre's offset from the
	 * stage's centre, in screen pixels.
	 */
	let view = $state<{ zoom: number; x: number; y: number } | null>(null);
	const MAX_ZOOM = 8;
	/** Largest pasteboard drawing buffer (its longer side), to keep it light. */
	const MAX_PASTEBOARD = 2560;

	/** The zoom at which the frame fits the stage. */
	function fitZoom(): number {
		if (!viewportEl) return 1;
		const cs = getComputedStyle(viewportEl);
		const w = viewportEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
		const h = viewportEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
		return Math.max(1e-3, Math.min(w / format.width, h / format.height));
	}

	/** The smallest zoom: an eighth of Fit. */
	const minZoom = () => fitZoom() / 8;
	/** One scroll step (100 pixels of wheel) zooms by 10%. */
	const ZOOM_STEP = 1.1;

	/** Whether the frame is zoomed in past Fit (only then can it be moved around). */
	function beyondFit(v = view): boolean {
		return !!v && v.zoom > fitZoom() * 1.001;
	}

	/**
	 * Keep a view sensible: zoom within its limits; at Fit and below the frame is centred; beyond
	 * Fit it can be moved only so far that it's never completely out of view (whatever overflows
	 * the stage, plus a quarter of the stage).
	 */
	function clampView(v: { zoom: number; x: number; y: number }) {
		const zoom = Math.min(MAX_ZOOM, Math.max(minZoom(), v.zoom));
		if (zoom <= fitZoom() * 1.001) return { zoom, x: 0, y: 0 };
		const vw = viewportEl?.clientWidth ?? 0;
		const vh = viewportEl?.clientHeight ?? 0;
		const lx = Math.max(0, (format.width * zoom - vw) / 2) + vw / 4;
		const ly = Math.max(0, (format.height * zoom - vh) / 2) + vh / 4;
		return { zoom, x: Math.min(lx, Math.max(-lx, v.x)), y: Math.min(ly, Math.max(-ly, v.y)) };
	}

	const current = () => view ?? { zoom: fitZoom(), x: 0, y: 0 };

	/** Briefly animate the frame's position (when it's brought back to the centre). */
	let recentering = $state(false);
	let recenterTimer: ReturnType<typeof setTimeout> | undefined;
	function animateRecenter() {
		recentering = true;
		clearTimeout(recenterTimer);
		recenterTimer = setTimeout(() => (recentering = false), 240);
	}

	/** Back to Fit: centred again (smoothly, if it had been moved), then following the stage's size. */
	function fit() {
		const cur = view;
		if (cur && (cur.x || cur.y || Math.abs(cur.zoom - fitZoom()) > 1e-6)) {
			animateRecenter();
			const fitted = { zoom: fitZoom(), x: 0, y: 0 };
			view = fitted;
			setTimeout(() => {
				if (view === fitted) view = null;
			}, 240);
		} else view = null;
	}
	/** Whether the view is Fit (also while it's settling back there). */
	const atFit = $derived(!view || (recentering && !view.x && !view.y && Math.abs(view.zoom - fitZoom()) < 1e-6));

	/**
	 * Zoom to `zoom` around the stage's centre (the point there stays put). Back at Fit or below,
	 * the frame is centred again; very near Fit, it's Fit.
	 */
	function zoomTo(zoom: number) {
		if (!viewportEl) return;
		const cur = current();
		const z = Math.min(MAX_ZOOM, Math.max(minZoom(), zoom));
		if (Math.abs(z / fitZoom() - 1) < 0.02) {
			fit();
			return;
		}
		const k = z / cur.zoom;
		const next = clampView({ zoom: z, x: cur.x * k, y: cur.y * k });
		if ((cur.x || cur.y) && !next.x && !next.y) animateRecenter();
		view = next;
	}

	/** Move the frame around (only when zoomed in past Fit). */
	function panBy(dx: number, dy: number) {
		if (!beyondFit()) return;
		const cur = current();
		view = clampView({ ...cur, x: cur.x + dx, y: cur.y + dy });
	}

	const zoomLabel = $derived(view && !atFit ? `${Math.round(view.zoom * 100)}%` : 'Fit');

	// Cmd/Ctrl + scroll (or a pinch) zooms the stage, everywhere on it, around its centre. Plain
	// scroll zooms a Custom-framed picture (the reframe view handles that itself), pans when
	// zoomed in past Fit, and otherwise does nothing here. Not passive, so the page doesn't scroll
	// or zoom instead.
	$effect(() => {
		const el = viewportEl;
		if (!el) return;
		const onwheel = (event: WheelEvent) => {
			if (empty || !editor.ready || editor.cropping) return;
			const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1;
			const dx = event.deltaX * unit;
			const dy = event.deltaY * unit;
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault();
				zoomTo(current().zoom * Math.pow(ZOOM_STEP, -dy / 100));
				return;
			}
			if (event.defaultPrevented || !beyondFit()) return;
			event.preventDefault();
			if (event.shiftKey && !dx) panBy(-dy, 0);
			else panBy(-dx, -dy);
		};
		el.addEventListener('wheel', onwheel, { passive: false });
		return () => el.removeEventListener('wheel', onwheel);
	});

	// Space + drag (or the middle button) pans. Space on its own, released without dragging,
	// still plays and pauses.
	let spaceDown = $state(false);
	let spaceUsed = false;
	let panning = $state(false);
	const drags = new DragScope();
	$effect(() => () => drags.dispose());

	function typing(el: HTMLElement | null) {
		return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
	}

	function onwindowkeydown(event: KeyboardEvent) {
		if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) return;
		if (empty || editor.cropping || editor.recording) return;
		const target = event.target as HTMLElement | null;
		if (typing(target) || target?.closest?.('[role="dialog"], [role="menu"]')) return;
		// Only zoomed in past Fit is there anything to pan: otherwise Space just plays.
		if (!spaceDown && (!beyondFit() || !viewportEl?.matches(':hover'))) return;
		// Held over the stage: wait to see whether it's for panning (handled on release).
		event.preventDefault();
		event.stopPropagation();
		if (!spaceDown) {
			spaceDown = true;
			spaceUsed = false;
		}
	}

	function onwindowkeyup(event: KeyboardEvent) {
		if (event.key !== ' ' || !spaceDown) return;
		event.preventDefault();
		event.stopPropagation();
		spaceDown = false;
		if (!spaceUsed && !panning && editor.project.scenes.length) editor.togglePlay();
	}

	function onviewportpointerdown(event: PointerEvent) {
		if (!((spaceDown && event.button === 0) || event.button === 1) || empty || !beyondFit()) return;
		event.preventDefault();
		event.stopPropagation();
		spaceUsed = true;
		panning = true;
		const start = { x: event.clientX, y: event.clientY, view: current() };
		drags.start(
			event,
			{
				move: (e) => {
					view = clampView({ ...start.view, x: start.view.x + e.clientX - start.x, y: start.view.y + e.clientY - start.y });
				},
				end: () => (panning = false)
			},
			viewportEl
		);
	}

	/**
	 * Measure where the preview is on the stage: for the pasteboard's drawing and for cutting off
	 * boxes and handles at the stage's edges.
	 */
	function measure() {
		if (!viewportEl || !previewEl) return;
		const v = viewportEl.getBoundingClientRect();
		const p = previewEl.getBoundingClientRect();
		stageView.visible = { x0: v.left - p.left, y0: v.top - p.top, x1: v.right - p.left, y1: v.bottom - p.top };
		if (pasteboard) {
			const k = Math.min(devicePixelRatio || 1, MAX_PASTEBOARD / Math.max(1, v.width, v.height));
			editor.player.placePasteboard(v.width * k, v.height * k, {
				x: (p.left - v.left) * k,
				y: (p.top - v.top) * k,
				width: p.width * k
			});
		}
	}

	// Re-measure after every change of view (the DOM is updated by the time this runs).
	$effect(() => {
		void view;
		void ratio;
		measure();
	});

	$effect(() => {
		// Nothing to pan around without scenes: back to Fit.
		if (empty) view = null;
	});

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
		editor.player.setPasteboard(canvas, pasteboard ?? null);
		const stageObserver = new ResizeObserver(() => measure());
		if (viewportEl) stageObserver.observe(viewportEl);
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
			measure();
		});
		observer.observe(canvas);
		return () => {
			observer.disconnect();
			stageObserver.disconnect();
			editor.player.setPasteboard(canvas, null);
			editor.player.detach(canvas);
		};
	});

	// ─── Right-click: save this frame ───────────────────────────────────────────────────────
	let frameMenu = $state<{ x: number; y: number } | null>(null);
	let frameMenuAnchor = $state<HTMLElement>();
	function onpreviewcontextmenu(event: MouseEvent) {
		if (empty || editor.cropping) return;
		event.preventDefault();
		frameMenu = { x: event.clientX, y: event.clientY };
	}
	const frameMenuItems: MenuItem[] = [
		{ label: 'Save this frame as PNG', shortcut: 'F', onselect: () => void editor.downloadFrame('png') },
		{ label: 'Save this frame as JPG', onselect: () => void editor.downloadFrame('jpg') }
	];

	// ─── The zoom menu ──────────────────────────────────────────────────────────────────────
	let zoomMenu = $state(false);
	let zoomButton = $state<HTMLButtonElement>();
	const zoomItems = $derived<MenuItem[]>([
		{ label: `${view ? '' : '✓ '}Fit`, onselect: fit },
		{ label: `${view && Math.abs(view.zoom - 0.5) < 1e-6 ? '✓ ' : ''}50%`, onselect: () => zoomTo(0.5) },
		{ label: `${view && Math.abs(view.zoom - 1) < 1e-6 ? '✓ ' : ''}100%`, onselect: () => zoomTo(1) },
		{ label: 'Zoom in', shortcut: 'Ctrl/⌘ + scroll', separator: true, onselect: () => zoomTo(current().zoom * 1.25) },
		{ label: 'Zoom out', onselect: () => zoomTo(current().zoom / 1.25) }
	]);
</script>

<svelte:window onkeydowncapture={onwindowkeydown} onkeyupcapture={onwindowkeyup} onblur={() => (spaceDown = false)} />

{#if frameMenu}
	<span
		bind:this={frameMenuAnchor}
		class="menu-anchor"
		style:left="{frameMenu.x}px"
		style:top="{frameMenu.y}px"
		aria-hidden="true"
	></span>
	{#if frameMenuAnchor}
		<Menu label="Frame" items={frameMenuItems} anchor={frameMenuAnchor} onclose={() => (frameMenu = null)} />
	{/if}
{/if}


<section class="stage" aria-label="Preview" onpointerdown={onstagepointerdown}>
	<div
		class="viewport"
		class:framing
		class:space-pan={spaceDown}
		class:panning
		bind:this={viewportEl}
		onpointerdowncapture={onviewportpointerdown}
		data-testid="stage"
	>
		<canvas bind:this={pasteboard} class="pasteboard" aria-hidden="true" class:hidden={empty || !editor.ready}></canvas>
		<div
			bind:this={previewEl}
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
			oncontextmenu={onpreviewcontextmenu}
			ondblclick={() => {
				// Double-click the picture to crop the scene under the playhead.
				if (!editor.cropping && !empty) editor.enterCrop();
			}}
			style:--ar={ratio}
			class:zoomed={!!view}
			class:recentering
			style:width={view ? `${format.width * view.zoom}px` : undefined}
			style:height={view ? `${format.height * view.zoom}px` : undefined}
			style:left={view ? `calc(50% + ${view.x - (format.width * view.zoom) / 2}px)` : undefined}
			style:top={view ? `calc(50% + ${view.y - (format.height * view.zoom) / 2}px)` : undefined}
			style:--pasteboard-clip={stageView.clipPath}
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
			{#if !empty && editor.ready}
				<span class="frame-edge" aria-hidden="true"></span>
			{/if}
			{#if editor.cropping}
				<CropOverlay width={previewW} height={previewH} />
			{:else if !empty}
				<FramingOverlay width={previewW} height={previewH} />
				<CardRectOverlay width={previewW} height={previewH} />
				<MotionPath width={previewW} height={previewH} />
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
		<IconButton
			label={editor.project.loop ? (editor.project.range ? 'Loop the range: on' : 'Loop: on') : 'Loop'}
			shortcut={isMac ? '⌘L' : 'Ctrl+L'}
			icon={Repeat}
			variant="soft"
			size="lg"
			class="loop"
			aria-pressed={!!editor.project.loop}
			disabled={empty}
			onclick={() => editor.toggleLoop()}
		/>
		<!-- Click to switch between hundredths of a second and frames (remembered on this device). -->
		<button
			type="button"
			class="clock mono"
			data-testid="clock"
			title={editor.timeFormat === 'seconds' ? 'Show frames' : 'Show seconds'}
			onclick={() => editor.toggleTimeFormat()}
		>
			<span class="now">{editor.formatTime(editor.time)}</span>
			<span class="of">of</span>
			<span class="total">{editor.formatTime(editor.duration)}</span>
		</button>
		{#if !empty && editor.ready}
			<button
				bind:this={zoomButton}
				type="button"
				class="zoom mono"
				aria-label="Stage zoom: {view ? zoomLabel : 'whole frame'}"
				aria-haspopup="menu"
				aria-expanded={zoomMenu}
				title="Zoom the stage (Ctrl/⌘ + scroll; double-click for Fit). Zoomed in, scroll or Space + drag to move around."
				onclick={() => (zoomMenu = !zoomMenu)}
				ondblclick={() => {
					zoomMenu = false;
					fit();
				}}
				data-testid="zoom">{zoomLabel}</button
			>
			{#if zoomMenu && zoomButton}
				<Menu label="Zoom" items={zoomItems} anchor={zoomButton} onclose={() => (zoomMenu = false)} />
			{/if}
		{/if}
	</div>
</section>

<style>
	.menu-anchor {
		position: fixed;
		width: 1px;
		height: 1px;
		pointer-events: none;
	}
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
	/* The pasteboard: light gray around the frame. */
	.viewport {
		position: relative;
		border-radius: var(--radius-card);
		background: var(--pasteboard);
		flex: 1;
		min-height: 0;
		display: grid;
		place-items: center;
		padding: var(--space-2) var(--space-4);
		container-type: size;
	}
	/* Space held over the stage: drag to pan. */
	.viewport.space-pan,
	.viewport.space-pan :global(*) {
		cursor: grab !important;
	}
	.viewport.panning,
	.viewport.panning :global(*) {
		cursor: grabbing !important;
	}
	/* Behind the preview: the parts of pictures and words outside the frame, faded. */
	.pasteboard {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.pasteboard.hidden {
		visibility: hidden;
	}
	.preview {
		position: relative;
		width: min(100cqw, 100cqh * var(--ar));
		height: min(100cqh, 100cqw / var(--ar));
		/* Square-ish corners: what's outside the frame shows on the stage around it. */
		border-radius: var(--radius-frame, 3px);
		container-type: inline-size;
	}
	/* Zoomed or panned: placed by its own size and offset (see `view`). */
	.preview.zoomed {
		position: absolute;
	}
	/* Back to the centre (zoomed out to Fit or below): a short, smooth move. */
	.preview.recentering {
		transition:
			left 0.22s var(--ease-out),
			top 0.22s var(--ease-out),
			width 0.22s var(--ease-out),
			height 0.22s var(--ease-out);
	}
	/* The frame's edge, clear against the pasteboard. */
	.frame-edge {
		position: absolute;
		inset: 0;
		z-index: 2;
		border-radius: inherit;
		/* A thin border, so a white frame stands out from the pasteboard (with the shadow). */
		box-shadow: 0 0 0 1px var(--color-border);
		pointer-events: none;
		clip-path: var(--pasteboard-clip, none);
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
		background: var(--color-ink);
		box-shadow: var(--shadow-preview);
		/* Zoomed in, the frame may be larger than the stage: cut off at its edges. */
		clip-path: var(--pasteboard-clip, none);
	}
	.frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.preview.empty {
		border-radius: var(--radius-preview);
		background: var(--color-surface);
		border: 1.5px dashed var(--color-border);
	}
	.preview.empty .clip {
		background: none;
		box-shadow: none;
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
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
	}
	.clock {
		display: flex;
		gap: 0.5ch;
		padding: 4px 8px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--color-ink);
		font-size: var(--text-md);
		/* Digits all the same width, so the time doesn't wobble while it runs. */
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}
	.clock:hover {
		background: var(--color-surface);
	}
	.clock:focus-visible {
		box-shadow: var(--focus-ring);
		outline: none;
	}
	/* Loop: as big and round as Play, but quieter (soft) when off; the accent when on. Hover,
	   pressed and focus are the icon buttons' own, the same as Play's. */
	.controls :global(.loop[aria-pressed='true']) {
		background: var(--color-accent);
		color: #fff;
	}
	.controls :global(.loop[aria-pressed='true']:hover:not(:disabled)) {
		background: var(--color-accent-hover);
	}
	.of,
	.total {
		color: var(--color-muted);
	}
	/* The zoom menu's button, at the right end of the controls. */
	.zoom {
		position: absolute;
		right: var(--space-4);
		min-width: 56px;
		height: 30px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-ink);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.zoom:hover {
		background: var(--color-surface);
	}
	.zoom:focus-visible {
		box-shadow: var(--focus-ring);
		outline: none;
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
