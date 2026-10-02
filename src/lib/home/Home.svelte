<!--
	@component
	The home screen: a "New video" card and every project on this device, most recently edited
	first, with how much space they use and whether the browser keeps them safely.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base, resolve } from '$app/paths';
	import Plus from '@lucide/svelte/icons/plus';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Save from '@lucide/svelte/icons/save';
	import { Button, ConfirmDialog, Logo, type MenuItem } from '$lib/ui';
	import { dragHasFiles } from '$lib/media/picker';
	import FileProgress from '$lib/files/FileProgress.svelte';
	import { droppedHandles, isProjectFile, projectOpener } from '$lib/files/opener.svelte';
	import { saveProjectToFile } from '$lib/files/save';
	import { projectThumbnail, requestPersistentStorage, storageEstimate } from '$lib/media/db';
	import { videoLength } from '$lib/model/timeline';
	import { formatBytes } from '$lib/export/presets';
	import { allProjects, duplicateProject, removeProject, renameProject } from '$lib/state/library';
	import { newId } from '$lib/state/project';
	import { currentProjectThumbnail } from '$lib/state/projectThumbnail';
	import Toasts from '$lib/editor/Toasts.svelte';
	import { messages } from '$lib/state/messages.svelte';
	import ProjectCard from './ProjectCard.svelte';
	import type { ProjectSummary } from './types';


	let projects = $state<ProjectSummary[] | null>(null);
	let now = $state(Date.now());
	let storage = $state<{ usage: number; persisted: boolean } | null>(null);
	let deleting = $state<ProjectSummary | null>(null);
	const urls: string[] = [];

	async function refresh() {
		const all = await allProjects();
		const list: ProjectSummary[] = [];
		for (const p of all) {
			const stored = await projectThumbnail(p.id);
			const thumbnail = stored ? URL.createObjectURL(stored.blob) : undefined;
			if (thumbnail) urls.push(thumbnail);
			list.push({
				id: p.id,
				title: p.title,
				duration: videoLength(p),
				width: p.format.width,
				height: p.format.height,
				updatedAt: p.updatedAt,
				thumbnail
			});
		}
		projects = list;
		now = Date.now();
		// Pictures that are missing or out of date are made again, one by one.
		for (const p of all) {
			const blob = await currentProjectThumbnail(p).catch(() => null);
			const summary = projects?.find((s) => s.id === p.id);
			const stored = list.find((s) => s.id === p.id)?.thumbnail;
			if (!blob || !summary) continue;
			const url = URL.createObjectURL(blob);
			urls.push(url);
			if (summary.thumbnail === stored) summary.thumbnail = url;
		}
		const est = await storageEstimate().catch(() => null);
		if (est) storage = { usage: est.usage, persisted: est.persisted || (await persisted) };
	}

	// Ask the browser once to keep our data (and remember the answer).
	const persisted = requestPersistentStorage();

	onMount(() => void refresh());

	// ─── Project files ─────────────────────────────────────────────────────────────────────
	let fileSave = $state<{ title: string; fraction: number } | null>(null);

	async function saveToFile(project: ProjectSummary) {
		if (fileSave) return;
		fileSave = { title: project.title, fraction: 0 };
		try {
			const saved = await saveProjectToFile(project.id, {
				onProgress: (fraction) => fileSave && (fileSave.fraction = fraction)
			});
			if (saved) {
				messages.show(saved.downloaded ? `“${saved.name}” is in your downloads.` : `Saved to ${saved.name}.`);
			}
		} catch (error) {
			console.error('Could not save the project file', error);
			messages.show('The project couldn’t be saved. Please try again.', { tone: 'error' });
		} finally {
			fileSave = null;
		}
	}

	const fileItems = (project: ProjectSummary): MenuItem[] => [
		{ label: 'Save to file', icon: Save, onselect: () => void saveToFile(project) }
	];

	function onkeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'o') {
			event.preventDefault();
			void projectOpener.pickAndOpen();
		}
	}

	let dragging = $state(0);
	function ondragover(event: DragEvent) {
		if (!dragHasFiles(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}
	function ondrop(event: DragEvent) {
		if (!dragHasFiles(event)) return;
		event.preventDefault();
		dragging = 0;
		const files = Array.from(event.dataTransfer?.files ?? []);
		const index = files.findIndex(isProjectFile);
		if (index < 0) {
			messages.show('Drop a .scenes project file here to open it, or start a New video to add photos and videos.', { tone: 'error' });
			return;
		}
		const handles = droppedHandles(event);
		void handles.then((all) => projectOpener.open(files[index], all[index] ?? undefined));
	}

	onMount(() => {
		// Tips and messages from the editor don't belong here.
		messages.clear();
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			clearInterval(timer);
			for (const url of urls) URL.revokeObjectURL(url);
		};
	});

	function usageText(bytes: number): string {
		const size = formatBytes(bytes);
		return size === 'under 1 MB'
			? 'Your videos use less than 1 MB on this device.'
			: `Your videos use ${size} on this device.`;
	}

	function open(id: string) {
		void goto(resolve('/edit/[id]', { id }));
	}

	/** The demo that ships with the app: always opened as a new copy, so it never changes. */
	const DEMO = `${base}/demo/casa-rossa.scenes`;
	const DEMO_PICTURE = `${base}/demo/casa-rossa.jpg`;
	let openingDemo = $state(false);
	async function openDemo() {
		if (openingDemo || projectOpener.busy) return;
		openingDemo = true;
		try {
			const [file, picture] = await Promise.all([
				fetch(DEMO).then((r) => {
					if (!r.ok) throw new Error(`${r.status}`);
					return r.blob();
				}),
				fetch(DEMO_PICTURE)
					.then((r) => (r.ok ? r.blob() : undefined))
					.catch(() => undefined)
			]);
			await projectOpener.openCopy(new File([file], 'casa-rossa.scenes'), { title: 'Casa Rossa ad', thumbnail: picture });
		} catch (error) {
			console.error('Could not open the demo', error);
			messages.show('The demo couldn’t be opened. Please try again.', { tone: 'error' });
		} finally {
			openingDemo = false;
		}
	}

	function newVideo() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the path is resolve()d; only a query is added
		void goto(`${resolve('/edit/[id]', { id: newId() })}?new=1`);
	}

	async function confirmDelete(project: ProjectSummary) {
		deleting = null;
		projects = projects?.filter((p) => p.id !== project.id) ?? null;
		await removeProject(project.id);
		await refresh();
	}
