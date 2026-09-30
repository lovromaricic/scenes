<!--
	@component
	A track's header on the left of the storyboard: its name (and, for overlay and audio tracks,
	its controls — see section 2 of the tracks work).
-->
<script lang="ts">
	import type { Track } from '$lib/model/tracks';

	let { track }: { track: Track } = $props();
</script>

<div class="track-header {track.kind}" class:dimmed={track.hidden || track.muted}>
	<span class="name" title={track.name}>{track.name}</span>
</div>

<style>
	.track-header {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 100%;
		padding: 0 var(--space-2) 0 var(--space-5);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-muted);
	}
	.name {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.dimmed .name {
		opacity: 0.5;
	}
</style>
