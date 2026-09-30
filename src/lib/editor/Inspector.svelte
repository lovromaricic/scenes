<script lang="ts">
	import Scissors from '@lucide/svelte/icons/scissors';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button, ChipGroup, Field, PillStepper, Slider, SwatchPicker } from '$lib/ui';
	import { MOODS, SPEEDS } from '$lib/model/catalog';
	import { formatClock, formatSeconds } from '$lib/model/time';
	import { sceneDuration } from '$lib/model/timeline';
	import type { MoodId, Scene, Speed } from '$lib/model/types';

	interface Props {
		scene: Scene | null;
		index: number;
		start: number;
		projectMood: MoodId;
	}

	let { scene, index, start, projectMood }: Props = $props();

	const moodOptions = MOODS.map((m) => ({
		value: m.id,
		label: m.label,
		description: m.description,
		background: m.swatch
	}));
	const speedOptions = SPEEDS.map((s) => ({ ...s, value: s.value as Speed }));

	// Phase 1: local state only. Phase 3 wires these to the editor model.
	let length = $state(0);
	let speed = $state<Speed>(1);
	let mood = $state<MoodId>('natural');
	let volume = $state(1);

	$effect.pre(() => {
		if (!scene) return;
		length = sceneDuration(scene);
		speed = scene.speed;
		mood = scene.mood ?? projectMood;
		volume = scene.volume;
	});
</script>

<aside class="inspector" aria-label="Settings">
	{#if scene}
		<div class="head">
			<h2 class="serif title">Scene {index + 1}</h2>
			<p class="subtitle">
				{scene.name} · starts at <span class="mono">{formatClock(start)}</span>
			</p>
		</div>

		<div class="fields">
			<Field label="Length">
				<PillStepper
					label="Length"
					decreaseLabel="Shorter"
					increaseLabel="Longer"
					bind:value={length}
					min={0.5}
					max={60}
					step={0.5}
					format={formatSeconds}
				/>
			</Field>

			{#if scene.kind === 'video'}
				<Field label="Speed">
					<ChipGroup label="Speed" options={speedOptions} bind:value={speed} />
				</Field>
			{/if}

			<Field label="Mood">
				<SwatchPicker label="Mood" options={moodOptions} bind:value={mood} />
			</Field>

			{#if scene.kind === 'video'}
				<Field label="Clip sound">
					<Slider label="Clip sound volume" bind:value={volume} />
				</Field>
			{/if}
		</div>

		<div class="actions">
			<Button variant="soft" size="sm" icon={Scissors}>Split here</Button>
			<Button variant="ghost" size="sm" icon={Trash2}>Remove</Button>
		</div>
	{:else}
		<div class="head">
			<h2 class="serif title">Nothing selected</h2>
			<p class="subtitle">Pick a scene, caption or sound to change it.</p>
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
