<!--
	@component
	A track's header on the left of the storyboard: its name (double-click to rename), Hide (visual
	tracks) or Mute (audio tracks), Lock, and a menu. Drag the name to move the track up or down.
	The Scenes track only shows its name.
-->
<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import Lock from '@lucide/svelte/icons/lock';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { tick } from 'svelte';
	import type { Track } from '$lib/model/tracks';
	import { useEditor } from '$lib/state/context';

	interface Props {
		track: Track;
		/** Start renaming right away (e.g. picked from the menu). */
		renaming?: boolean;
		onrenamedone?: () => void;
		onmenu?: (anchor: HTMLElement) => void;
		/** Pointer down on the grip or name: the storyboard moves the track. */
		onreorder?: (event: PointerEvent) => void;
	}

	let { track, renaming = false, onrenamedone, onmenu, onreorder }: Props = $props();

	const editor = useEditor();
	const main = $derived(track.kind === 'main');

	let editing = $state(false);
	let draft = $state('');
	let input = $state<HTMLInputElement>();
	let menuButton = $state<HTMLButtonElement>();

	async function startRename() {
		if (main || editing) return;
		draft = track.name;
		editing = true;
		await tick();
		input?.focus();
		input?.select();
	}

	$effect(() => {
		if (renaming) void startRename();
	});

	function finish(save: boolean) {
		if (!editing) return;
		editing = false;
		if (save) editor.renameTrack(track.id, draft);
		onrenamedone?.();
	}

	function onkeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Enter') finish(true);
		else if (event.key === 'Escape') {
			event.preventDefault();
			finish(false);
		}
	}

	const hideFlag = $derived(track.kind === 'audio' ? 'muted' : 'hidden');
	const off = $derived(track.kind === 'audio' ? track.muted : track.hidden);
	const hideLabel = $derived(
		track.kind === 'audio'
			? `${off ? 'Unmute' : 'Mute'} ${track.name}`
			: `${off ? 'Show' : 'Hide'} ${track.name}`
	);
</script>

<div
	class="track-header {track.kind}"
	class:dimmed={track.hidden || track.muted}
	class:locked={track.locked}
	class:collapsed={track.collapsed}
	data-track-header={track.id}
>
	{#if !main}
		<button
			type="button"
			class="fold"
			aria-label="{track.collapsed ? 'Expand' : 'Collapse'} {track.name}"
			aria-expanded={!track.collapsed}
			title={track.collapsed ? 'Expand' : 'Collapse to a thin strip'}
			onclick={() => editor.setTrackCollapsed(track.id, !track.collapsed)}
		>
			{#if track.collapsed}<ChevronRight size={12} aria-hidden="true" />{:else}<ChevronDown
					size={12}
					aria-hidden="true"
				/>{/if}
		</button>
		<span
			class="grip"
			role="presentation"
			title="Drag to move this track"
			onpointerdown={(e) => !editing && onreorder?.(e)}
		>
			<GripVertical size={12} aria-hidden="true" />
		</span>
	{/if}
	{#if editing}
		<input
			bind:this={input}
			class="name-input inline-edit"
			aria-label="Track name"
			maxlength="40"
			bind:value={draft}
			{onkeydown}
			onblur={() => finish(true)}
		/>
	{:else}
		<span
			class="name"
			role="presentation"
			title={main ? track.name : `${track.name} — double-click to rename, drag to move`}
			ondblclick={startRename}
			onpointerdown={(e) => !main && e.detail < 2 && onreorder?.(e)}>{track.name}</span
		>
	{/if}
	{#if !main && !editing && !track.collapsed}
		<span class="tools">
			<button
				type="button"
				class="tool"
				class:on={off}
				aria-label={hideLabel}
				aria-pressed={off}
				title={hideLabel}
				onclick={() => editor.setTrackFlag(track.id, hideFlag, !off)}
			>
				{#if track.kind === 'audio'}
					{#if off}<VolumeX size={13} aria-hidden="true" />{:else}<Volume2 size={13} aria-hidden="true" />{/if}
				{:else if off}<EyeOff size={13} aria-hidden="true" />{:else}<Eye size={13} aria-hidden="true" />{/if}
			</button>
			<button
				type="button"
				class="tool"
				class:on={track.locked}
				aria-label="{track.locked ? 'Unlock' : 'Lock'} {track.name}"
				aria-pressed={track.locked}
				title={track.locked ? 'Unlock: its items can be changed again' : 'Lock: its items can’t be selected or changed'}
				onclick={() => editor.setTrackFlag(track.id, 'locked', !track.locked)}
			>
				{#if track.locked}<Lock size={13} aria-hidden="true" />{:else}<LockOpen size={13} aria-hidden="true" />{/if}
			</button>
			<button
				bind:this={menuButton}
				type="button"
				class="tool"
				aria-label="{track.name} options"
				aria-haspopup="menu"
				title="More"
				onclick={() => menuButton && onmenu?.(menuButton)}
			>
				<Ellipsis size={13} aria-hidden="true" />
			</button>
		</span>
	{/if}
</div>

<style>
	.track-header {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 100%;
		padding: 0 var(--space-1) 0 2px;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-muted);
	}
	.main {
		padding-left: var(--space-5);
	}
	.fold {
		display: grid;
		place-items: center;
		flex: none;
		width: 16px;
		height: 18px;
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
	}
	.fold:hover {
		background: var(--color-surface);
		color: var(--color-ink);
	}
	.collapsed .grip {
		height: 18px;
	}
	.collapsed .name {
		font-size: 11px;
	}
	.grip {
		display: grid;
		place-items: center;
		flex: none;
		width: 10px;
		height: 24px;
		color: var(--color-border);
		cursor: grab;
		touch-action: none;
	}
	.track-header:hover .grip {
		color: var(--color-muted);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		cursor: grab;
		user-select: none;
		touch-action: none;
	}
	.main .name {
		cursor: default;
	}
	.name-input {
		flex: 1;
		min-width: 0;
		height: 24px;
		/* The text stays where the name was (padding and border to the left of it). */
		margin: 0 -5px;
		padding: 0 4px;
		font: inherit;
	}
	.tools {
		display: flex;
		flex: none;
	}
	.tool {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		opacity: 0.55;
		transition:
			opacity var(--dur-fast) var(--ease-out),
			background var(--dur-fast) var(--ease-out);
	}
	.track-header:hover .tool,
	.tool:focus-visible,
	.tool.on {
		opacity: 1;
	}
	.tool:hover {
		background: var(--color-surface);
		color: var(--color-ink);
	}
	.tool.on {
		color: var(--color-ink);
	}
	.dimmed .name,
	.locked .name {
		opacity: 0.5;
	}
</style>
