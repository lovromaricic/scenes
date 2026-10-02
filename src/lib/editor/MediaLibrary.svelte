<!--
	@component
	"Your media": every photo, video and sound imported into the project. Click to select (Shift
	or Cmd/Ctrl-click for several), double-click to add, drag onto the storyboard or the picture,
	or right-click for more: add it, find it in the timeline, rename it (here only) or delete it.
	Deleting a file that's used asks first, and removes its uses too (one undo step). "Remove
	unused" clears the files nothing uses, for good, freeing their storage.
-->
<script lang="ts">
	import ImageIcon from '@lucide/svelte/icons/image';
	import Music from '@lucide/svelte/icons/music';
	import { MEDIA_DRAG_TYPE } from '$lib/media/dragTypes';
	import { formatBytes } from '$lib/export/presets';
	import { formatShort } from '$lib/model/time';
	import { useEditor } from '$lib/state/context';
	import { messages } from '$lib/state/messages.svelte';
	import { ConfirmDialog, Menu, type MenuItem } from '$lib/ui';
	import { portal } from '$lib/ui/portal';
	import { DELETE_SHORTCUT } from './itemMenu';
	import NameEditor from './NameEditor.svelte';

	const editor = useEditor();

	const items = $derived(editor.project.library.map((id) => editor.media[id]).filter((info) => !!info));
	const unused = $derived(editor.unusedMedia);

	/** Selected here (not on the storyboard): what the menu and the Delete key act on. */
	let selected = $state<string[]>([]);
	// Files that went (deleted, or undone away) aren't selected.
	$effect(() => {
		const present = editor.project.library;
		if (selected.some((id) => !present.includes(id))) selected = selected.filter((id) => present.includes(id));
	});
	let renaming = $state<string | null>(null);
	let menu = $state<{ items: MenuItem[]; x: number; y: number } | null>(null);
	let menuAnchor = $state<HTMLSpanElement>();
	let confirm = $state<{
		title: string;
		message: string;
		actions: { label: string; onclick: () => void }[];
	} | null>(null);

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const uses = (id: string) => editor.mediaUses([id]).length;
	const kindWord = (id: string) => ({ video: 'video', photo: 'photo', audio: 'sound' })[editor.media[id].kind];

	function ondragstart(event: DragEvent, id: string) {
		event.dataTransfer?.setData(MEDIA_DRAG_TYPE, id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
	}

	function onclick(event: MouseEvent, id: string) {
		if (event.shiftKey || event.metaKey || event.ctrlKey)
			selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
		else selected = [id];
	}

	/** Double-click: a picture becomes a scene at the end, a sound goes on an audio track. */
	function add(id: string) {
		if (editor.media[id].kind === 'audio') editor.addMediaToAudio(id);
		else editor.addSceneFromMedia(id);
	}

	function onkeydown(event: KeyboardEvent, id: string) {
		if (event.key === 'Delete' || event.key === 'Backspace') {
			// Here it deletes the file, not what's selected on the storyboard.
			event.preventDefault();
			event.stopPropagation();
			remove(selected.includes(id) ? selected : [id]);
		} else if (event.key === 'Escape' && selected.length) {
			event.stopPropagation();
			selected = [];
		}
	}

	/** Show where they're used, or say they aren't. */
	function show(ids: string[]) {
		if (!editor.showMediaInTimeline(ids)) messages.show('That isn’t used in the video.');
	}

	/** Delete: right away when nothing uses them (undoable); otherwise ask first. */
	function remove(ids: string[]) {
		const { uses: used, reason } = editor.mediaDeletion(ids);
		if (reason) {
			messages.show(reason);
			return;
		}
		if (!used.length) {
			editor.deleteMediaFiles(ids);
			return;
		}
		const one = ids.length === 1;
		confirm = {
			title: one ? `Delete “${editor.mediaName(ids[0])}”?` : `Delete ${ids.length} files?`,
			message: `${one ? 'This is' : 'These are'} used in ${plural(used.length, 'place')} in your video. Deleting ${one ? 'it' : 'them'} removes ${used.length === 1 ? 'that' : 'them'} too.`,
			actions: [
				{ label: 'Show in timeline', onclick: () => show(ids) },
				{ label: 'Delete', onclick: () => editor.deleteMediaFiles(ids) }
			]
		};
	}

	async function removeUnused() {
		const count = unused.length;
		const size = await editor.unusedMediaSize();
		confirm = {
			title: `Remove ${plural(count, 'unused file')}?`,
			message: `${count === 1 ? 'It goes' : 'They go'} from Your media${size ? `, freeing ${formatBytes(size)} of storage on this device` : ''}. This can’t be undone.`,
			actions: [
				{
					label: 'Remove',
					onclick: async () => {
						const done = await editor.removeUnusedMedia();
						messages.show(
							`Removed ${plural(done.removed, 'unused file')}${done.freed ? ` and freed ${formatBytes(done.freed)}` : ''}.`
						);
					}
				}
			]
		};
	}

	/** Right-click: select it (unless it's part of the selection), then its menu. */
	function oncontextmenu(event: MouseEvent, id: string) {
		event.preventDefault();
		if (!selected.includes(id)) selected = [id];
		menu = { items: menuItems(selected.includes(id) ? [...selected] : [id]), x: event.clientX, y: event.clientY };
	}

	function menuItems(ids: string[]): MenuItem[] {
		const infos = ids.map((id) => editor.media[id]);
		const one = ids.length === 1;
		const info = infos[0];
		const pictures = infos.every((i) => i.kind !== 'audio');
		const list: MenuItem[] = [];
		if (pictures)
			list.push({
				label: one ? 'Add as scene' : `Add ${ids.length} as scenes`,
				onselect: () => ids.forEach((id) => editor.addSceneFromMedia(id))
			});
		if (one && info.kind !== 'audio')
			list.push({ label: 'Add as layer at playhead', onselect: () => editor.addOverlayFromMedia(info.id) });
		if (one && (info.kind === 'audio' || info.hasAudio))
			list.push({ label: 'Add to audio track', onselect: () => editor.addMediaToAudio(info.id) });
		const used = editor.mediaUses(ids).length;
		list.push({
			label: 'Show in timeline',
			disabled: !used,
			hint: used ? undefined : 'Not used',
			onselect: () => show(ids)
		});
		if (one) list.push({ label: 'Rename', onselect: () => (renaming = info.id) });
		const reason = editor.mediaDeletion(ids).reason;
		list.push({
			label: one ? 'Delete' : `Delete ${ids.length} files`,
			shortcut: DELETE_SHORTCUT,
			separator: true,
			danger: true,
			disabled: !!reason,
			hint: reason,
			onselect: () => remove(ids)
		});
		return list;
	}
</script>

{#if items.length}
	<section class="library" aria-labelledby="library-title">
		<div class="head">
			<h2 id="library-title" class="serif heading">Your media</h2>
			{#if unused.length}
				<button type="button" class="clean" onclick={removeUnused}>Remove unused</button>
			{/if}
		</div>
		<p class="hint">Double-click to add, drag onto the storyboard or the picture, or right-click for more.</p>
		<ul class="grid">
			{#each items as info (info.id)}
				{@const thumb = editor.thumbnails[info.id]}
				{@const used = uses(info.id)}
				{@const name = editor.mediaName(info.id)}
				{@const isSelected = selected.includes(info.id)}
				<li>
					<button
						type="button"
						class="item"
						class:selected={isSelected}
						class:audio={info.kind === 'audio'}
						draggable={info.kind !== 'audio'}
						title={name}
						aria-label="{name}, {kindWord(info.id)}, {used ? `used in ${plural(used, 'place')}` : 'not used'}"
						aria-pressed={isSelected}
						data-media-id={info.id}
						onclick={(e) => onclick(e, info.id)}
						ondblclick={() => add(info.id)}
						oncontextmenu={(e) => oncontextmenu(e, info.id)}
						onkeydown={(e) => onkeydown(e, info.id)}
						ondragstart={(e) => ondragstart(e, info.id)}
					>
						{#if info.kind === 'audio'}
							<span class="thumb sound"><Music size={20} strokeWidth={1.6} aria-hidden="true" /></span>
						{:else}
							<span class="thumb" style:background-image={thumb ? `url("${thumb}")` : 'none'}></span>
						{/if}
						<span class="badge mono">
							{#if info.kind === 'photo'}<ImageIcon
									size={10}
									strokeWidth={2}
									aria-hidden="true"
								/>Photo{:else}{formatShort(info.duration - info.startTime)}{/if}
						</span>
						{#if !used}<span class="unused" aria-hidden="true">Not used</span>{/if}
					</button>
					{#if renaming === info.id}
						<NameEditor
							class="media-name-field"
							value={name}
							label="Name in Your media"
							onsave={(v) => {
								renaming = null;
								editor.renameMedia(info.id, v);
							}}
							oncancel={() => (renaming = null)}
						/>
					{:else}
						<span class="name" aria-hidden="true">{name}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if menu}
	<div use:portal>
		<span
			bind:this={menuAnchor}
			class="menu-anchor"
			style:left="{menu.x}px"
			style:top="{menu.y}px"
			aria-hidden="true"
		></span>
		{#if menuAnchor}
			<Menu label="Media" items={menu.items} anchor={menuAnchor} onclose={() => (menu = null)} />
		{/if}
	</div>
{/if}

{#if confirm}
	<ConfirmDialog
		title={confirm.title}
		message={confirm.message}
		actions={confirm.actions.map((a) => ({
			...a,
			onclick: () => {
				confirm = null;
				a.onclick();
			}
		}))}
		danger
		oncancel={() => (confirm = null)}
	/>
{/if}

<style>
	.library {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-height: 0;
		flex: 1;
		padding-top: var(--space-1);
		animation: fade-in var(--dur) var(--ease-out);
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.heading {
		font-size: 22px;
		line-height: 1;
	}
	.clean {
		padding: 2px 6px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--color-muted);
		font-size: var(--text-xs);
	}
	.clean:hover {
		background: var(--color-surface);
		color: var(--color-ink);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
		margin: 0;
		padding: 2px;
		list-style: none;
		overflow-y: auto;
		/* At least a row of tiles; below that the whole Add column scrolls. */
		min-height: 88px;
	}
	li {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.item {
		position: relative;
		display: block;
		width: 100%;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		overflow: hidden;
		cursor: grab;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.item.audio {
		cursor: pointer;
	}
	.item:hover {
		border-color: var(--color-muted);
	}
	.item.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}
	.item:active {
		transform: scale(0.97);
	}
	.thumb {
		display: block;
		aspect-ratio: 16 / 9;
		background-size: cover;
		background-position: center;
	}
	.thumb.sound {
		display: grid;
		place-items: center;
		color: var(--color-muted);
	}
	.badge {
		position: absolute;
		right: 4px;
		bottom: 4px;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: 10.5px;
	}
	.unused {
		position: absolute;
		left: 4px;
		top: 4px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--color-bg);
		color: var(--color-ink);
		font-size: 10.5px;
	}
	/* The name, and the field that replaces it while renaming (same place, no shift). */
	.name,
	li :global(.media-name-field) {
		height: 20px;
		margin: 0 -5px;
		padding: 0 4px;
		border: 1px solid transparent;
		font-size: var(--text-xs);
		line-height: 18px;
	}
	.name {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--color-muted);
	}
	li :global(.media-name-field) {
		border-color: var(--color-border);
		color: var(--color-ink);
	}
	.menu-anchor {
		position: fixed;
		width: 1px;
		height: 1px;
		pointer-events: none;
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
