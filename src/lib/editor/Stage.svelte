<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import { onMount } from 'svelte';
	import { Button, ChipGroup, IconButton } from '$lib/ui';
	import { ASPECTS, aspectRatioValue } from '$lib/model/catalog';
	import { formatClock } from '$lib/model/time';
	import type { AspectRatio } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import TextOverlay from './TextOverlay.svelte';
	import RecordingOverlay from './RecordingOverlay.svelte';

	interface Props {
		onpick: () => void;
	}

	let { onpick }: Props = $props();

	const editor = useEditor();

	let canvas: HTMLCanvasElement;
	let previewW = $state(0);
	let previewH = $state(0);

	const ratio = $derived(aspectRatioValue(editor.project.aspect));
	const aspectOptions = ASPECTS.map((a) => ({ value: a.id, label: a.label }));
	const empty = $derived(editor.ready && editor.project.scenes.length === 0);

	/** Drawing-buffer size cap, to keep the preview fast on large screens. */
	const MAX_PREVIEW_WIDTH = 1920;

	onMount(() => {
		editor.player.attach(canvas);
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			const box = entry.devicePixelContentBoxSize?.[0];
			let w = box ? box.inlineSize : entry.contentRect.width * devicePixelRatio;
			let h = box ? box.blockSize : entry.contentRect.height * devicePixelRatio;
			if (w > MAX_PREVIEW_WIDTH) {
				h = (h * MAX_PREVIEW_WIDTH) / w;
				w = MAX_PREVIEW_WIDTH;
			}
			editor.player.resize(w, h);
		});
		observer.observe(canvas);
		return () => {
			observer.disconnect();
			editor.player.detach();
		};
	});

	function setAspect(aspect: AspectRatio) {
		editor.setAspect(aspect);
	}
</script>

<section class="stage" aria-label="Preview">
	<div class="viewport">
		<div
			class="preview"
			class:empty
			bind:clientWidth={previewW}
			bind:clientHeight={previewH}
			style:--ar={ratio}
		>
			<div class="clip">
				<canvas bind:this={canvas} class="frame" aria-label="Video preview" data-testid="preview"
				></canvas>
				{#if empty}
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
						{/if}
					</div>
				{/if}
			</div>
			{#if !empty}
				<TextOverlay width={previewW} height={previewH} />
			{/if}
			<RecordingOverlay />
		</div>
	</div>

	<div class="controls">
		<div class="left"></div>
		<div class="transport">
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
		<div class="right">
			<ChipGroup
				label="Video shape"
				variant="segmented"
				size="sm"
				options={aspectOptions}
				value={editor.project.aspect}
				onchange={setAspect}
			/>
		</div>
	</div>
</section>

<style>
	.stage {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		min-height: 0;
		padding: var(--space-6) var(--space-4) var(--space-4);
	}
	.viewport {
		flex: 1;
		min-height: 0;
		display: grid;
		place-items: center;
		container-type: size;
	}
	.preview {
		position: relative;
		width: min(100cqw, 100cqh * var(--ar));
		aspect-ratio: var(--ar);
		border-radius: var(--radius-preview);
		box-shadow: var(--shadow-preview);
		background: var(--color-ink);
		container-type: inline-size;
	}
	.clip {
		position: absolute;
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
	.big {
		font-size: clamp(24px, 4.2cqw, 38px);
		line-height: 1.05;
	}
	.muted {
		max-width: 40ch;
		margin-bottom: var(--space-2);
		color: var(--color-muted);
	}

	.controls {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: var(--space-4);
	}
	.transport {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.clock {
		display: flex;
		gap: 0.5ch;
		min-width: 13ch;
		font-size: var(--text-md);
	}
	.of,
	.total {
		color: var(--color-muted);
	}
	.right {
		display: flex;
		justify-content: flex-end;
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
