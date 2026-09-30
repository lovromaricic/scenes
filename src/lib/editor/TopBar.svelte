<script lang="ts">
	import { resolve } from '$app/paths';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import Play from '@lucide/svelte/icons/play';
	import Download from '@lucide/svelte/icons/download';
	import { Button, Divider, IconButton } from '$lib/ui';
	import { formatLength, pluralize } from '$lib/model/time';

	interface Props {
		title: string;
		sceneCount: number;
		duration: number;
		canUndo?: boolean;
		canRedo?: boolean;
		onundo?: () => void;
		onredo?: () => void;
		onwatch?: () => void;
		onsave?: () => void;
	}

	let {
		title,
		sceneCount,
		duration,
		canUndo = false,
		canRedo = false,
		onundo,
		onredo,
		onwatch,
		onsave
	}: Props = $props();

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const mod = isMac ? '⌘' : 'Ctrl+';
</script>

<header class="topbar">
	<div class="project">
		<a class="brand" href={resolve('/')} aria-label="Scenes">
			<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
				<rect width="32" height="32" rx="8" fill="var(--color-ink)" />
				<rect x="6" y="9" width="8" height="14" rx="2" fill="var(--color-bg)" />
				<rect x="16" y="9" width="10" height="14" rx="2" fill="var(--color-bg)" opacity=".55" />
				<rect x="15" y="5" width="2" height="22" rx="1" fill="var(--color-accent)" />
			</svg>
		</a>
		<h1 class="serif title">{title}</h1>
		<p class="meta">{pluralize(sceneCount, 'scene')} · {formatLength(duration)}</p>
	</div>

	<div class="actions">
		<IconButton label="Undo" shortcut="{mod}Z" icon={Undo2} disabled={!canUndo} onclick={onundo} />
		<IconButton
			label="Redo"
			shortcut={isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z'}
			icon={Redo2}
			disabled={!canRedo}
			onclick={onredo}
		/>
		<Divider />
		<Button variant="outline" icon={Play} onclick={onwatch}>Watch</Button>
		<Button variant="accent" icon={Download} onclick={onsave}>Save video</Button>
	</div>
</header>

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
	.title {
		font-size: var(--text-title);
		line-height: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		color: var(--color-muted);
		font-size: var(--text-md);
		white-space: nowrap;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.actions :global(.btn) {
		margin-left: var(--space-1);
	}
</style>
