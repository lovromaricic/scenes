<script lang="ts">
	import Editor from '$lib/editor/Editor.svelte';
	import Unsupported from '$lib/editor/Unsupported.svelte';
	import { missingFeatures } from '$lib/media/support';

	const missing = missingFeatures();
</script>

<svelte:head>
	<title>Scenes</title>
</svelte:head>

{#if missing.length > 0}
	<Unsupported {missing} />
{:else}
	<Editor />
{/if}
