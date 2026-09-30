<!--
	@component
	"Save video": pick a preset, watch the progress, get the file.
-->
<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';
	import { onMount } from 'svelte';
	import { Button, IconButton } from '$lib/ui';
	import {
		chooseFormat,
		ExportError,
		type ExportFormat,
		type ExportResult
	} from '$lib/export/exporter';
	import {
		estimateBytes,
		formatBytes,
		formatTimeLeft,
		outputSize,
		PRESETS,
		videoBitrate,
		type PresetId
	} from '$lib/export/presets';
	import { formatLength } from '$lib/model/time';
	import { useEditor } from '$lib/state/context';

	let { onclose }: { onclose: () => void } = $props();

	const editor = useEditor();

	let dialog: HTMLDialogElement;
	let preset = $state<PresetId>('best');
	let phase = $state<'choose' | 'saving' | 'done' | 'error'>('choose');
	let progress = $state(0);
	let elapsed = $state(0);
	let errorMessage = $state('');
	let result = $state<ExportResult | null>(null);
	let url = $state<string | null>(null);
	let controller: AbortController | null = null;
	let format = $state<ExportFormat | null>(null);

	const size = $derived(
		outputSize(editor.project.aspect, PRESETS.find((p) => p.id === preset)!.shortSide)
	);

	onMount(() => {
		dialog.showModal();
		return () => {
			controller?.abort();
			if (url) setTimeout(() => URL.revokeObjectURL(url!), 60_000);
		};
	});

	// Find out up front whether this browser can make MP4 files, so we can say so before saving.
	$effect(() => {
		const p = PRESETS.find((x) => x.id === preset)!;
		const { width, height } = size;
		format = null;
		void chooseFormat(width, height, videoBitrate(p, width, height))
			.then((f) => (format = f))
			.catch((error) => {
				console.warn('No video format available', error);
				format = null;
			});
	});

	async function start() {
		phase = 'saving';
		progress = 0;
		elapsed = 0;
		controller = new AbortController();
		try {
			result = await editor.saveVideo(
				preset,
				(p) => {
					progress = p.progress;
					elapsed = p.elapsed;
				},
				controller.signal
			);
			url = URL.createObjectURL(result.file);
			phase = 'done';
			download();
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				phase = 'choose';
				return;
			}
			console.error(error);
			errorMessage =
				error instanceof ExportError
					? error.message
					: error instanceof DOMException && error.name === 'QuotaExceededError'
						? 'Your device is out of space for this video. Free up some space, or try "Small file".'
						: 'Something went wrong while saving. Please try again.';
			phase = 'error';
		} finally {
			controller = null;
		}
	}

	function download() {
		if (!url || !result) return;
		const a = document.createElement('a');
		a.href = url;
		a.download = result.name;
		document.body.append(a);
		a.click();
		a.remove();
	}

	function cancel() {
		controller?.abort();
	}

	function close() {
		if (phase === 'saving') cancel();
		dialog.close();
		onclose();
	}

	function oncancel(event: Event) {
		// Esc: while saving, Esc cancels saving rather than hiding it.
		event.preventDefault();
		if (phase === 'saving') cancel();
		else close();
	}

	function onkeydown(event: KeyboardEvent) {
		// Keep editor shortcuts (Space, S, Delete…) from acting behind the dialog.
		event.stopPropagation();
		if (phase !== 'choose') return;
		const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
		if (!keys.includes(event.key) || !(event.target as HTMLElement).matches('[role="radio"]'))
			return;
		event.preventDefault();
		const i = PRESETS.findIndex((p) => p.id === preset);
		const next =
			(i + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + PRESETS.length) %
			PRESETS.length;
		preset = PRESETS[next].id;
		dialog.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
	}
</script>