</script>

<div class="home">
	<header class="bar">
		<a class="brand" href={resolve('/')} aria-label="Scenes">
			<Logo />
			<span class="wordmark serif">Scenes</span>
		</a>
		<div class="actions">
			<Button variant="outline" icon={FolderOpen} onclick={() => void projectOpener.pickAndOpen()}
				>Open project file</Button
			>
		</div>
	</header>

	<main class="content">
		<h1 class="serif">Your videos</h1>

		<ul class="grid" aria-label="Your videos">
			<li>
				<button type="button" class="new" onclick={newVideo}>
					<span class="plus"><Plus size={26} strokeWidth={1.6} aria-hidden="true" /></span>
					<span class="serif new-label">New video</span>
					<span class="new-hint">Start from your photos & videos</span>
				</button>
			</li>
			<li>
				<button
					type="button"
					class="demo"
					aria-label="Demo: Casa Rossa, a 15 second ad. Opens a copy you can edit."
					aria-busy={openingDemo}
					onclick={openDemo}
				>
					<img src={DEMO_PICTURE} alt="" draggable="false" />
					<span class="demo-chip">{openingDemo ? 'Opening…' : 'Demo'}</span>
					<span class="demo-text">
						<span class="serif demo-title">Casa Rossa · 15 sec ad</span>
						<span class="demo-hint">Opens a copy you can edit</span>
					</span>
				</button>
			</li>
			{#each projects ?? [] as project (project.id)}
				<li>
					<ProjectCard
						{project}
						{now}
						onopen={() => open(project.id)}
						onrename={async (title) => {
							project.title = title;
							await renameProject(project.id, title);
							await refresh();
						}}
						onduplicate={async () => {
							await duplicateProject(project.id);
							await refresh();
						}}
						ondelete={() => (deleting = project)}
						extra={fileItems(project)}
					/>
				</li>
			{/each}
		</ul>

		{#if projects && projects.length === 0}
			<p class="empty">Your videos will appear here. Start one with <strong>New video</strong>.</p>
		{/if}

		{#if storage}
			<section class="storage" aria-label="Storage">
				{#if storage.persisted}
					<ShieldCheck size={15} strokeWidth={1.8} aria-hidden="true" />
					<p>{usageText(storage.usage)} Your browser keeps your projects safely.</p>
				{:else}
					<TriangleAlert size={15} strokeWidth={1.8} aria-hidden="true" />
					<p>
						{usageText(storage.usage)} Your browser may clear projects if space runs low, so save the
						ones you care about to a file (<strong>Save to file</strong> in each video’s menu).
					</p>
				{/if}
			</section>
		{/if}
	</main>
</div>

<svelte:window
	{onkeydown}
	{ondragover}
	{ondrop}
	ondragenter={(e) => dragHasFiles(e) && dragging++}
	ondragleave={(e) => dragHasFiles(e) && (dragging = Math.max(0, dragging - 1))}
/>

{#if dragging > 0}
	<div class="drop" aria-hidden="true">
		<p class="serif">Drop a project file to open it</p>
	</div>
{/if}

{#if fileSave}
	<FileProgress label="Saving progress" fraction={fileSave.fraction}>
		Saving <strong>{fileSave.title}</strong> to a file…
	</FileProgress>
{/if}

{#if deleting}
	{@const project = deleting}
	<ConfirmDialog
		title="Delete “{project.title}”?"
		message="It will be removed from this device, with any clips and fonts only it uses. This can’t be undone."
		actions={[{ label: 'Delete', onclick: () => void confirmDelete(project) }]}
		danger
		oncancel={() => (deleting = null)}
	/>
{/if}

<Toasts />

<style>
	.home {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--topbar-h);
		padding: 0 var(--space-6);
		border-bottom: 1px solid var(--color-border);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--color-ink);
		text-decoration: none;
		border-radius: var(--radius-sm);
	}
	.wordmark {
		font-size: var(--text-title);
		line-height: 1;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.content {
		flex: 1;
		width: 100%;
		max-width: 1240px;
		margin: 0 auto;
		padding: var(--space-10) var(--space-8) var(--space-8);
		display: flex;
		flex-direction: column;
	}
	h1 {
		font-size: var(--text-display);
		line-height: 1;
		margin-bottom: var(--space-8);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: var(--space-8) var(--space-6);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.new {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: flex-end;
		gap: 2px;
		width: 100%;
		aspect-ratio: 16 / 10;
		padding: var(--space-5);
		border: none;
		border-radius: var(--radius-card);
		background: var(--color-ink);
		color: var(--color-on-ink);
		text-align: left;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.new:hover {
		background: var(--color-ink-hover);
	}
	.new:active {
		transform: scale(0.99);
	}
	.plus {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		margin-bottom: auto;
		border-radius: var(--radius-pill);
		background: var(--color-ink-line);
	}
	/* The demo: its picture, with the name over a dark fade at the bottom. */
	.demo {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		width: 100%;
		aspect-ratio: 16 / 10;
		padding: var(--space-5);
		border: none;
		border-radius: var(--radius-card);
		overflow: hidden;
		background: var(--color-ink);
		color: var(--color-on-ink);
		text-align: left;
		transition: transform var(--dur-fast) var(--ease-out);
	}
	.demo:active {
		transform: scale(0.99);
	}
	.demo img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform var(--dur) var(--ease-out);
	}
	.demo:hover img {
		transform: scale(1.03);
	}
	.demo::after {
		content: '';
		position: absolute;
		inset: 40% 0 0;
		background: linear-gradient(transparent, color-mix(in srgb, var(--color-ink) 85%, transparent));
	}
	.demo-chip {
		position: absolute;
		top: var(--space-4);
		left: var(--space-4);
		z-index: 1;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-ink);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}
	.demo-text {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.demo-title {
		font-size: 26px;
		line-height: 1.05;
	}
	.demo-hint {
		color: var(--color-on-ink-muted);
		font-size: var(--text-sm);
	}
	.new-label {
		font-size: 30px;
		line-height: 1.05;
	}
	.new-hint {
		color: var(--color-on-ink-muted);
		font-size: var(--text-sm);
	}
	.empty {
		margin-top: var(--space-6);
		color: var(--color-muted);
		font-size: var(--text-md);
	}
	.empty strong {
		color: var(--color-ink);
		font-weight: var(--weight-medium);
	}
	.storage {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: auto;
		padding-top: var(--space-10);
		color: var(--color-muted);
		font-size: var(--text-sm);
		line-height: 1.5;
	}
	.storage :global(svg) {
		flex: none;
		margin-top: 2px;
	}
	.storage strong {
		color: var(--color-ink);
		font-weight: var(--weight-medium);
	}
	.drop {
		position: fixed;
		inset: var(--space-3);
		z-index: 50;
		display: grid;
		place-items: center;
		border: 2px dashed var(--color-ink);
		border-radius: var(--radius-card-lg);
		background: color-mix(in srgb, var(--color-bg) 88%, transparent);
		pointer-events: none;
	}
	.drop p {
		font-size: var(--text-display);
	}
	@media (max-width: 640px) {
		.content {
			padding: var(--space-6) var(--space-4);
		}
		.bar {
			padding: 0 var(--space-4);
		}
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		}
	}
</style>
