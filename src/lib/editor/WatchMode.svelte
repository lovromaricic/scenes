<!--
	@component
	"Watch": the whole video full screen, from the start, with controls that fade away.
	Draws with the same player as the editor (it just borrows a bigger canvas).
-->
<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import { IconButton } from '$lib/ui';
	import { formatRatio } from '$lib/model/format';
	import { formatClock } from '$lib/model/time';
	import { useEditor } from '$lib/state/context';

	let { onclose }: { onclose: () => void } = $props();

	const editor = useEditor();

	let root: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let vw = $state(0);
	let vh = $state(0);
	let controlsVisible = $state(true);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	const ratio = $derived(formatRatio(editor.project.format));
	// Fit the video inside the window.
	const box = $derived(vw / vh > ratio ? { w: vh * ratio, h: vh } : { w: vw, h: vw / ratio });
	const ended = $derived(!editor.playing && editor.time >= editor.duration - 0.05);

	onMount(() => {
		editor.player.attach(canvas);
		void root.requestFullscreen?.().catch(() => {
			// Not allowed (e.g. no user gesture): the overlay still fills the window.
		});
		editor.seek(0);
		editor.togglePlay();
		poke();
		const onFullscreen = () => {
			if (!document.fullscreenElement) close();
		};
		document.addEventListener('fullscreenchange', onFullscreen);
		return () => {
			document.removeEventListener('fullscreenchange', onFullscreen);
			clearTimeout(hideTimer);
			editor.player.pause();
			editor.player.detach(canvas);
		};
	});

	$effect(() => {
		const dpr = window.devicePixelRatio || 1;
		if (box.w > 0)
			editor.player.resize(
				canvas,
				Math.min(3840, box.w * dpr),
				Math.min(3840, box.w * dpr) / ratio
			);
	});

	/** Show the controls, then fade them out after a moment of stillness while playing. */
	function poke() {
		controlsVisible = true;
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (editor.playing) controlsVisible = false;
		}, 2500);
	}

	$effect(() => {
		if (!editor.playing) controlsVisible = true;
		else poke();
	});

	function close() {
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
		onclose();
	}

	function toggle() {
		if (ended) editor.seek(0);
		editor.togglePlay();
		poke();
	}

	function onkeydown(event: KeyboardEvent) {
		event.stopPropagation();
		poke();
		if (event.key === ' ' || event.key === 'k') {
			event.preventDefault();
			toggle();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			close();
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			editor.seek(editor.time + (event.key === 'ArrowLeft' ? -5 : 5));
		}
	}

	function seekFromBar(event: PointerEvent) {
		const bar = event.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		editor.seek(((event.clientX - rect.left) / rect.width) * editor.duration);
	}
</script>

<svelte:window {onkeydown} />

<div
	bind:this={root}
	class="watch"
	class:hide-cursor={!controlsVisible}
	bind:clientWidth={vw}
	bind:clientHeight={vh}
	role="dialog"
	aria-modal="true"
	aria-label="Watch {editor.project.title}"
	tabindex="-1"
	onpointermove={poke}
>
	<canvas
		bind:this={canvas}
		class="screen"
		style:width="{box.w}px"
		style:height="{box.h}px"
		aria-label="Your video"
		onclick={toggle}
	></canvas>

	<div class="top" class:visible={controlsVisible}>
		<p class="serif title">{editor.project.title}</p>
		<IconButton label="Back to editing" icon={X} variant="on-ink" onclick={close} />
	</div>

	<div class="bottom" class:visible={controlsVisible}>
		<IconButton
			label={ended ? 'Watch again' : editor.playing ? 'Pause' : 'Play'}
			icon={ended ? RotateCcw : editor.playing ? Pause : Play}
			variant="on-ink"
			size="lg"
			onclick={toggle}
		/>
		<div
			class="bar"
			role="slider"
			aria-label="Position"
			aria-valuemin="0"
			aria-valuemax={Math.round(editor.duration)}
			aria-valuenow={Math.round(editor.time)}
			aria-valuetext="{formatClock(editor.time)} of {formatClock(editor.duration)}"
			tabindex="0"
			onpointerdown={seekFromBar}
		>
			<span class="fill" style:width="{(editor.time / Math.max(0.001, editor.duration)) * 100}%"
			></span>
		</div>
		<span class="clock mono">{formatClock(editor.time)} / {formatClock(editor.duration)}</span>
	</div>
</div>

<style>
	.watch {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: grid;
		place-items: center;
		background: var(--color-ink);
		color: var(--color-on-ink);
		animation: fade-in var(--dur) var(--ease-out);
	}
	.watch.hide-cursor {
		cursor: none;
	}
	.screen {
		display: block;
		cursor: pointer;
	}
	.top,
	.bottom {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		opacity: 0;
		transition: opacity var(--dur) var(--ease-out);
		pointer-events: none;
	}
	.top.visible,
	.bottom.visible {
		opacity: 1;
		pointer-events: auto;
	}
	.top {
		top: 0;
		justify-content: space-between;
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--color-ink) 70%, transparent),
			transparent
		);
	}
	.bottom {
		bottom: 0;
		background: linear-gradient(
			to top,
			color-mix(in srgb, var(--color-ink) 80%, transparent),
			transparent
		);
	}
	.title {
		font-size: var(--text-title);
	}
	.bar {
		position: relative;
		flex: 1;
		height: 6px;
		border-radius: var(--radius-pill);
		background: var(--color-ink-line);
		cursor: pointer;
	}
	.bar:focus-visible {
		box-shadow:
			0 0 0 2px var(--color-ink),
			0 0 0 4px var(--color-bg);
	}
	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: inherit;
		background: var(--color-bg);
	}
	.clock {
		font-size: var(--text-md);
		color: var(--color-on-ink-muted);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
