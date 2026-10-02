<script lang="ts">
	import { resolve } from '$app/paths';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import Play from '@lucide/svelte/icons/play';
	import Download from '@lucide/svelte/icons/download';
	import Check from '@lucide/svelte/icons/check';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import { goto } from '$app/navigation';
	import { Button, Divider, IconButton, Logo, Menu, type MenuItem } from '$lib/ui';
	import { newId } from '$lib/state/project';
	import { formatLength, pluralize } from '$lib/model/time';
	import { useEditor } from '$lib/state/context';
	import { formatLabel } from '$lib/model/format';
	import FormatPanel from './FormatPanel.svelte';

	interface Props {
		onwatch?: () => void;
		onsave?: () => void;
		onshortcuts?: () => void;
		/** Extra items for the video menu (project files), placed after New video. */
		fileItems?: MenuItem[];
	}

	let { onwatch, onsave, onshortcuts, fileItems = [] }: Props = $props();

	let menuButton = $state<HTMLButtonElement>();
	let menuOpen = $state(false);
	const menuItems: MenuItem[] = $derived([
		{
			label: 'New video',
			icon: FilePlus,
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- the path is resolve()d; only a query is added
			onselect: () => void goto(`${resolve('/edit/[id]', { id: newId() })}?new=1`)
		},
		...fileItems,
		{
			label: 'Back to projects',
			icon: LayoutGrid,
			separator: true,
			onselect: () => void goto(resolve('/'))
		}
	]);

	const editor = useEditor();

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const mod = isMac ? '⌘' : 'Ctrl+';

	let formatPanel = $state<{ x: number; y: number } | null>(null);

	function toggleFormat(event: MouseEvent) {
		if (formatPanel) {
			formatPanel = null;
			return;
		}
		const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
		formatPanel = { x: r.left, y: r.bottom };
	}

	let editing = $state(false);
	let draft = $state('');
	let input = $state<HTMLInputElement>();

	function startEditing() {
		draft = editor.project.title;
		editing = true;
		requestAnimationFrame(() => input?.select());
	}

	function finish(save: boolean) {
		if (!editing) return;
		editing = false;
		if (save) editor.setTitle(draft);
	}

	const autosaveLabel = $derived(
		{
			idle: '',
			saving: 'Saving…',
			saved: 'Saved on this device',
			error: 'Couldn’t save — retrying'
		}[editor.saveStatus]
	);
	// The project file's status comes first once there is one (the device copy is always kept).
	const saveLabel = $derived.by(() => {
		if (editor.saveStatus === 'error') return autosaveLabel;
		if (editor.fileSaving !== null) return `Saving to file… ${Math.round(editor.fileSaving * 100)}%`;
		if (editor.fileStatus === 'saved') return `Saved to ${editor.fileLink!.name}`;
		if (editor.fileStatus === 'changed') return 'Unsaved changes in file';
		return autosaveLabel;
	});
	const saved = $derived(
		editor.saveStatus !== 'error' &&
			editor.fileSaving === null &&
			(editor.fileStatus === 'saved' || (!editor.fileStatus && editor.saveStatus === 'saved'))
	);
</script>

