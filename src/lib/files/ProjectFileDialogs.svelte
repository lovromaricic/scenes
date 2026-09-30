<!--
	@component
	Progress, "already in the app" and error dialogs for opening project files. Shown once, in the
	layout, so opening works the same from every page.
-->
<script lang="ts">
	import { ConfirmDialog } from '$lib/ui';
	import FileProgress from './FileProgress.svelte';
	import { projectOpener } from './opener.svelte';
</script>

{#if projectOpener.conflict}
	{@const conflict = projectOpener.conflict}
	<ConfirmDialog
		title="“{conflict.title}” is already here"
		message="This project is already in the app. Replace the one in the app with the one from the file, or keep both?"
		actions={[
			{ label: 'Keep both', onclick: () => conflict.answer('copy') },
			{ label: 'Replace the one in the app', onclick: () => conflict.answer('replace') }
		]}
		oncancel={() => conflict.answer('cancel')}
	/>
{:else if projectOpener.progress}
	<FileProgress label="Opening progress" fraction={projectOpener.progress.fraction}>
		Opening <strong>{projectOpener.progress.name}</strong>…
	</FileProgress>
{/if}

{#if projectOpener.error}
	{@const error = projectOpener.error}
	<ConfirmDialog
		title="Couldn’t open “{error.name}”"
		message={error.message}
		actions={[]}
		cancelLabel="OK"
		oncancel={() => (projectOpener.error = null)}
	/>
{/if}
