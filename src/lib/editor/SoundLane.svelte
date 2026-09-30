<!--
	@component
	The Sound lane: the music on the first row and voiceovers below it, each with its waveform.
	Drag a sound to move it in time.
-->
<script lang="ts">
	import { DragScope } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';

	/** Every drag ends on release, cancel, lost capture or a move with no button (see drag.ts). */
	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	import Music from '@lucide/svelte/icons/music';
	import Mic from '@lucide/svelte/icons/mic';
	import { soundEnd } from '$lib/audio/clips';
	import { formatShort } from '$lib/model/time';
	import type { SoundItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import Waveform from './Waveform.svelte';
	import type { TimeMap } from './scale';

	interface Props {
		map: TimeMap;
		rows: Record<string, number>;
		rowHeight: number;
	}

	let { map, rows, rowHeight }: Props = $props();

	const editor = useEditor();

	let gesture = $state<{
		id: string;
		pointerId: number;
		startX: number;
		start0: number;
		active: boolean;
	} | null>(null);

	function onpointerdown(event: PointerEvent, sound: SoundItem) {
		if (event.button !== 0) return;
		gesture = {
			id: sound.id,
			pointerId: event.pointerId,
			startX: event.clientX,
			start0: sound.start,
			active: false
		};
		drags.start(event, { move: onpointermove, end: onend });
	}

	function onpointermove(event: PointerEvent) {
		const g = gesture;
		if (!g || event.pointerId !== g.pointerId) return;
		const dx = event.clientX - g.startX;
		if (!g.active) {
			if (Math.abs(dx) < 3) return;
			g.active = true;
			editor.beginGesture();
		}
		const start = Math.min(Math.max(0, map.t(map.x(g.start0) + dx)), Math.max(0, editor.duration - 0.5));
		editor.live((p) => {
			const s = p.sounds.find((s) => s.id === g.id);
			if (s) s.start = start;
		});
	}

	function onend() {
		const g = gesture;
		if (!g) return;
		gesture = null;
		if (g.active) editor.endGesture('Move sound');
		else editor.select(g.id);
	}
</script>

{#each editor.project.sounds as sound (sound.id)}
	{@const end = soundEnd(sound, editor.duration)}
	{@const length = Math.max(0, end - sound.start)}
	{@const wave = editor.waveforms[sound.mediaId]}
	{@const selected = editor.selectedId === sound.id}
	<button
		type="button"
		class="sound {sound.kind}"
		class:selected
		class:active={gesture?.active && gesture.id === sound.id}
		style:left="{map.x(sound.start)}px"
		style:width="{map.width(sound.start, length) - 3}px"
		title={sound.name}
		class:narrow={map.width(sound.start, length) < 64}
		style:top="{3 + (rows[sound.id] ?? 0) * rowHeight}px"
		style:height="{rowHeight - 4}px"
		aria-label="{sound.kind === 'music' ? 'Music' : 'Voiceover'}: {sound.name}, {formatShort(
			length
		)}"
		aria-pressed={selected}
		onpointerdown={(e) => onpointerdown(e, sound)}
		onclick={(e) => {
			if (e.detail === 0) editor.select(sound.id);
		}}
	>
		{#if wave}
			<Waveform peaks={wave.peaks} perSecond={wave.perSecond} from={sound.sourceStart} {length} />
		{/if}
		{#if sound.fade && sound.kind === 'music'}
			<span class="fade in" aria-hidden="true"></span>
			<span class="fade out" aria-hidden="true"></span>
		{/if}
		<span class="name">
			{#if sound.kind === 'music'}<Music size={11} strokeWidth={2} aria-hidden="true" />{:else}<Mic
					size={11}
					strokeWidth={2}
					aria-hidden="true"
				/>{/if}
			{sound.name}
		</span>
	</button>
{/each}

<style>
	.sound {
		position: absolute;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		overflow: hidden;
		text-align: left;
		cursor: grab;
		touch-action: none;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.sound:hover {
		border-color: var(--color-muted);
	}
	.sound.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}
	.sound.active {
		cursor: grabbing;
		box-shadow: var(--shadow-float);
	}
	.narrow .name {
		display: none;
	}
	.name {
		position: absolute;
		top: 3px;
		left: 6px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: calc(100% - 12px);
		padding: 0 5px;
		border-radius: 4px;
		background: var(--color-bg);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Fade ramps drawn as soft wedges at each end. */
	.fade {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 28px;
		pointer-events: none;
	}
	.fade.in {
		left: 0;
		background: linear-gradient(to right, var(--color-bg), transparent);
	}
	.fade.out {
		right: 0;
		background: linear-gradient(to left, var(--color-bg), transparent);
	}
</style>
