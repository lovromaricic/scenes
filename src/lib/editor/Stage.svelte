<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import { onMount } from 'svelte';
	import { Button, IconButton } from '$lib/ui';
	import { aspectRatioValue } from '$lib/model/catalog';
	import { formatClock } from '$lib/model/time';
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
			editor.player.resize(canvas, w, h);
		});
		observer.observe(canvas);
		return () => {
			observer.disconnect();
			editor.player.detach(canvas);
		};
	});
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
			{#if !empty}
				<TextOverlay width={previewW} height={previewH} />
			{/if}
			<RecordingOverlay />
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
	.stage {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		min-height: 0;
		padding: var(--space-6) var(--space-4) var(--space-4);
	}
	@media (max-width: 1279px) {
		.stage {
			padding: var(--space-5) var(--space-2) var(--space-3);
			gap: var(--space-3);
		}
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
