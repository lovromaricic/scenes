<!--
	@component
	Settings for the selected sound clip (music or a voiceover): when it starts, how long it plays,
	volume, fade in and out, and Split here / Remove.
-->
<script lang="ts">
	import NameTitle from './NameTitle.svelte';
	import Scissors from '@lucide/svelte/icons/scissors';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button, Field, PillStepper, Slider } from '$lib/ui';
	import { MAX_FADE, MIN_SOUND, soundEnd } from '$lib/model/sound';
	import { formatClock } from '$lib/model/time';
	import type { SoundItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';

	let { sound }: { sound: SoundItem } = $props();

	const editor = useEditor();

	const isMusic = $derived(sound.kind === 'music');
	const bounds = $derived(editor.soundBounds(sound));
	const plays = $derived(Math.max(0, soundEnd(sound, editor.duration) - sound.start));
	const playheadInside = $derived(
		editor.time > sound.start + MIN_SOUND && editor.time < sound.start + sound.duration - MIN_SOUND
	);
	const fadeLabel = (v: number) => (v === 0 ? 'None' : `${v.toFixed(1)} s`);
</script>

<div class="head">
	<NameTitle prefix={isMusic ? 'Music' : 'Voiceover'} item={sound} />
	<p class="subtitle">
		{sound.name} · plays for <span class="mono">{formatClock(plays)}</span>
		{#if sound.start + sound.duration > editor.duration + 0.05}
			<br />It stops when the video ends.
		{/if}
	</p>
</div>

<div class="fields">
	<Field label="Starts at">
		<PillStepper
			label="Sound starts at"
			decreaseLabel="Earlier"
			increaseLabel="Later"
			value={Math.round(sound.start * 10) / 10}
			min={0}
			max={Math.max(0, editor.duration - MIN_SOUND)}
			step={0.5}
			format={(v) => formatClock(v)}
			onchange={(v) =>
				editor.setSoundTiming(sound.id, { start: v, sourceStart: sound.sourceStart, duration: sound.duration }, undefined, 'Move sound')}
		/>
	</Field>
	<Field label="Length">
		<PillStepper
			label="Sound length"
			decreaseLabel="Shorter"
			increaseLabel="Longer"
			value={Math.round(sound.duration * 10) / 10}
			min={MIN_SOUND}
			max={bounds.end - sound.sourceStart}
			step={0.5}
			format={(v) => formatClock(v)}
			onchange={(v) =>
				editor.setSoundTiming(sound.id, { start: sound.start, sourceStart: sound.sourceStart, duration: v }, undefined, 'Trim sound')}
		/>
	</Field>
	<Field label="Volume">
		<Slider
			label="{isMusic ? 'Music' : 'Voiceover'} volume"
			value={sound.volume}
			oninput={(v) => editor.setSoundVolume(sound.id, v)}
		/>
	</Field>
	<Field label="Fade in">
		<Slider
			label="Fade in"
			value={sound.fadeIn}
			min={0}
			max={MAX_FADE}
			step={0.1}
			format={fadeLabel}
			oninput={(v) => editor.setSoundFades(sound.id, v, sound.fadeOut, `fade-in:${sound.id}`)}
		/>
	</Field>
	<Field label="Fade out">
		<Slider
			label="Fade out"
			value={sound.fadeOut}
			min={0}
			max={MAX_FADE}
			step={0.1}
			format={fadeLabel}
			oninput={(v) => editor.setSoundFades(sound.id, sound.fadeIn, v, `fade-out:${sound.id}`)}
		/>
	</Field>
	<p class="note">Drag the ends in the Sound lane to trim it, and the dots at its top corners to set the fades.</p>
</div>

<div class="actions">
	<Button
		variant="soft"
		size="sm"
		icon={Scissors}
		disabled={!playheadInside}
		title="Split at the playhead (S)"
		onclick={() => editor.splitSoundAtPlayhead(sound.id)}>Split here</Button
	>
	<Button variant="ghost" size="sm" icon={Trash2} onclick={() => editor.deleteSound(sound.id)}>
		Remove
	</Button>
</div>

<style>
	.subtitle {
		margin-top: var(--space-2);
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.head,
	.fields,
	.actions {
		animation: fade-in var(--dur) var(--ease-out);
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.note {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
