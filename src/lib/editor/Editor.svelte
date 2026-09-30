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
	import SaveDialog from './SaveDialog.svelte';
	import ShortcutsDialog from './ShortcutsDialog.svelte';
	import WatchMode from './WatchMode.svelte';
	import TopBar from './TopBar.svelte';

	let { projectId, fresh = false }: { projectId: string; fresh?: boolean } = $props();

	// The page keys the editor by project, so each project gets its own store.
	// svelte-ignore state_referenced_locally
	const editor = provideEditor(new EditorStore(projectId, fresh));

	let saving = $state(false);
	let watching = $state(false);
	let showShortcuts = $state(false);

	onMount(() => {
		// Handy for tests and debugging in the console.
		(window as unknown as { __scenes: unknown }).__scenes = editor;
		void editor.load();
		const save = () => void editor.flushSave();
		const onVisibility = () => document.visibilityState === 'hidden' && save();
		window.addEventListener('pagehide', save);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.removeEventListener('pagehide', save);
			document.removeEventListener('visibilitychange', onVisibility);
			// Leaving this project (e.g. for the home screen): store the latest changes.
			save();
			editor.player.dispose();
		};
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
		void editor.importFiles(Array.from(event.dataTransfer?.files ?? []));
	}

	function isTyping(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
	}

	function onkeydown(event: KeyboardEvent) {
		// Full-screen watching and dialogs handle their own keys.
		if (watching || saving || showShortcuts) return;

		// Crop mode: Enter applies, Esc cancels; editing shortcuts wait until it's done.
		if (editor.cropping) {
			if (event.key === 'Enter') {
				// Enter on a focused button in the crop panel presses it (e.g. Cancel), not Done.
				if ((event.target as HTMLElement).closest('.inspector button')) return;
				event.preventDefault();
				editor.applyCrop();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				editor.cancelCrop();
			} else if (event.key === ' ') {
				event.preventDefault();
			} else if (
				!isTyping(event.target) &&
				(event.key === 'ArrowLeft' || event.key === 'ArrowRight')
			) {
				// Scrubbing still works, to check other moments of the clip.
				event.preventDefault();
				editor.nudge((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 1 / 30));
			}
			return;
		}
		const mod = event.metaKey || event.ctrlKey;
		const key = event.key.toLowerCase();

		// Undo/redo work everywhere except inside text fields (which have their own undo).
		if (mod && !event.altKey && (key === 'z' || key === 'y')) {
			if (isTyping(event.target)) return;
			event.preventDefault();
			if (key === 'y' || event.shiftKey) editor.redo();
			else editor.undo();
			return;
		}
		if (mod || event.altKey || isTyping(event.target) || event.defaultPrevented) return;

		// While recording a voiceover, Space or Esc stops it; nothing else happens.
		if (editor.recording) {
			if (event.key === ' ' || event.key === 'Escape') {
				event.preventDefault();
				void editor.stopVoiceover();
			}
			return;
		}

		switch (event.key) {
			case '?':
				event.preventDefault();
				showShortcuts = true;
				break;
			case ' ':
				// Space always plays/pauses, even when a button has focus (Enter still presses buttons).
				event.preventDefault();
				if (editor.project.scenes.length) editor.togglePlay();
				break;
			case 'c':
			case 'C':
				event.preventDefault();
				editor.enterCrop();
				break;
			case 's':
			case 'S':
				event.preventDefault();
				editor.splitAtPlayhead();
				break;
			case 'Delete':
			case 'Backspace':
				if (editor.selectedId) {
					event.preventDefault();
					editor.deleteSelected();
				}
				break;
			case 'ArrowLeft':
			case 'ArrowRight': {
				event.preventDefault();
				const step = event.shiftKey ? 1 : 1 / 30;
				editor.nudge(event.key === 'ArrowLeft' ? -step : step);
				break;
			}
			case 'Home':
				event.preventDefault();
				editor.seek(0);
				break;
			case 'End':
				event.preventDefault();
				editor.seek(editor.duration);
				break;
			case 'Escape':
				editor.select(null);
				break;
		}
	}
</script>

<svelte:window {ondragenter} {ondragover} {ondragleave} {ondrop} {onkeydown} />

<div class="editor">
	<TopBar
		onsave={() => (saving = true)}
		onwatch={() => {
			editor.player.unlockAudio();
			watching = true;
		}}
		onshortcuts={() => (showShortcuts = true)}
	/>

	<main class="workspace">
		<AddColumn onpick={pick} />
		<Stage onpick={pick} />
		<Inspector />
	</main>

	<Storyboard onaddscene={pick} />
</div>

{#if dragDepth > 0}
	<DropOverlay />
{/if}

{#if watching}
	<WatchMode onclose={() => (watching = false)} />
{/if}

{#if showShortcuts}
	<ShortcutsDialog onclose={() => (showShortcuts = false)} />
{/if}

{#if saving}
	<SaveDialog onclose={() => (saving = false)} />
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
