<!--
	@component
	Choose a font for a text item: a searchable list (recent, built in, on this computer, uploaded),
	each name shown in its own font, then the family's weights and styles as chips.
-->
<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Upload from '@lucide/svelte/icons/upload';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { tick } from 'svelte';
	import { Button, ChipGroup } from '$lib/ui';
	import { pickFiles } from '$lib/media/picker';
	import { FONT_FILE_ACCEPT } from '$lib/media/fontFile';
	import {
		BUILTIN_FONTS,
		closestFace,
		faceLabel,
		resolveTextStyle,
		type FontSource,
		type TextFont
	} from '$lib/model/textStyle';
	import type { TextItem } from '$lib/model/types';
	import { cssFamily, ensureFont } from '$lib/render/fonts';
	import { useEditor } from '$lib/state/context';
	import { messages } from '$lib/state/messages.svelte';

	let { item }: { item: TextItem } = $props();

	const editor = useEditor();
	const fonts = editor.fonts;
	const font = $derived(resolveTextStyle(item).font);
	const failed = $derived(fonts.status(font) === 'failed');

	let open = $state<{ x: number; y: number; height: number } | null>(null);
	let query = $state('');
	let panel = $state<HTMLDivElement>();
	let trigger: HTMLButtonElement;
	let search = $state<HTMLInputElement>();

	async function toggle() {
		if (open) {
			open = null;
			return;
		}
		// Keep the whole panel inside the window: below the field if it fits, else moved up.
		const r = trigger.getBoundingClientRect();
		const height = Math.min(520, window.innerHeight - 24);
		open = {
			x: Math.max(12, r.right - 340),
			y: Math.max(12, Math.min(r.bottom + 6, window.innerHeight - height - 12)),
			height
		};
		query = '';
		// Load a face of each built-in font so the list can show every name in its own font.
		for (const b of BUILTIN_FONTS) {
			const f = closestFace(b.faces, 400, false)!;
			void ensureFont({
				family: b.family,
				source: 'builtin',
				id: b.id,
				weight: f.weight,
				italic: f.italic
			});
		}
		for (const s of fonts.stored)
			void ensureFont({
				family: s.family,
				source: s.source,
				id: s.id,
				weight: s.weight,
				italic: s.italic
			});
		await tick();
		search?.focus();
	}

	/** Pick a family: keep the current weight/italic if the family has them, else the closest. */
	async function pick(source: FontSource, family: string) {
		let next: TextFont | null = null;
		if (source === 'builtin') {
			const b = BUILTIN_FONTS.find((x) => x.family === family)!;
			const f = closestFace(b.faces, font.weight, font.italic)!;
			next = { family, source, id: b.id, weight: f.weight, italic: f.italic };
		} else if (source === 'upload') {
			const faces = fonts.stored.filter((s) => s.source === 'upload' && s.family === family);
			const f = closestFace(faces, font.weight, font.italic);
			if (f) next = { family, source, id: f.id, weight: f.weight, italic: f.italic };
		} else {
			const f = closestFace(fonts.localFamilies[family] ?? [], font.weight, font.italic);
			if (f) next = await fonts.useLocalFace(f);
		}
		if (next) {
			void ensureFont(next);
			editor.setTextFont(item.id, next);
		}
		open = null;
		trigger.focus();
	}

	async function pickRecent(f: TextFont) {
		void ensureFont(f);
		editor.setTextFont(item.id, f);
		open = null;
		trigger.focus();
	}

	async function upload() {
		const files = await pickFiles(FONT_FILE_ACCEPT, true);
		if (!files.length) return;
		const { font: first, rejected } = await fonts.upload(files);
		for (const name of rejected)
			messages.show(`“${name}” isn’t a font Scenes can use. Try a .ttf, .otf or .woff2 file.`, { tone: 'error' });
		if (first) {
			editor.setTextFont(item.id, first);
			open = null;
		}
	}

	async function pickFace(key: string) {
		const [w, i] = key.split('-');
		const next = await fonts.faceFont(font, Number(w), i === 'i');
		if (next) {
			void ensureFont(next);
			editor.setTextFont(item.id, next);
		}
	}

	const matches = (family: string) => family.toLowerCase().includes(query.trim().toLowerCase());
	const faces = $derived(fonts.faces(font));

	/** How to show a family's name in its own font. */
	function previewFamily(source: FontSource, family: string): string {
		void fonts.version;
		if (source === 'builtin') {
			const b = BUILTIN_FONTS.find((x) => x.family === family)!;
			return `"${cssFamily({ source, id: b.id })}", var(--font-sans)`;
		}
		if (source === 'local') return `"${family}", var(--font-sans)`;
		const s = fonts.stored.find((x) => x.source === 'upload' && x.family === family);
		return s ? `"${cssFamily({ source, id: s.id })}", var(--font-sans)` : 'var(--font-sans)';
	}

	function onkeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			open = null;
			trigger.focus();
		}
	}

	function onWindowPointerDown(event: PointerEvent) {
		if (!open) return;
		const t = event.target as Node;
		if (!panel?.contains(t) && !trigger.contains(t)) open = null;
	}

	const sections = $derived([
		{
			source: 'builtin' as const,
			title: 'Built in',
			families: fonts.families('builtin').filter(matches)
		},
		{
			source: 'local' as const,
			title: 'On this computer',
			families: fonts.families('local').filter(matches)
		},
		{
			source: 'upload' as const,
			title: 'Uploaded',
			families: fonts.families('upload').filter(matches)
		}
	]);
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="font-field">
	<button
		bind:this={trigger}
		type="button"
		class="trigger"
		aria-haspopup="dialog"
		aria-expanded={!!open}
		aria-label="Font: {font.family}. Change"
		onclick={toggle}
	>
		<span class="name" style:font-family={previewFamily(font.source, font.family)}
			>{font.family}</span
		>
		<span class="source"
			>{font.source === 'builtin'
				? 'Built in'
				: font.source === 'local'
					? 'This computer'
					: 'Uploaded'}</span
		>
		<ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
	</button>

	{#if faces.length > 1}
		<ChipGroup
			label="Font style"
			size="sm"
			options={faces.map((f) => ({ value: `${f.weight}-${f.italic ? 'i' : 'n'}`, label: f.label }))}
			value={`${font.weight}-${font.italic ? 'i' : 'n'}`}
			onchange={pickFace}
		/>
	{:else if faces.length === 1}
		<p class="note">{faceLabel(font.weight, font.italic)} only</p>
	{/if}

	{#if failed}
		<div class="warning" role="alert">
			<TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
			<p>“{font.family}” couldn’t be loaded, so Geist is used instead.</p>
			<button type="button" class="link" onclick={toggle}>Pick another font</button>
		</div>
	{/if}
</div>

{#if open}
	<div
		bind:this={panel}
		class="picker"
		style:left="{open.x}px"
		style:top="{open.y}px"
		style:max-height="{open.height}px"
		role="dialog"
		aria-label="Choose a font"
		tabindex="-1"
		{onkeydown}
	>
		<input
			bind:this={search}
			class="search"
			type="search"
			placeholder="Search fonts"
			aria-label="Search fonts"
			bind:value={query}
		/>
		<div class="list">
			{#if fonts.recent.length && !query}
				<p class="section">Recently used</p>
				{#each fonts.recent as f (`${f.source}:${f.family}`)}
					<button type="button" class="option" onclick={() => pickRecent(f)}>
						<span style:font-family={previewFamily(f.source, f.family)}>{f.family}</span>
					</button>
				{/each}
			{/if}

			{#each sections as section (section.source)}
				<p class="section">{section.title}</p>
				{#if section.source === 'local'}
					{#if fonts.localState === 'unsupported'}
						<p class="note">
							This browser can’t list the fonts on your computer. Chrome and Edge can, or upload a
							font file below.
						</p>
					{:else if fonts.localState === 'idle'}
						<Button variant="soft" size="sm" onclick={() => fonts.requestLocal()}
							>Show fonts on this computer</Button
						>
					{:else if fonts.localState === 'asking'}
						<p class="note">Waiting for permission…</p>
					{:else if fonts.localState === 'denied'}
						<p class="note">
							Scenes wasn’t allowed to see your fonts. You can allow it in the address bar and try
							again.
						</p>
						<Button variant="soft" size="sm" onclick={() => fonts.requestLocal()}>Try again</Button>
					{/if}
				{/if}
				{#each section.families as family (family)}
					{@const current = font.family === family && font.source === section.source}
					<button
						type="button"
						class="option"
						class:current
						aria-current={current}
						onclick={() => pick(section.source, family)}
					>
						<span style:font-family={previewFamily(section.source, family)}>{family}</span>
						{#if section.source === 'builtin'}
							<small>{BUILTIN_FONTS.find((b) => b.family === family)?.hint}</small>
						{/if}
					</button>
				{/each}
				{#if section.source === 'upload'}
					<Button variant="soft" size="sm" icon={Upload} onclick={upload}>Upload font file</Button>
				{/if}
			{/each}
		</div>
	</div>
{/if}

<style>
	.font-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
	}
	.trigger {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		height: 40px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		text-align: left;
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		border-color: var(--color-ink);
	}
	.name {
		flex: 1;
		min-width: 0;
		font-size: 17px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.source {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.note {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.warning {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		font-size: var(--text-sm);
	}
	.warning p {
		flex: 1;
		min-width: 12ch;
	}
	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--color-ink);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		text-decoration: underline;
		text-underline-offset: 3px;
		border-radius: 4px;
	}
	.picker {
		position: fixed;
		z-index: 70;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 340px;
		padding: var(--space-3);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		box-shadow: var(--shadow-float);
		animation: pop-in var(--dur-fast) var(--ease-out);
	}
	.search {
		height: 36px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.search:focus-visible {
		border-color: var(--color-ink);
		box-shadow: none;
	}
	.list {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
		overflow-y: auto;
		padding-bottom: var(--space-1);
	}
	.list :global(.btn) {
		align-self: flex-start;
		margin: 2px 0 var(--space-2);
	}
	.section {
		margin: var(--space-2) 0 2px;
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		color: var(--color-muted);
	}
	.option {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 6px var(--space-2);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		text-align: left;
		font-size: 18px;
	}
	.option:hover {
		background: var(--color-surface);
	}
	.option.current {
		background: var(--color-surface);
		box-shadow: inset 2px 0 0 var(--color-accent);
	}
	.option small {
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		color: var(--color-muted);
		white-space: nowrap;
	}
	@keyframes pop-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
