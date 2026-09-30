<script lang="ts">
	import Editor from '$lib/editor/Editor.svelte';
	import Unsupported from '$lib/editor/Unsupported.svelte';
	import { missingFeatures } from '$lib/media/support';
	import { allProjects } from '$lib/state/library';
	import { newId } from '$lib/state/project';

	const missing = missingFeatures();
	// Opens the most recently edited project, or a new one.
	const opening = allProjects().then((all) =>
		all[0] ? { id: all[0].id, fresh: false } : { id: newId(), fresh: true }
	);
</script>

<svelte:head>
	<title>Scenes</title>
</svelte:head>

{#if missing.length > 0}
	<Unsupported {missing} />
{:else}
	{#await opening then open}
		<Editor projectId={open.id} fresh={open.fresh} />
	{/await}
{/if}
