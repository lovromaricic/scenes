<script lang="ts">
	import Scissors from '@lucide/svelte/icons/scissors';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button, ChipGroup, Field, PillStepper, Slider, SwatchPicker } from '$lib/ui';
	import { MOODS, SPEEDS } from '$lib/model/catalog';
	import { maxLength, MIN_SCENE } from '$lib/model/edits';
	import { formatClock, formatSeconds } from '$lib/model/time';
	import type { MoodId, Speed } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import TextInspector from './TextInspector.svelte';
	import SoundInspector from './SoundInspector.svelte';

	const editor = useEditor();

	const moodOptions = MOODS.map((m) => ({
		value: m.id,
		label: m.label,
		description: m.description,
		background: m.swatch
	}));
	const speedOptions = SPEEDS.map((s) => ({ ...s, value: s.value as Speed }));

	const placed = $derived(editor.selectedScene);
	const scene = $derived(placed?.scene ?? null);
	const max = $derived(scene ? maxLength(scene, editor.bounds(scene)) : 60);
	const playheadInside = $derived(
		!!placed &&
			editor.time > placed.start + MIN_SCENE / 2 &&
			editor.time < placed.end - MIN_SCENE / 2
	);
</script>

<aside class="inspector" aria-label="Settings">
	{#if editor.selectedSound}
		{#key editor.selectedSound.id}
			<SoundInspector sound={editor.selectedSound} />
		{/key}
	{:else if editor.selectedText}
		{#key editor.selectedText.id}
			<TextInspector item={editor.selectedText} />
		{/key}
	{:else if scene && placed}
		{#key scene.id}
			<div class="head">
				<h2 class="serif title">Scene {placed.index + 1}</h2>
				<p class="subtitle">
					{scene.name} · starts at <span class="mono">{formatClock(placed.start)}</span>
				</p>
			</div>

			<div class="fields">
				<Field label="Length">
					<PillStepper
						label="Length"
						decreaseLabel="Shorter"
						increaseLabel="Longer"
						value={Math.round(placed.duration * 10) / 10}
						min={Math.min(MIN_SCENE, max)}
						max={Math.floor(max * 10) / 10}
						step={0.5}
						format={formatSeconds}
						onchange={(v) => editor.setSceneLength(scene.id, v)}
					/>
				</Field>

				{#if scene.kind === 'video'}
					<Field label="Speed">
						<ChipGroup
							label="Speed"
							options={speedOptions}
							value={scene.speed}
							onchange={(v) => editor.setSceneSpeed(scene.id, v)}
						/>
					</Field>
				{/if}

				<Field
					label="Mood"
					hint={scene.mood === null ? 'Same as the whole video' : 'This scene only'}
				>
					<SwatchPicker
						label="Mood"
						options={moodOptions}
						value={scene.mood ?? editor.project.mood}
						onchange={(v: MoodId) => editor.setSceneMood(scene.id, v)}
					/>
					{#if scene.mood !== null}
						<button type="button" class="link" onclick={() => editor.setSceneMood(scene.id, null)}>
							Match the whole video
						</button>
					{/if}
				</Field>

				{#if scene.kind === 'video' && editor.media[scene.mediaId]?.hasAudio}
					<Field label="Clip sound">
						<Slider
							label="Clip sound volume"
							value={scene.volume}
							oninput={(v) => editor.setSceneVolume(scene.id, v)}
						/>
					</Field>
				{/if}
			</div>

			<div class="actions">
				<Button
					variant="soft"
					size="sm"
					icon={Scissors}
					disabled={!playheadInside}
					title="Split at the playhead (S)"
					onclick={() => editor.splitAtPlayhead()}>Split here</Button
				>
				<Button
					variant="ghost"
					size="sm"
					icon={Trash2}
					title="Remove this scene (Delete)"
					onclick={() => editor.deleteScene(scene.id)}>Remove</Button
				>
			</div>
		{/key}
	{:else}
		<div class="head">
			<h2 class="serif title">Nothing selected</h2>
			<p class="subtitle">
				{editor.project.scenes.length
					? 'Pick a scene below to change its length, speed or mood.'
					: 'Add photos or videos to get started.'}
			</p>
		</div>
	{/if}
</aside>

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-6) var(--space-6) var(--space-5) var(--space-4);
		overflow-y: auto;
	}
	.head,
	.fields,
	.actions {
		animation: fade-in var(--dur) var(--ease-out);
	}
	.title {
		font-size: var(--text-heading);
		line-height: 1;
	}
	.subtitle {
		margin-top: var(--space-2);
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--color-ink);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		text-decoration: underline;
		text-underline-offset: 3px;
		border-radius: 4px;
	}
	.link:hover {
		color: var(--color-muted);
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
