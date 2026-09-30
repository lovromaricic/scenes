<!--
	@component
	One project on the home screen: its picture, name, length and shape, when it was last edited,
	and a menu (Open, Rename, Duplicate, Delete).
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import Copy from '@lucide/svelte/icons/copy';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Film from '@lucide/svelte/icons/film';
	import { Menu, type MenuItem } from '$lib/ui';
	import { formatClock } from '$lib/model/time';
	import { formatEdited } from '$lib/model/projects';
	import type { ProjectSummary } from './types';

	interface Props {
		project: ProjectSummary;
		now: number;
		onopen: () => void;
		onrename: (title: string) => void;
		onduplicate: () => void;
		ondelete: () => void;
		/** Extra menu items (e.g. Save to file), placed before Delete. */
		extra?: MenuItem[];
	}

	let { project, now, onopen, onrename, onduplicate, ondelete, extra = [] }: Props = $props();

	let menuButton = $state<HTMLButtonElement>();
	let menuOpen = $state(false);
	let renaming = $state(false);
	let draft = $state('');
	let input = $state<HTMLInputElement>();

	function startRename() {
		draft = project.title;
		renaming = true;
		requestAnimationFrame(() => input?.select());
	}

	function finishRename(save: boolean) {
		if (!renaming) return;
		renaming = false;
		if (save && draft.trim() && draft.trim() !== project.title) onrename(draft);
	}

	const items: MenuItem[] = $derived([
		{ label: 'Open', icon: FolderOpen, onselect: onopen },
		{ label: 'Rename', icon: Pencil, onselect: startRename },
		{ label: 'Duplicate', icon: Copy, onselect: onduplicate },
		...extra,
		{ label: 'Delete', icon: Trash2, separator: true, onselect: ondelete }
	]);

	const href = $derived(resolve('/edit/[id]', { id: project.id }));
</script>

<article class="card" aria-label={project.title}>
	<a class="thumb" {href} tabindex="-1" aria-hidden="true">
		{#if project.thumbnail}
			<img src={project.thumbnail} alt="" />
		{:else}
			<span class="blank"><Film size={28} strokeWidth={1.4} /></span>
		{/if}
	</a>
	<div class="info">
		<div class="text">
			{#if renaming}
				<input
					bind:this={input}
					class="rename"
					aria-label="Video name"
					maxlength="80"
					bind:value={draft}
					onblur={() => finishRename(true)}
					onkeydown={(e) => {
						if (e.key === 'Enter') finishRename(true);
						else if (e.key === 'Escape') finishRename(false);
					}}
				/>
			{:else}
				<h3><a class="name" {href}>{project.title}</a></h3>
			{/if}
			<p class="meta mono">
				{project.duration > 0 ? formatClock(project.duration) : 'Empty'} · {project.width} × {project.height}
			</p>
			<p class="edited">{formatEdited(project.updatedAt, now)}</p>
		</div>
		<button
			bind:this={menuButton}
			type="button"
			class="more"
			aria-label="More for {project.title}"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={() => (menuOpen = !menuOpen)}
		>
			<Ellipsis size={18} strokeWidth={1.8} aria-hidden="true" />
		</button>
	</div>
</article>

{#if menuOpen && menuButton}
	<Menu
		label="{project.title} options"
		{items}
		anchor={menuButton}
		align="end"
		onclose={() => (menuOpen = false)}
	/>
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.thumb {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 10;
		border-radius: var(--radius-card);
		background: var(--color-surface);
		overflow: hidden;
		transition: box-shadow var(--dur-fast) var(--ease-out);
	}
	.card:has(.name:hover) .thumb,
	.thumb:hover {
		box-shadow: 0 0 0 1px var(--color-border), var(--shadow-float);
	}
	.card:has(.name:focus-visible) .thumb {
		box-shadow: var(--focus-ring);
	}
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.blank {
		color: var(--color-muted);
		opacity: 0.6;
	}
	.info {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.text {
		flex: 1;
		min-width: 0;
	}
	h3 {
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name {
		color: inherit;
		text-decoration: none;
		border-radius: 4px;
	}
	.name:focus-visible {
		outline: none;
	}
	.rename {
		width: 100%;
		height: 28px;
		margin: -3px 0 -2px -6px;
		padding: 0 6px;
		border: 1px solid var(--color-ink);
		border-radius: 6px;
		font: inherit;
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		outline: none;
	}
	.meta,
	.edited {
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		margin-top: 4px;
		font-size: var(--text-xs);
	}
	.edited {
		margin-top: 1px;
		font-size: var(--text-sm);
	}
	.more {
		display: grid;
		place-items: center;
		flex: none;
		width: 32px;
		height: 32px;
		margin: -4px -6px 0 0;
		border: none;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--color-muted);
	}
	.more:hover,
	.more[aria-expanded='true'] {
		background: var(--color-surface);
		color: var(--color-ink);
	}
</style>
