<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { beforeNavigate } from '$app/navigation';
	import { ACCEPT_VISUAL } from '$lib/media/kinds';
	import { dragHasFiles, pickFiles } from '$lib/media/picker';
	import { EditorStore } from '$lib/state/editor.svelte';
	import { provideEditor } from '$lib/state/context';
	import { trackPendingSave } from '$lib/state/library';
	import { droppedHandles, isProjectFile, projectOpener } from '$lib/files/opener.svelte';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Save from '@lucide/svelte/icons/save';
	import SaveAll from '@lucide/svelte/icons/save-all';
	import type { MenuItem } from '$lib/ui';
	import AddColumn from './AddColumn.svelte';
	import DropOverlay from './DropOverlay.svelte';
	import Inspector from './Inspector.svelte';
	import Stage from './Stage.svelte';
	import Storyboard from './Storyboard.svelte';
	import StoryboardDivider from './StoryboardDivider.svelte';
	import {
		readStoryboardHeight,
		storyboardHeight,
		storyboardLimits,
		TOPBAR_H,
		writeStoryboardHeight
	} from './layout';
	import Toasts from './Toasts.svelte';
	import SaveDialog from './SaveDialog.svelte';
	import ShortcutsDialog from './ShortcutsDialog.svelte';
	import WatchMode from './WatchMode.svelte';
	import TopBar from './TopBar.svelte';

	let { projectId, fresh = false }: { projectId: string; fresh?: boolean } = $props();

	// The page keys the editor by project, so each project gets its own store.
	// svelte-ignore state_referenced_locally
	const editor = provideEditor(new EditorStore(projectId, fresh));

	// The storyboard's height: chosen with the divider (remembered on this device) or the default,
	// always leaving the preview at least 40% of the window.
	let windowH = $state(typeof innerHeight === 'number' ? innerHeight : 800);
	let chosenHeight = $state(readStoryboardHeight());
	// The editor is never shorter than 640 px (it scrolls below that).
	const pageH = $derived(Math.max(640, windowH));
	const boardLimits = $derived(storyboardLimits(pageH, TOPBAR_H));
	const boardHeight = $derived(storyboardHeight(chosenHeight, pageH, TOPBAR_H));

	let saving = $state(false);
	let watching = $state(false);
	let showShortcuts = $state(false);

	// Leaving for the home screen or another project: store everything (and the picture on its
	// card) before the next page reads it.
	beforeNavigate(() => trackPendingSave(editor.close()));

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const fileItems: MenuItem[] = [
		{
			label: 'Open project file…',
			icon: FolderOpen,
			shortcut: isMac ? '⌘O' : 'Ctrl+O',
			onselect: () => void projectOpener.pickAndOpen()
		},
		{
			label: 'Save to file',
			icon: Save,
			shortcut: isMac ? '⌘S' : 'Ctrl+S',
			separator: true,
			onselect: () => void editor.saveToFile()
		},
		{
			label: 'Save as…',
			icon: SaveAll,
			shortcut: isMac ? '⇧⌘S' : 'Ctrl+Shift+S',
			onselect: () => void editor.saveToFile(true)
		}
	];

	onMount(() => {
		// Opening a file that replaces this very project: stop saving it, or it would win.
		const beforeReplace = (id: string) => (id === editor.projectId ? editor.freeze() : undefined);
		projectOpener.beforeReplace = beforeReplace;
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
			if (projectOpener.beforeReplace === beforeReplace) projectOpener.beforeReplace = null;
			// Leaving this project (e.g. for the home screen): store the latest changes and picture.
			trackPendingSave(editor.close());
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
		dragDepth = 0;
		// Already placed by the picture, the Layers track or the Scenes track.
		if (event.defaultPrevented) return;
		event.preventDefault();
		const files = Array.from(event.dataTransfer?.files ?? []);
		// A project file opens that project; photos, videos and sounds are added to this one.
		const index = files.findIndex(isProjectFile);
		if (index >= 0) {
			const handles = droppedHandles(event);
			void handles.then((all) => projectOpener.open(files[index], all[index] ?? undefined));
			return;
		}
		void editor.importFiles(files);
	}

	function isTyping(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
	}

	function onkeydown(event: KeyboardEvent) {
		// Project files: Ctrl/Cmd+S saves, Ctrl/Cmd+Shift+S saves as, Ctrl/Cmd+O opens. The
		// browser's own "Save page" and "Open file" never appear.
		const fileKey = event.key.toLowerCase();
		if ((event.metaKey || event.ctrlKey) && !event.altKey && (fileKey === 's' || fileKey === 'o')) {
			event.preventDefault();
			if (watching || saving || showShortcuts || editor.recording) return;
			// Finish typing (a title or words) first, so it's in what gets saved.
			if (isTyping(document.activeElement)) (document.activeElement as HTMLElement).blur();
			if (fileKey === 's') void editor.saveToFile(event.shiftKey);
			else void projectOpener.pickAndOpen();
			return;
		}

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
		// Copy, cut and paste items on tracks (text fields keep their own).
		if (mod && !event.altKey && !event.shiftKey && (key === 'c' || key === 'x' || key === 'v')) {
			if (isTyping(event.target) || editor.recording) return;
			// With keyframes selected, Ctrl/Cmd+C copies those rather than whole items.
			const done =
				key === 'c'
					? editor.selectedKeyframes.length
						? editor.copyKeyframes()
						: editor.copySelection()
					: key === 'x'
						? editor.cutSelection()
						: editor.paste();
			if (done) event.preventDefault();
			return;
		}
		// Ctrl/Cmd+L turns looping on or off (plain L stays free for playback keys).
		if (mod && !event.altKey && !event.shiftKey && key === 'l' && !isTyping(event.target)) {
			event.preventDefault();
			editor.toggleLoop();
			return;
		}
		// Alt/Option+X resets the range to the whole video (by key position: Option+X types a symbol on a Mac).
		if (event.altKey && !mod && event.code === 'KeyX' && !isTyping(event.target)) {
			event.preventDefault();
			editor.resetRange();
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
				// A selected sound clip, layer or words split; otherwise the scene under the playhead.
				if (editor.selectedSound) editor.splitSoundAtPlayhead();
				else if (editor.selectedOverlay || editor.selectedText) editor.splitItemAtPlayhead();
				else editor.splitAtPlayhead();
				break;
			case 'f':
			case 'F':
				// Save the frame at the playhead as a PNG.
				if (editor.project.scenes.length) {
					event.preventDefault();
					void editor.downloadFrame('png');
				}
				break;
			case 'i':
			case 'I':
				event.preventDefault();
				editor.setRangeStart();
				break;
			case 'o':
			case 'O':
				event.preventDefault();
				editor.setRangeEnd();
				break;
			case 'Delete':
			case 'Backspace':
				// Selected keyframes go first (their item stays).
				if (editor.selectedKeyframes.length) {
					event.preventDefault();
					editor.deleteSelectedKeyframes();
				} else if (editor.selectedId) {
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

<svelte:window bind:innerHeight={windowH} {ondragenter} {ondragover} {ondragleave} {ondrop} {onkeydown} />

<svelte:head>
	<title>{editor.notFound ? 'Scenes' : `${editor.project.title} · Scenes`}</title>
</svelte:head>

{#if editor.notFound}
	<div class="missing" role="alert">
		<h1 class="serif">This video isn’t here</h1>
		<p>It may have been deleted, or it was made in another browser.</p>
		<a class="back" href={resolve('/')}>Go to your videos</a>
	</div>
{/if}

<div class="editor" hidden={editor.notFound}>
	<TopBar
		onsave={() => (saving = true)}
		onwatch={() => {
			editor.player.unlockAudio();
			watching = true;
		}}
		onshortcuts={() => (showShortcuts = true)}
		{fileItems}
	/>

	<main class="workspace">
		<AddColumn onpick={pick} />
		<Stage onpick={pick} />
		<Inspector />
	</main>

	<StoryboardDivider
		height={boardHeight}
		min={boardLimits.min}
		max={boardLimits.max}
		onresize={(h) => {
			chosenHeight = h;
			writeStoryboardHeight(h);
		}}
		onreset={() => {
			chosenHeight = null;
			writeStoryboardHeight(null);
		}}
	/>

	<Storyboard onaddscene={pick} height={boardHeight} />
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
	.missing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		min-height: 100vh;
		text-align: center;
	}
	.missing h1 {
		font-size: var(--text-display);
		line-height: 1;
	}
	.missing p {
		color: var(--color-muted);
	}
	.back {
		margin-top: var(--space-3);
		padding: 10px 18px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-weight: var(--weight-medium);
		text-decoration: none;
	}
	.editor[hidden] {
		display: none;
	}
	.editor {
		display: grid;
		grid-template-rows: var(--topbar-h) minmax(0, 1fr) auto auto;
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