<dialog bind:this={dialog} class="dialog" aria-labelledby="save-title" {oncancel} {onkeydown}>
	<header>
		<h2 id="save-title" class="serif">
			{phase === 'done'
				? 'Your video is ready'
				: phase === 'saving'
					? 'Saving your video'
					: 'Save video'}
		</h2>
		<IconButton label="Close" icon={X} size="sm" onclick={close} />
	</header>

	{#if phase === 'choose'}
		<p class="lede">
			“{editor.project.title}” · {formatLength(editor.duration)}. It’s made right here on your
			device — nothing is uploaded.
		</p>
		<div class="presets" role="radiogroup" aria-label="Quality">
			{#each PRESETS as p (p.id)}
				{@const checked = p.id === preset}
				{@const s = outputSize(editor.project.aspect, p.shortSide)}
				<button
					type="button"
					role="radio"
					aria-checked={checked}
					tabindex={checked ? 0 : -1}
					class="preset"
					class:checked
					onclick={() => (preset = p.id)}
				>
					<span class="preset-head">
						<span class="name">{p.label}</span>
						<span class="radio" aria-hidden="true"></span>
					</span>
					<span class="desc">{p.description}</span>
					<span class="meta mono">
						{s.width} × {s.height} · about {formatBytes(
							estimateBytes(p, editor.project.aspect, editor.duration)
						)}
					</span>
				</button>
			{/each}
		</div>
		{#if format?.fallback}
			<p class="note" role="note">
				This browser can’t make MP4 files, so your video will be saved as <strong>WebM</strong>. It
				plays in Chrome, Firefox, VLC and most video apps.
			</p>
		{/if}
		<footer>
			<Button variant="ghost" onclick={close}>Not now</Button>
			<Button variant="accent" icon={Download} onclick={start}>Save video</Button>
		</footer>
	{:else if phase === 'saving'}
		<p class="lede">Keep this tab open until it’s finished. Your project stays just as it is.</p>
		<div
			class="bar"
			role="progressbar"
			aria-label="Saving progress"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={Math.round(progress * 100)}
		>
			<span class="fill" style:width="{progress * 100}%"></span>
		</div>
		<div class="status">
			<span class="mono">{Math.round(progress * 100)}%</span>
			<span>{formatTimeLeft(progress, elapsed)}</span>
		</div>
		<footer>
			<Button variant="outline" onclick={cancel}>Cancel</Button>
		</footer>
	{:else if phase === 'done' && result}
		<div class="done">
			<span class="check"><Check size={22} strokeWidth={2} aria-hidden="true" /></span>
			<div>
				<p class="file">{result.name}</p>
				<p class="meta mono">
					{result.width} × {result.height} · {formatBytes(result.file.size)}
				</p>
			</div>
		</div>
		<p class="lede">It’s downloading now. If it didn’t, use the button below.</p>
		<footer>
			<Button variant="ghost" onclick={close}>Done</Button>
			<Button variant="ink" icon={Download} onclick={download}>Download again</Button>
		</footer>
	{:else}
		<p class="lede" role="alert">{errorMessage}</p>
		<footer>
			<Button variant="ghost" onclick={close}>Close</Button>
			<Button variant="ink" onclick={() => (phase = 'choose')}>Try again</Button>
		</footer>
	{/if}
</dialog>

<style>
	.dialog {
		width: min(560px, calc(100vw - 32px));
		padding: var(--space-6);
		border: none;
		border-radius: var(--radius-card-lg);
		background: var(--color-bg);
		color: var(--color-ink);
		box-shadow: var(--shadow-float);
	}
	.dialog[open] {
		animation: dialog-in var(--dur) var(--ease-out);
	}
	.dialog::backdrop {
		background: var(--color-scrim);
		animation: fade-in var(--dur) var(--ease-out);
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: var(--space-2);
	}
	h2 {
		font-size: 34px;
		line-height: 1.05;
	}
	.lede {
		color: var(--color-muted);
		margin-bottom: var(--space-5);
	}
	.presets {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.preset {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		text-align: left;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out);
	}
	.preset:hover {
		border-color: var(--color-muted);
	}
	.preset.checked {
		border-color: var(--color-ink);
		background: var(--color-surface);
	}
	.preset-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.name {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}
	.radio {
		width: 18px;
		height: 18px;
		border: 1.5px solid var(--color-muted);
		border-radius: 50%;
	}
	.checked .radio {
		border: 5px solid var(--color-ink);
	}
	.desc {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.meta {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.note {
		margin-top: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		font-size: var(--text-sm);
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-6);
	}
	.bar {
		height: 10px;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--color-ink);
		transition: width 250ms linear;
	}
	.status {
		display: flex;
		justify-content: space-between;
		margin-top: var(--space-2);
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.done {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4);
		margin-bottom: var(--space-4);
		border-radius: var(--radius-card);
		background: var(--color-surface);
	}
	.check {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--color-ink);
		color: var(--color-on-ink);
	}
	.file {
		font-weight: var(--weight-semibold);
		word-break: break-word;
	}
	@keyframes dialog-in {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
