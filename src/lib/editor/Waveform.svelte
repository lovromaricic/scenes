<!--
	@component
	Draws a stretch of audio peaks as mirrored bars on a canvas (canvas keeps long songs cheap).
	`from` and `length` pick the part of the sound (in source seconds) the box shows.
-->
<script lang="ts">
	interface Props {
		peaks: ArrayLike<number>;
		perSecond: number;
		from?: number;
		length?: number;
	}

	let { peaks, perSecond, from = 0, length }: Props = $props();

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
		const seconds = length ?? peaks.length / perSecond - from;
		const bar = 2;
		const gap = 1;
		const count = Math.floor(width / (bar + gap));
		const mid = height / 2;
		for (let i = 0; i < count; i++) {
			// Loudest peak within this bar's slice of time.
			const a = Math.floor((from + (i / count) * seconds) * perSecond);
			const b = Math.max(a + 1, Math.floor((from + ((i + 1) / count) * seconds) * perSecond));
			let peak = 0;
			for (let j = a; j < b && j < peaks.length; j++) peak = Math.max(peak, peaks[j]);
			const h = Math.max(1, peak * (height - 2));
			ctx.fillRect(i * (bar + gap), mid - h / 2, bar, h);
		}
	});
</script>

<div class="wave" bind:clientWidth={width} bind:clientHeight={height}>
	<canvas bind:this={canvas} style:width="{width}px" style:height="{height}px" aria-hidden="true"
	></canvas>
</div>

<style>
	.wave {
		position: absolute;
		inset: 0;
		color: color-mix(in srgb, var(--color-muted) 70%, var(--color-bg));
	}
	canvas {
		display: block;
	}
</style>