<header class="topbar">
	<div class="project">
		<a class="brand" href={resolve('/')} aria-label="Scenes" title="Your videos">
			<Logo />
		</a>
		<a class="projects-link" href={resolve('/')}>Projects</a>
		<span class="crumb" aria-hidden="true">/</span>
		{#if editing}
			<input
				bind:this={input}
				class="serif title title-input inline-edit"
				aria-label="Video title"
				maxlength="80"
				bind:value={draft}
				onblur={() => finish(true)}
				onkeydown={(e) => {
					if (e.key === 'Enter') finish(true);
					else if (e.key === 'Escape') finish(false);
				}}
			/>
		{:else}
			<h1 class="title-wrap">
				<button
					type="button"
					class="serif title"
					title="Rename"
					aria-label="{editor.project.title}, rename"
					onclick={startEditing}
				>
					{editor.project.title}
				</button>
			</h1>
		{/if}
		<button
			bind:this={menuButton}
			type="button"
			class="menu-button"
			aria-label="Video menu"
			title="Video menu"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={() => (menuOpen = !menuOpen)}
		>
			<ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
		</button>
		<p class="meta">
			{pluralize(editor.project.scenes.length, 'scene')} · {formatLength(editor.duration)}
		</p>
		<button
			type="button"
			class="format mono"
			data-format-button
			aria-haspopup="dialog"
			aria-expanded={!!formatPanel}
			aria-label="Project format: {formatLabel(editor.project.format)}. Change"
			onclick={toggleFormat}
		>
			{formatLabel(editor.project.format)}
		</button>
		{#if saveLabel}
			<p class="save" class:error={editor.saveStatus === 'error'} role="status">
				{#if saved}<Check
						size={13}
						strokeWidth={2}
						aria-hidden="true"
					/>{/if}
				<span class="save-text">{saveLabel}</span>
			</p>
		{/if}
	</div>

	<div class="actions">
		<IconButton label="Keyboard shortcuts" shortcut="?" icon={Keyboard} onclick={onshortcuts} />
		<Divider />
		<IconButton
			label="Undo"
			shortcut="{mod}Z"
			icon={Undo2}
			disabled={!editor.canUndo}
			onclick={() => editor.undo()}
		/>
		<IconButton
			label="Redo"
			shortcut={isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z'}
			icon={Redo2}
			disabled={!editor.canRedo}
			onclick={() => editor.redo()}
		/>
		<Divider />
		<Button variant="outline" icon={Play} disabled={!editor.project.scenes.length} onclick={onwatch}
			>Watch</Button
		>
		<Button
			variant="accent"
			icon={Download}
			disabled={!editor.project.scenes.length}
			onclick={onsave}>Save video</Button
		>
	</div>
</header>

{#if menuOpen && menuButton}
	<Menu label="Video" items={menuItems} anchor={menuButton} onclose={() => (menuOpen = false)} />
{/if}

{#if formatPanel}
	<FormatPanel x={formatPanel.x} y={formatPanel.y} onclose={() => (formatPanel = null)} />
{/if}

<style>
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
		height: var(--topbar-h);
		padding: 0 var(--space-6);
		border-bottom: 1px solid var(--color-border);
	}
	.project {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.brand {
		display: grid;
		border-radius: var(--radius-sm);
	}
	.projects-link {
		color: var(--color-muted);
		font-size: var(--text-md);
		text-decoration: none;
		border-radius: var(--radius-sm);
		padding: 2px 4px;
		margin: 0 -4px;
	}
	.projects-link:hover {
		color: var(--color-ink);
		background: var(--color-surface);
	}
	.crumb {
		color: var(--color-border);
		margin: 0 -4px;
	}
	.title-wrap {
		min-width: 0;
		display: flex;
	}
	.title {
		max-width: 36ch;
		padding: 2px 6px;
		margin: 0 -7px;
		border-radius: var(--radius-sm);
		font-size: var(--text-title);
		line-height: 1.1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: text;
	}
	/* The same box as the field (its 1px border), so the text doesn't move when renaming. */
	button.title {
		border: 1px solid transparent;
		background: none;
	}
	button.title:hover {
		background: var(--color-surface);
	}
	.title-input {
		width: 22ch;
	}
	.menu-button {
		display: grid;
		place-items: center;
		flex: none;
		width: 26px;
		height: 26px;
		margin-left: -8px;
		border: none;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--color-muted);
	}
	.menu-button:hover,
	.menu-button[aria-expanded='true'] {
		background: var(--color-surface);
		color: var(--color-ink);
	}
	.meta {
		color: var(--color-muted);
		font-size: var(--text-md);
		white-space: nowrap;
	}
	.format {
		height: 28px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-ink);
		font-size: var(--text-sm);
		white-space: nowrap;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.format:hover,
	.format[aria-expanded='true'] {
		border-color: var(--color-ink);
	}
	.save {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--color-muted);
		font-size: var(--text-sm);
		white-space: nowrap;
		animation: fade-in var(--dur) var(--ease-out);
	}
	.save-text {
		max-width: 30ch;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.save.error {
		color: var(--color-ink);
		font-weight: var(--weight-medium);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.actions :global(.btn) {
		margin-left: var(--space-1);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
	@media (max-width: 1279px) {
		.save {
			display: none;
		}
	}
</style>
