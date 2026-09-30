<script lang="ts">
	import { MOODS } from '$lib/model/catalog';
	import { placeScenes, totalDuration } from '$lib/model/timeline';
	import type { AspectRatio } from '$lib/model/types';
	import AddColumn from './AddColumn.svelte';
	import Inspector from './Inspector.svelte';
	import Stage from './Stage.svelte';
	import Storyboard from './Storyboard.svelte';
	import TopBar from './TopBar.svelte';
	import { placeholderPeaks, placeholderProject } from './placeholder';

	// Phase 1: a static project to lay out the screen. Later phases swap in the live editor model.
	const project = placeholderProject;
	let aspect = $state<AspectRatio>(project.aspect);
	let time = $state(2);
	let selectedId = $state<string | null>('s1');
	let selectedTextId = $state<string | null>('t1');

	const duration = $derived(totalDuration(project.scenes));
	const placed = $derived(placeScenes(project.scenes));
	const selectedScene = $derived(placed.find((p) => p.scene.id === selectedId) ?? null);
	const current = $derived(placed.find((p) => time < p.end) ?? placed[placed.length - 1]);

	const swatchFor = (mood: string | null) =>
		MOODS.find((m) => m.id === (mood ?? project.mood))?.swatch ?? 'none';
	const thumbnails = Object.fromEntries(project.scenes.map((s) => [s.id, swatchFor(s.mood)]));
	const peaks = { m1: placeholderPeaks(400) };
</script>

<div class="editor">
	<TopBar title={project.title} sceneCount={project.scenes.length} {duration} canUndo />

	<main class="workspace">
		<AddColumn />
		<Stage
			bind:aspect
			{time}
			{duration}
			texts={project.texts}
			{selectedTextId}
			frameBackground={current ? swatchFor(current.scene.mood) : undefined}
		/>
		<Inspector
			scene={selectedScene?.scene ?? null}
			index={selectedScene?.index ?? 0}
			start={selectedScene?.start ?? 0}
			projectMood={project.mood}
		/>
	</main>

	<Storyboard
		scenes={project.scenes}
		texts={project.texts}
		sounds={project.sounds}
		{time}
		{selectedId}
		{thumbnails}
		{peaks}
		onselect={(id) => {
			selectedId = id;
			selectedTextId = project.texts.some((t) => t.id === id) ? id : null;
		}}
		onseek={(t) => (time = t)}
	/>
</div>

<style>
	.editor {
		display: grid;
		grid-template-rows: var(--topbar-h) minmax(0, 1fr) auto;
		height: 100dvh;
		min-height: 640px;
		overflow: hidden;
	}
	.workspace {
		display: grid;
		grid-template-columns: var(--add-col-w) minmax(0, 1fr) var(--inspector-w);
		min-height: 0;
	}
</style>
