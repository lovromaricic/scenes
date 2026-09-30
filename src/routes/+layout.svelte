<script lang="ts">
	import '$lib/styles/global.css';
	import Unsupported from '$lib/editor/Unsupported.svelte';
	import { missingFeatures } from '$lib/media/support';
	import ProjectFileDialogs from '$lib/files/ProjectFileDialogs.svelte';

	let { children } = $props();

	const missing = missingFeatures();
</script>

<svelte:head>
	<title>Scenes</title>
</svelte:head>

{#if missing.length > 0}
	<Unsupported {missing} />
{:else}
	{@render children()}
	<ProjectFileDialogs />
{/if}
