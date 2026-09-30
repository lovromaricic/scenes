<!--
	@component
	A scene's filmstrip: frames sampled evenly across the part of the clip the scene shows, one per
	tile. Tiles have the video's shape. Frames arrive in the background and are cached.
-->
<script lang="ts">
	import { requestFrames, sampleTimes, type StripFrame } from '$lib/media/filmstrip';
	import { frameRect, showsBars, type SceneFrame } from '$lib/model/framing';
	import type { Crop, Size } from '$lib/model/crop';

	interface Props {
		mediaId: string;
		sourceStart: number;
		sourceEnd: number;
		/** Width ÷ height of a tile (the project's shape). */
		tileAspect: number;
		/** The scene's framing, drawn the same way as the preview and export. */
		frame?: SceneFrame;
		/** The scene's crop, in source pixels, and the source's size. */
		crop?: Crop;
		sourceSize?: Size;
	}

	let { mediaId, sourceStart, sourceEnd, tileAspect, frame, crop, sourceSize }: Props = $props();

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	let height = $state(0);

	const tileWidth = $derived(Math.max(8, height * tileAspect));
	const count = $derived(width > 0 && height > 0 ? Math.max(1, Math.ceil(width / tileWidth)) : 0);
	const times = $derived(count ? sampleTimes(sourceStart, sourceEnd, count) : []);

	let generation = 0;

	$effect(() => {
		if (!canvas || count === 0) return;
		const gen = ++generation;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		const tw = tileWidth;
		const th = height;
		const list = times;
		const framing = frame;
		const cropBox = crop;
		const srcSize = sourceSize;

		const draw = (i: number, img: StripFrame) => {
			if (gen !== generation) return;
			const x = i * tw;
			ctx.save();
			ctx.beginPath();
			ctx.rect(x, 0, tw, th);
			ctx.clip();
			// The crop first (scaled to this small frame), then the same framing as the preview.
			const k = srcSize ? img.width / srcSize.width : 1;
			const sx = cropBox ? cropBox.x * k : 0;
			const sy = cropBox ? cropBox.y * k : 0;
			const sw = cropBox ? cropBox.w * k : img.width;
			const sh = cropBox ? cropBox.h * k : img.height;
			const r = frameRect(framing, sw, sh, tw, th);
			if (showsBars(r, tw, th)) {
				const bars = framing?.bars ?? 'black';
				if (bars === 'blur') {
					const c = frameRect(undefined, sw, sh, tw, th);
					ctx.filter = `blur(${Math.max(2, th / 14)}px) brightness(0.85)`;
					ctx.drawImage(img.image, sx, sy, sw, sh, x + c.x, c.y, c.w, c.h);
					ctx.filter = 'none';
				} else {
					ctx.fillStyle = bars === 'white' ? '#ffffff' : '#000000';
					ctx.fillRect(x, 0, tw, th);
				}
			}
			ctx.drawImage(img.image, sx, sy, sw, sh, x + r.x, r.y, r.w, r.h);
			ctx.restore();
		};

		list.forEach((t, i) => requestFrames(mediaId, [t], (_t, frame) => draw(i, frame)));
	});
</script>

<div class="strip" bind:clientWidth={width} bind:clientHeight={height}>
	<canvas
		bind:this={canvas}
		data-testid="filmstrip"
		data-tiles={count}
		data-tile-width={tileWidth}
		style:width="{width}px"
		style:height="{height}px"
		aria-hidden="true"
	></canvas>
</div>

<style>
	.strip {
		position: absolute;
		inset: 0;
	}
	canvas {
		display: block;
	}
</style>
