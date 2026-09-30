<script lang="ts">
	import { resolve } from '$app/paths';
	import Download from '@lucide/svelte/icons/download';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import Scissors from '@lucide/svelte/icons/scissors';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Paintbrush from '@lucide/svelte/icons/paintbrush';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Clapperboard from '@lucide/svelte/icons/clapperboard';
	import Type from '@lucide/svelte/icons/type';
	import Music from '@lucide/svelte/icons/music';
	import Palette from '@lucide/svelte/icons/palette';
	import {
		Button,
		ChipGroup,
		Divider,
		Field,
		FloatingToolbar,
		IconButton,
		Panel,
		PillStepper,
		Slider,
		SwatchPicker
	} from '$lib/ui';
	import AddButton from '$lib/editor/AddButton.svelte';
	import SceneCard from '$lib/editor/SceneCard.svelte';
	import TransitionButton from '$lib/editor/TransitionButton.svelte';
	import { ASPECTS, MOODS, SPEEDS, TRANSITIONS } from '$lib/model/catalog';
	import { formatSeconds } from '$lib/model/time';
	import type { AspectRatio, MoodId } from '$lib/model/types';

	const colors = [
		['--color-bg', 'Background', '#ffffff'],
		['--color-surface', 'Soft surface', '#f2f2f4'],
		['--color-border', 'Border', '#e4e4e7'],
		['--color-ink', 'Ink', '#141417'],
		['--color-muted', 'Muted text', '#6b6b72'],
		['--color-accent', 'Accent', '#d63f1f']
	];

	let length = $state(4);
	let speed = $state(1);
	let aspect = $state<AspectRatio>('16:9');
	let mood = $state<MoodId>('golden');
	let volume = $state(0.7);
	let playing = $state(false);
	let panelOpen = $state(true);
	let lastAction = $state('—');

	const moodOptions = MOODS.map((m) => ({
		value: m.id,
		label: m.label,
		description: m.description,
		background: m.swatch
	}));
	const speedOptions = SPEEDS.map((s) => ({ ...s, value: s.value as number }));
	const aspectOptions = ASPECTS.map((a) => ({ value: a.id, label: a.label }));
	const toolbarActions = [
		{ id: 'edit', label: 'Edit words', icon: Pencil, onclick: () => (lastAction = 'Edit words') },
		{ id: 'style', label: 'Style', icon: Paintbrush, onclick: () => (lastAction = 'Style') },
		{ id: 'animate', label: 'Animate', icon: Sparkles, onclick: () => (lastAction = 'Animate') },
		{ id: 'remove', label: 'Remove', icon: Trash2, onclick: () => (lastAction = 'Remove') }
	];
</script>

<svelte:head>
	<title>Design · Scenes</title>
</svelte:head>

