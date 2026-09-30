<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button, Field, PillStepper, Slider, Switch } from '$lib/ui';
	import { MUSIC_FADE_IN, MUSIC_FADE_OUT, soundEnd } from '$lib/audio/clips';
	import { formatClock, formatSeconds } from '$lib/model/time';
	import type { SoundItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';

	let { sound }: { sound: SoundItem } = $props();

	const editor = useEditor();

	const info = $derived(editor.media[sound.mediaId]);
	const isMusic = $derived(sound.kind === 'music');
	const offset = $derived(info ? sound.sourceStart - info.startTime : 0);
	const plays = $derived(Math.max(0, soundEnd(sound, editor.duration) - sound.start));
</script>

<div class="head">
	<h2 class="serif title">{isMusic ? 'Music' : 'Voiceover'}</h2>
	<p class="subtitle">
		{sound.name} · plays for <span class="mono">{formatClock(plays)}</span>
		{#if isMusic && info && sound.duration < editor.duration - sound.start}
			<br />The song is shorter than your video, so the end is quiet.
		{/if}
	</p>
</div>

<div class="fields">
	<Field label="Volume">
		<Slider
			label="{isMusic ? 'Music' : 'Voiceover'} volume"
			value={sound.volume}
			oninput={(v) => editor.setSoundVolume(sound.id, v)}
		/>
	</Field>

	{#if isMusic}
		<Switch
			label="Fade in and out"
			hint="Eases the music in at the start and out at the end"
			checked={sound.fade}
			onchange={(on) => editor.setSoundFade(sound.id, on)}
		/>
		{#if info}
			<Field label="Start the song at">
				<PillStepper
					label="Song start"
					decreaseLabel="Earlier in the song"
					increaseLabel="Later in the song"
					value={Math.round(offset * 2) / 2}
					min={0}
					max={Math.max(0, Math.floor(info.duration - info.startTime - 1))}
					step={0.5}
					format={formatSeconds}
					onchange={(v) => editor.setMusicOffset(sound.id, v)}
				/>
			</Field>
		{/if}
		<p class="note">
			Music fades over {MUSIC_FADE_IN}s at the start and {MUSIC_FADE_OUT}s at the end. It stops when
			the video ends.
		</p>
	{:else}
		<p class="note">Drag it in the Sound lane to change when it plays.</p>
	{/if}
</div>

<div class="actions">
	<Button variant="ghost" size="sm" icon={Trash2} onclick={() => editor.deleteSound(sound.id)}>
		Remove
	</Button>
</div>

<style>
	.title {
		font-size: var(--text-heading);
		line-height: 1;
	}
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
