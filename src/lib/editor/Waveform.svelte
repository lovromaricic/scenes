<!--
	@component
	Draws audio peaks (0–1) as mirrored bars on a canvas. Canvas keeps long sounds cheap to draw.
-->
<script lang="ts">
	interface Props {
		peaks: number[];
		/** CSS colour token name used for the bars. */
		color?: string;
	}

	let { peaks, color = 'var(--color-muted)' }: Props = $props();

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	let height = $state(0);

	$effect(() => {
		if (!canvas || width === 0 || height === 0) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.fillStyle = getComputedStyle(canvas).color;
		const bar = 2;
		const gap = 1;
		const count = Math.floor(width / (bar + gap));
		const mid = height / 2;
		for (let i = 0; i < count; i++) {
			const peak = peaks[Math.floor((i / count) * peaks.length)] ?? 0;
			const h = Math.max(1, peak * (height - 2));
			ctx.fillRect(i * (bar + gap), mid - h / 2, bar, h);
		}
	});
</script>

<div class="wave" bind:clientWidth={width} bind:clientHeight={height} style:color>
	<canvas bind:this={canvas} style:width="{width}px" style:height="{height}px" aria-hidden="true"
	></canvas>
</div>

<style>
	.wave {
		position: absolute;
		inset: 0;
	}
	canvas {
		display: block;
	}
</style>
