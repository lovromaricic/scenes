<!--
	@component
	"Save video": choose what to save (the whole video, or the range set with I and O) and what to
	save it as (a video, and the other kinds added below), see its size, length and about how big
	the file will be, watch the progress, get the file.
-->
<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';
	import { onMount } from 'svelte';
	import { Button, ChipGroup, Field, IconButton, Slider } from '$lib/ui';
	import { formatClock } from '$lib/model/time';
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
	/** What to save: all of it, or the range set with I and O. */
	let what = $state<'whole' | 'range'>(editor.project.range ? 'range' : 'whole');
	/** What to save it as. */
	type SaveAs = 'video' | 'frame';
	let saveAs = $state<SaveAs>('video');
	/** Per kind: what the button and headings say. */
	const KINDS: Record<SaveAs, { button: string; saving: string; ready: string }> = {
		video: { button: 'Save video', saving: 'Saving your video', ready: 'Your video is ready' },
		frame: { button: 'Save frame', saving: 'Saving the frame', ready: 'Your frame is ready' }
	};
	const kind = $derived(KINDS[saveAs]);
	/** Current frame: PNG or JPG, and JPG quality. */
	let frameFormat = $state<'png' | 'jpg'>('png');
	let jpgQuality = $state(0.9);
	/** A single frame is at the playhead (the range doesn't apply). */
	const usesWhat = $derived(saveAs !== 'frame');
	const range = $derived(what === 'range' && editor.project.range ? editor.project.range : null);
	/** How long what's saved lasts. */
	const length = $derived(range ? Math.max(0, range.end - range.start) : editor.duration);
	const whatOptions = $derived([
		{ value: 'whole' as const, label: 'Whole video', description: formatLength(editor.duration) },
		{
			value: 'range' as const,
			label: 'Range',
			disabled: !editor.project.range,
			description: editor.project.range
				? `${formatClock(editor.project.range.start)} – ${formatClock(editor.project.range.end)}`
				: 'Set a range first: I for its start, O for its end'
		}
	]);
	const saveAsOptions: { value: SaveAs; label: string; description: string }[] = [
		{ value: 'video', label: 'Video', description: 'An MP4 video with sound' },
		{ value: 'frame', label: 'Current frame', description: 'The picture at the playhead, as PNG or JPG' }
	];
	/** The line under the choices: size, length and about how big the file will be. */
	const summary = $derived.by(() => {
		const f = editor.project.format;
		if (saveAs === 'frame') {
			// Rough: PNG pictures of video are about 1.5 bytes a pixel; JPG far less, more with quality.
			const perPixel = frameFormat === 'png' ? 1.5 : 0.08 + 0.5 * jpgQuality ** 3;
			return {
				size: `${f.width} × ${f.height}`,
				length: `1 frame at ${formatClock(editor.time)}`,
				bytes: formatBytes(f.width * f.height * perPixel)
			};
		}
		const p = PRESETS.find((x) => x.id === preset)!;
		return {
			size: `${size.width} × ${size.height}`,
			length: formatLength(length),
			bytes: formatBytes(estimateBytes(p, f, length))
		};
	});
	let phase = $state<'choose' | 'saving' | 'done' | 'error'>('choose');
	let progress = $state(0);
	let elapsed = $state(0);
	let errorMessage = $state('');
	let result = $state<ExportResult | null>(null);
	let url = $state<string | null>(null);
	let controller: AbortController | null = null;
	let format = $state<ExportFormat | null>(null);

	const size = $derived(
		outputSize(
			editor.project.format,
			PRESETS.find((p) => p.id === preset)!
		)
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
		void chooseFormat(width, height, videoBitrate(p, width, height, editor.project.format.fps))
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
			const onProgress = (p: { progress: number; elapsed: number }) => {
				progress = p.progress;
				elapsed = p.elapsed;
			};
			result =
				saveAs === 'frame'
					? await editor.saveFrame(frameFormat, jpgQuality)
					: await editor.saveVideo(preset, onProgress, controller.signal, range);
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
		// Arrow keys move between the quality cards (the chip rows handle their own).
		if (!keys.includes(event.key) || !(event.target as HTMLElement).matches('.preset')) return;
		event.preventDefault();
		const i = PRESETS.findIndex((p) => p.id === preset);
		const next =
			(i + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + PRESETS.length) %
			PRESETS.length;
		preset = PRESETS[next].id;
		dialog.querySelectorAll<HTMLButtonElement>('.preset')[next]?.focus();
	}
</script>

<dialog bind:this={dialog} class="dialog" aria-labelledby="save-title" {oncancel} {onkeydown}>
	<header>
		<h2 id="save-title" class="serif">
			{phase === 'done' ? kind.ready : phase === 'saving' ? kind.saving : 'Save video'}
		</h2>
		<IconButton label="Close" icon={X} size="sm" onclick={close} />
	</header>

	{#if phase === 'choose'}
		<p class="lede">
			“{editor.project.title}”. It’s made right here on your device — nothing is uploaded.
		</p>
		<div class="choices">
			{#if usesWhat}
				<Field label="What">
					<ChipGroup label="What" size="sm" options={whatOptions} bind:value={what} />
				</Field>
			{/if}
			<Field label="Save as">
				<ChipGroup label="Save as" size="sm" options={saveAsOptions} bind:value={saveAs} />
			</Field>
		</div>
		{#if saveAs === 'video'}
			<div class="presets" role="radiogroup" aria-label="Quality">
				{#each PRESETS as p (p.id)}
					{@const checked = p.id === preset}
					{@const s = outputSize(editor.project.format, p)}
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
							{s.width} × {s.height} · {editor.project.format.fps} fps · about {formatBytes(
								estimateBytes(p, editor.project.format, length)
							)}
						</span>
					</button>
				{/each}
			</div>
		{/if}
		{#if saveAs === 'frame'}
			<div class="options">
				<Field label="Format">
					<ChipGroup
						label="Picture format"
						size="sm"
						options={[
							{ value: 'png', label: 'PNG', description: 'Exact colours, bigger file' },
							{ value: 'jpg', label: 'JPG', description: 'Smaller file' }
						]}
						bind:value={frameFormat}
					/>
				</Field>
				{#if frameFormat === 'jpg'}
					<Field label="Quality">
						<Slider
							label="JPG quality"
							min={0.4}
							max={1}
							step={0.01}
							value={jpgQuality}
							format={(v) => `${Math.round(v * 100)}%`}
							oninput={(v) => (jpgQuality = v)}
						/>
					</Field>
				{/if}
				<p class="hint">The frame at the playhead, at the video’s full size.</p>
			</div>
		{/if}
		<p class="summary mono" data-testid="export-summary">
			{summary.size} · {summary.length} · about {summary.bytes}
		</p>
		{#if saveAs === 'video' && format?.fallback}
			<p class="note" role="note">
				This browser can’t make MP4 files, so your video will be saved as <strong>WebM</strong>. It
				plays in Chrome, Firefox, VLC and most video apps.
			</p>
		{/if}
		<footer>
			<Button variant="ghost" onclick={close}>Not now</Button>
			<Button variant="accent" icon={Download} onclick={start}>{kind.button}</Button>
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
	.options {
		display: grid;
		gap: var(--space-3);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--color-muted);
	}
	.choices {
		display: grid;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.summary {
		margin-top: var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-ink);
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
