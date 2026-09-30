<script lang="ts">
	import Upload from '@lucide/svelte/icons/upload';
	import Heading from '@lucide/svelte/icons/heading';
	import Captions from '@lucide/svelte/icons/captions';
	import Music from '@lucide/svelte/icons/music';
	import Mic from '@lucide/svelte/icons/mic';
	import { Button, Panel, SwatchPicker } from '$lib/ui';
	import { MOODS } from '$lib/model/catalog';
	import type { MoodId } from '$lib/model/types';
	import type { AddKind } from './types';

	interface Props {
		kind: AddKind;
		onclose: () => void;
	}

	let { kind, onclose }: Props = $props();

	let mood = $state<MoodId>('natural');
	const moodOptions = MOODS.map((m) => ({
		value: m.id,
		label: m.label,
		description: m.description,
		background: m.swatch
	}));

	const titles: Record<AddKind, { title: string; subtitle: string }> = {
		clips: { title: 'Clips', subtitle: 'Each photo or video becomes a scene.' },
		words: { title: 'Words', subtitle: 'Put text on your video.' },
		sound: { title: 'Sound', subtitle: 'Add music or record your voice.' },
		looks: { title: 'Looks', subtitle: 'A colour mood for the whole video.' }
	};
</script>

<Panel
	title={titles[kind].title}
	subtitle={titles[kind].subtitle}
	elevation="floating"
	{onclose}
	headingLevel={3}
>
	{#if kind === 'clips'}
		<div class="drop">
			<Upload size={22} strokeWidth={1.7} aria-hidden="true" />
			<p><strong>Drop photos or videos here</strong></p>
			<p class="muted">MP4, MOV, WebM, JPG, PNG</p>
			<Button variant="ink" size="sm">Choose files</Button>
		</div>
	{:else if kind === 'words'}
		<div class="options">
			<button type="button" class="option">
				<Heading size={20} strokeWidth={1.7} aria-hidden="true" />
				<span><strong>Title</strong><small>Big words in the middle</small></span>
			</button>
			<button type="button" class="option">
				<Captions size={20} strokeWidth={1.7} aria-hidden="true" />
				<span><strong>Caption</strong><small>A line near the bottom</small></span>
			</button>
		</div>
	{:else if kind === 'sound'}
		<div class="options">
			<button type="button" class="option">
				<Music size={20} strokeWidth={1.7} aria-hidden="true" />
				<span><strong>Music</strong><small>Choose a song file</small></span>
			</button>
			<button type="button" class="option">
				<Mic size={20} strokeWidth={1.7} aria-hidden="true" />
				<span><strong>Voiceover</strong><small>Record at the playhead</small></span>
			</button>
		</div>
	{:else}
		<SwatchPicker label="Mood for the whole video" options={moodOptions} bind:value={mood} />
	{/if}
</Panel>

<style>
	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-6) var(--space-4);
		border: 1.5px dashed var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-surface);
		text-align: center;
	}
	.drop :global(.btn) {
		margin-top: var(--space-3);
	}
	.muted {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.option {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		text-align: left;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.option:hover {
		border-color: var(--color-muted);
	}
	.option span {
		display: flex;
		flex-direction: column;
	}
	.option small {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
</style>
