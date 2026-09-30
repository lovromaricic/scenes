<!--
	@component
	"Your media": everything imported into the project. Click one to add it as a new scene at the
	end, or drag it onto the storyboard to put it exactly where you want.
-->
<script lang="ts">
	import ImageIcon from '@lucide/svelte/icons/image';
	import { MEDIA_DRAG_TYPE } from '$lib/media/dragTypes';
	import { formatShort } from '$lib/model/time';
	import { useEditor } from '$lib/state/context';

	const editor = useEditor();

	const items = $derived(
		editor.project.library
			.map((id) => editor.media[id])
			.filter((info) => info && info.kind !== 'audio')
	);

	function ondragstart(event: DragEvent, id: string) {
		event.dataTransfer?.setData(MEDIA_DRAG_TYPE, id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
	}
</script>

{#if items.length}
	<section class="library" aria-labelledby="library-title">
		<h2 id="library-title" class="serif heading">Your media</h2>
		<p class="hint">Click to add, or drag onto the storyboard or the picture.</p>
		<ul class="grid">
			{#each items as info (info.id)}
				{@const thumb = editor.thumbnails[info.id]}
				{@const uses = editor.project.scenes.filter((s) => s.mediaId === info.id).length}
				<li>
					<button
						type="button"
						class="item"
						draggable="true"
						title={info.name}
						aria-label="Add {info.name} as a new scene{uses
							? `, used in ${uses} scene${uses > 1 ? 's' : ''}`
							: ''}"
						onclick={() => editor.addSceneFromMedia(info.id)}
						ondragstart={(e) => ondragstart(e, info.id)}
					>
						<span class="thumb" style:background-image={thumb ? `url("${thumb}")` : 'none'}></span>
						<span class="badge mono">
							{#if info.kind === 'photo'}<ImageIcon
									size={10}
									strokeWidth={2}
									aria-hidden="true"
								/>Photo{:else}{formatShort(info.duration - info.startTime)}{/if}
						</span>
						{#if !uses}<span class="unused" aria-hidden="true">Not used</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	</section>
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
	.heading {
		font-size: 22px;
		line-height: 1;
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
		min-height: 0;
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
	.item:hover {
		border-color: var(--color-muted);
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
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
