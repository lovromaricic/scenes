<!--
	@component
	The Frame section for a scene: Fill, Fit (with bars) or Custom (reframe on the preview).
-->
<script lang="ts">
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Copy from '@lucide/svelte/icons/copy';
	import CropIcon from '@lucide/svelte/icons/crop';
	import { Button, ChipGroup, Field, Slider } from '$lib/ui';
	import {
		DEFAULT_FRAME,
		frameRect,
		MAX_ZOOM,
		minZoom,
		type FrameBars,
		type FrameMode,
		type SceneFrame
	} from '$lib/model/framing';
	import type { Scene } from '$lib/model/types';
	import { croppedSize } from '$lib/model/crop';
	import { useEditor } from '$lib/state/context';
	import { MediaNoun, mediaNoun } from '$lib/model/labels';
	import KeyframeSection from './KeyframeSection.svelte';

	let { scene }: { scene: Scene } = $props();

	const editor = useEditor();

	const frame = $derived(scene.frame ?? DEFAULT_FRAME);
	/** "video" or "picture", after what the scene shows. */
	const noun = $derived(mediaNoun(scene));
	const Noun = $derived(MediaNoun(scene));
	const info = $derived(editor.media[scene.mediaId]);
	const out = $derived(editor.project.format);
	const size = $derived(info ? croppedSize(scene.crop, info) : null);
	const lowest = $derived(size ? minZoom(size.width, size.height, out.width, out.height) : 1);
	const matches = $derived(
		!!size && Math.abs(size.width / size.height - out.width / out.height) < 0.01
	);

	/** How much the picture is blown up in the saved video (output pixels per source pixel). */
	const enlarged = $derived.by(() => {
		if (!size) return 1;
		const rect = frameRect(frame, size.width, size.height, out.width, out.height);
		return rect.w / size.width;
	});
	const cropSummary = $derived(
		info
			? `${info.width} × ${info.height}` +
					(scene.crop ? ` → cropped to ${scene.crop.w} × ${scene.crop.h}` : '')
			: ''
	);
	const sameClip = $derived(
		editor.project.scenes.filter((s) => s.mediaId === scene.mediaId).length
	);

	const modes: { value: FrameMode; label: string; description: string }[] = $derived([
		{ value: 'fill', label: 'Fill', description: 'Covers the whole frame; the edges are cropped' },
		{ value: 'fit', label: 'Fit', description: `Shows the whole ${noun}, with bars around it` },
		{ value: 'custom', label: 'Custom', description: 'Move and zoom it yourself on the preview' }
	]);
	const barOptions: { value: FrameBars; label: string }[] = [
		{ value: 'black', label: 'Black' },
		{ value: 'white', label: 'White' },
		{ value: 'blur', label: 'Blur' }
	];

	function setMode(mode: FrameMode) {
		const next: SceneFrame = { ...frame, mode };
		// Custom starts from what you see now: Fill's size, or Fit's when coming from Fit.
		if (mode === 'custom') {
			next.zoom = frame.mode === 'fit' ? lowest : 1;
			next.x = 0;
			next.y = 0;
		}
		editor.setSceneFrame(scene.id, next);
	}
</script>

<div class="crop-row">
	<div class="crop-text">
		<span class="crop-label">{Noun}</span>
		<span class="mono crop-size" data-testid="crop-summary">{cropSummary}</span>
	</div>
	<Button
		variant="soft"
		size="sm"
		icon={CropIcon}
		title="Crop (C)"
		onclick={() => editor.enterCrop(scene.id)}
	>
		Crop
	</Button>
</div>
{#if enlarged > 1.15}
	<p class="soft-note">Enlarged {enlarged.toFixed(1)}×, may look a bit soft.</p>
{/if}
{#if scene.crop && sameClip > 1}
	<button type="button" class="link" onclick={() => editor.applyCropToClip(scene.id)}>
		<Copy size={13} strokeWidth={2} aria-hidden="true" />
		Apply crop to all scenes from this {noun}
	</button>
{/if}

<Field label="Frame" hint={matches ? 'Same shape as the video' : undefined}>
	<ChipGroup label="Frame" options={modes} value={frame.mode} onchange={setMode} />
</Field>

{#if frame.mode !== 'fill'}
	<Field label="Around the {noun}">
		<ChipGroup
			label="Bars"
			size="sm"
			options={barOptions}
			value={frame.bars}
			onchange={(bars: FrameBars) => editor.setSceneFrame(scene.id, { ...frame, bars })}
		/>
	</Field>
{/if}

{#if frame.mode === 'custom'}
	<Field label="Zoom">
		<Slider
			label="Zoom"
			min={Math.round(lowest * 100) / 100}
			max={MAX_ZOOM}
			step={0.01}
			value={Math.max(lowest, editor.frameValues(scene.id)?.zoom ?? frame.zoom)}
			format={(v) => `${v.toFixed(2)}×`}
			oninput={(zoom) => editor.setFrameValues(scene.id, { zoom }, `zoom:${scene.id}`)}
		/>
	</Field>
	<p class="tip">Drag the {noun} to move it. Scroll over it to zoom.</p>
	<KeyframeSection id={scene.id} />
	<div class="row">
		<Button
			variant="soft"
			size="sm"
			icon={RotateCcw}
			onclick={() => editor.setFrameValues(scene.id, { zoom: 1, x: 0, y: 0 })}
			>Reset</Button
		>
	</div>
{/if}

{#if editor.project.scenes.length > 1}
	<button type="button" class="link" onclick={() => editor.applyFrameToAll(scene.id)}>
		<Copy size={13} strokeWidth={2} aria-hidden="true" />
		Apply to all scenes
	</button>
{/if}

<style>
	.crop-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.crop-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.crop-label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.crop-size {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.soft-note {
		margin-top: calc(-1 * var(--space-3));
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.tip {
		margin-top: calc(-1 * var(--space-2));
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.row {
		display: flex;
		gap: var(--space-2);
		margin-top: calc(-1 * var(--space-2));
	}
	.link {
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
		gap: 6px;
		margin-top: calc(-1 * var(--space-2));
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
	.link:hover {
		color: var(--color-muted);
	}
</style>
