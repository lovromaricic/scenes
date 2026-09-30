<script lang="ts">
	import { onMount } from 'svelte';
	import { ACCEPT_VISUAL } from '$lib/media/kinds';
	import { dragHasFiles, pickFiles } from '$lib/media/picker';
	import { EditorStore } from '$lib/state/editor.svelte';
	import { provideEditor } from '$lib/state/context';
	import AddColumn from './AddColumn.svelte';
	import DropOverlay from './DropOverlay.svelte';
	import Inspector from './Inspector.svelte';
	import Stage from './Stage.svelte';
	import Storyboard from './Storyboard.svelte';
	import Toasts from './Toasts.svelte';
	import TopBar from './TopBar.svelte';

	const editor = provideEditor(new EditorStore());

	const selectedScene = $derived(
		editor.placed.find((p) => p.scene.id === editor.selectedId) ?? null
	);
	const thumbnails = $derived(
		Object.fromEntries(
			editor.project.scenes.map((s) => {
				const url = editor.thumbnails[s.mediaId];
				return [s.id, url ? `url("${url}")` : 'none'];
			})
		)
	);

	// Keep the player in step with the project. It gets a plain snapshot, never the reactive proxy.
	$effect(() => {
		editor.syncPlayer();
	});

	onMount(() => {
		// Handy for tests and debugging in the console.
		(window as unknown as { __scenes: unknown }).__scenes = editor;
		return () => editor.player.dispose();
	});

	async function pick() {
		editor.player.unlockAudio();
		const files = await pickFiles(ACCEPT_VISUAL);
		await editor.importFiles(files);
	}

	// Drag and drop anywhere on the page.
	let dragDepth = $state(0);
	function ondragenter(event: DragEvent) {
		if (!dragHasFiles(event)) return;
		event.preventDefault();
		dragDepth++;
	}
	function ondragover(event: DragEvent) {
		if (!dragHasFiles(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}
	function ondragleave(event: DragEvent) {
		if (!dragHasFiles(event)) return;
		dragDepth = Math.max(0, dragDepth - 1);
	}
	function ondrop(event: DragEvent) {
		if (!dragHasFiles(event)) return;
		event.preventDefault();
		dragDepth = 0;
		const files = Array.from(event.dataTransfer?.files ?? []);
		void editor.importFiles(files);
	}

	function isTyping(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
	}

	function onkeydown(event: KeyboardEvent) {
		if (isTyping(event.target) || event.defaultPrevented) return;
		if (event.key === ' ' && !event.metaKey && !event.ctrlKey) {
			// Space always plays/pauses, even when a button has focus (Enter still presses buttons).
			event.preventDefault();
			if (editor.project.scenes.length) editor.togglePlay();
		}
	}
</script>

<svelte:window {ondragenter} {ondragover} {ondragleave} {ondrop} {onkeydown} />

<div class="editor">
	<TopBar
		title={editor.project.title}
		sceneCount={editor.project.scenes.length}
		duration={editor.duration}
	/>

	<main class="workspace">
		<AddColumn onpick={pick} />
		<Stage onpick={pick} />
		<Inspector
			scene={selectedScene?.scene ?? null}
			index={selectedScene?.index ?? 0}
			start={selectedScene?.start ?? 0}
			projectMood={editor.project.mood}
		/>
	</main>

	<Storyboard
		scenes={editor.project.scenes}
		texts={editor.project.texts}
		sounds={editor.project.sounds}
		time={editor.time}
		selectedId={editor.selectedId}
		{thumbnails}
		peaks={{}}
		importing={editor.importing}
		onselect={(id) => editor.select(id)}
		onseek={(t) => editor.seek(t)}
		onaddscene={pick}
	/>
</div>

{#if dragDepth > 0}
	<DropOverlay />
{/if}

<Toasts />

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
