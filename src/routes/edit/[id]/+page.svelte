<script lang="ts">
	import { page } from '$app/state';
	import Editor from '$lib/editor/Editor.svelte';

	const id = $derived(page.params.id ?? '');
	// "New video" opens `?new=1`: start empty if nothing is stored under this id yet.
	const fresh = $derived(page.url.searchParams.has('new'));
</script>

{#key id}
	<Editor projectId={id} {fresh} />
{/key}