<div class="page">
	<header class="intro">
		<p class="eyebrow">Scenes</p>
		<h1 class="serif">Design system</h1>
		<p class="lede">
			Every building block of the editor, in one place. Clean, white and confident, with one
			tomato-red accent reserved for the playhead, selection and “Save video”.
		</p>
		<a href={resolve('/')}>Back to the editor</a>
	</header>

	<section aria-labelledby="colors">
		<h2 id="colors" class="serif">Colour</h2>
		<div class="colors">
			{#each colors as [token, name, hex] (token)}
				<div class="color">
					<span class="sample" style:background="var({token})"></span>
					<strong>{name}</strong>
					<code class="mono">{token}</code>
					<code class="mono muted">{hex}</code>
				</div>
			{/each}
		</div>
	</section>

	<section aria-labelledby="type">
		<h2 id="type" class="serif">Type</h2>
		<div class="type-specimens">
			<div>
				<p class="specimen-label">Instrument Serif italic — titles and headings</p>
				<p class="serif display">Summer in Split</p>
			</div>
			<div>
				<p class="specimen-label">Geist — interface</p>
				<p class="sans-sample">Drop photos or videos here to start your story.</p>
			</div>
			<div>
				<p class="specimen-label">Geist Mono — times and durations</p>
				<p class="mono mono-sample">0:12 of 0:31 · 4.5s</p>
			</div>
		</div>
	</section>

	<section aria-labelledby="buttons">
		<h2 id="buttons" class="serif">Buttons</h2>
		<div class="row">
			<Button variant="accent" icon={Download}>Save video</Button>
			<Button variant="outline" icon={Play}>Watch</Button>
			<Button variant="ink">Choose files</Button>
			<Button variant="soft" icon={Scissors}>Split here</Button>
			<Button variant="ghost" icon={Trash2}>Remove</Button>
			<Button variant="ink" disabled>Disabled</Button>
		</div>
		<div class="row">
			<Button size="sm" variant="soft">Small</Button>
			<Button size="md" variant="soft">Medium</Button>
			<Button size="lg" variant="soft">Large</Button>
		</div>
		<div class="row">
			<IconButton label="Undo" shortcut="⌘Z" icon={Undo2} />
			<IconButton label="Redo" shortcut="⇧⌘Z" icon={Redo2} />
			<IconButton label="Split" icon={Scissors} variant="soft" />
			<Divider />
			<IconButton
				label={playing ? 'Pause' : 'Play'}
				icon={playing ? Pause : Play}
				variant="ink"
				size="lg"
				onclick={() => (playing = !playing)}
			/>
			<IconButton label="Undo (disabled)" icon={Undo2} disabled />
		</div>
	</section>

	<section aria-labelledby="controls">
		<h2 id="controls" class="serif">Controls</h2>
		<div class="grid">
			<Field label="Pill stepper" hint={formatSeconds(length)}>
				<PillStepper
					label="Length"
					decreaseLabel="Shorter"
					increaseLabel="Longer"
					bind:value={length}
					min={0.5}
					max={20}
					step={0.5}
					format={formatSeconds}
				/>
			</Field>
			<Field label="Chip group" hint="{speed}×">
				<ChipGroup label="Speed" options={speedOptions} bind:value={speed} />
			</Field>
			<Field label="Segmented switch" hint={aspect}>
				<ChipGroup
					label="Video shape"
					variant="segmented"
					size="sm"
					options={aspectOptions}
					bind:value={aspect}
				/>
			</Field>
			<Field label="Slider">
				<Slider label="Volume" bind:value={volume} />
			</Field>
			<Field label="Swatch picker" hint={mood}>
				<SwatchPicker label="Mood" options={moodOptions} bind:value={mood} />
			</Field>
		</div>
	</section>

	<section aria-labelledby="surfaces">
		<h2 id="surfaces" class="serif">Panels & floating toolbar</h2>
		<div class="grid">
			<div>
				{#if panelOpen}
					<Panel
						title="Scene 1"
						subtitle="Beach · starts at 0:00"
						elevation="floating"
						onclose={() => (panelOpen = false)}
					>
						<Field label="Length">
							<PillStepper
								label="Length"
								bind:value={length}
								min={0.5}
								step={0.5}
								format={formatSeconds}
							/>
						</Field>
					</Panel>
				{:else}
					<Button variant="soft" onclick={() => (panelOpen = true)}>Show panel</Button>
				{/if}
			</div>
			<div class="toolbar-demo">
				<div class="fake-preview">
					<div class="fake-text">
						<FloatingToolbar label="Text options" actions={toolbarActions} />
						<span class="serif">Golden hour</span>
					</div>
				</div>
				<p class="muted">Last action: {lastAction}</p>
			</div>
		</div>
	</section>

	<section aria-labelledby="editor-parts">
		<h2 id="editor-parts" class="serif">Editor pieces</h2>
		<div class="add-grid">
			<AddButton icon={Clapperboard} label="Clips" hint="Photos & videos" />
			<AddButton icon={Type} label="Words" hint="Titles & captions" active />
			<AddButton icon={Music} label="Sound" hint="Music & voice" />
			<AddButton icon={Palette} label="Looks" hint="Color moods" />
		</div>
		<div class="cards">
			<div class="card-wrap" style:width="200px">
				<SceneCard
					index={0}
					name="Beach"
					duration={12}
					width={200}
					thumbnail="var(--mood-cool)"
					selected
				/>
			</div>
			<div class="card-wrap" style:width="150px">
				<SceneCard
					index={1}
					name="Market"
					duration={9}
					width={150}
					thumbnail="var(--mood-golden)"
				/>
			</div>
			<div class="transitions">
				{#each TRANSITIONS as t, i (t.id)}
					<TransitionButton kind={t.id} after={i + 1} />
				{/each}
			</div>
		</div>
	</section>
</div>

<style>
	.page {
		max-width: 1120px;
		margin: 0 auto;
		padding: var(--space-10) var(--space-6) 96px;
		display: flex;
		flex-direction: column;
		gap: 56px;
	}
	.intro {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.intro a {
		color: var(--color-ink);
		font-weight: var(--weight-medium);
	}
	.eyebrow {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	h1 {
		font-size: 64px;
		line-height: 1;
	}
	.lede {
		max-width: 56ch;
		font-size: var(--text-lg);
		color: var(--color-muted);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	h2 {
		font-size: 36px;
		line-height: 1;
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}
	.colors {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: var(--space-4);
	}
	.color {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--text-sm);
	}
	.sample {
		height: 72px;
		margin-bottom: var(--space-2);
		border-radius: var(--radius-card);
		border: 1px solid var(--color-border);
	}
	code {
		font-size: var(--text-xs);
	}
	.muted {
		color: var(--color-muted);
	}
	.type-specimens {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.specimen-label {
		font-size: var(--text-sm);
		color: var(--color-muted);
		margin-bottom: var(--space-1);
	}
	.display {
		font-size: var(--text-display);
		line-height: 1.05;
	}
	.sans-sample {
		font-size: 20px;
	}
	.mono-sample {
		font-size: 18px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: var(--space-8);
		align-items: start;
	}
	.toolbar-demo {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.fake-preview {
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 9;
		border-radius: var(--radius-preview);
		background: var(--mood-golden);
		box-shadow: var(--shadow-preview);
	}
	.fake-text {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
	}
	.fake-text .serif {
		padding: 2px 10px;
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
		border-radius: 6px;
		color: var(--color-bg);
		font-size: 40px;
	}
	.add-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 220px));
		gap: var(--space-3);
	}
	.cards {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.card-wrap {
		height: 104px;
		display: flex;
	}
	.transitions {
		display: flex;
		gap: var(--space-3);
	}
</style>
