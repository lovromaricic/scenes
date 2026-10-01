<!--
	@component
	Settings for the selected layer (a video, photo or card on top of the scenes): position and
	size, crop, style, timing, animation, sound (videos), layer order, and for cards what they show.
-->
<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import CropIcon from '@lucide/svelte/icons/crop';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUpLeft from '@lucide/svelte/icons/arrow-up-left';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ArrowDownLeft from '@lucide/svelte/icons/arrow-down-left';
	import ArrowDownRight from '@lucide/svelte/icons/arrow-down-right';
	import Crosshair from '@lucide/svelte/icons/crosshair';
	import { Button, Field, IconButton, PillStepper, Slider, Switch } from '$lib/ui';
	import { formatClock, formatSeconds } from '$lib/model/time';
	import { defaultCard } from '$lib/model/card';
	import {
		MIN_OVERLAY_SECONDS,
		placeBox,
		type Placement,
		type PlacedOverlay
	} from '$lib/model/overlay';
	import { useEditor } from '$lib/state/context';
	import OverlayStyleFields from './OverlayStyleFields.svelte';
	import OverlayAnimationFields from './OverlayAnimationFields.svelte';
	import CardContentFields from './CardContentFields.svelte';

	let { placed }: { placed: PlacedOverlay } = $props();

	const editor = useEditor();
	const o = $derived(placed.overlay);
	const format = $derived(editor.project.format);
	const kindLabel = $derived({ video: 'Video', photo: 'Photo', card: 'Card' }[o.kind]);
	const px = $derived({
		x: Math.round(o.box.x * format.width),
		y: Math.round(o.box.y * format.height),
		w: Math.round(o.box.w * format.width),
		h: Math.round(o.box.h * format.height)
	});
	const trackName = $derived(editor.track(o.trackId)?.name ?? '');
	const maxLength = $derived(
		Math.max(
			MIN_OVERLAY_SECONDS,
			Math.min(editor.overlayMaxDuration(o), editor.duration - placed.start)
		)
	);

	const fields = [
		{ key: 'x', label: 'X' },
		{ key: 'y', label: 'Y' },
		{ key: 'w', label: 'Width' },
		{ key: 'h', label: 'Height' }
	] as const;

	function setPixels(field: 'x' | 'y' | 'w' | 'h', value: string) {
		if (value.trim() === '') return;
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		const next = { ...px, [field]: Math.round(field === 'w' || field === 'h' ? Math.max(16, n) : n) };
		editor.setOverlayBox(
			o.id,
			{
				x: next.x / format.width,
				y: next.y / format.height,
				w: next.w / format.width,
				h: next.h / format.height
			},
			`box-${field}:${o.id}`
		);
	}

	const placements: { where: Placement; label: string; icon: typeof Crosshair }[] = [
		{ where: 'top-left', label: 'Top left', icon: ArrowUpLeft },
		{ where: 'top-right', label: 'Top right', icon: ArrowUpRight },
		{ where: 'center', label: 'Center', icon: Crosshair },
		{ where: 'bottom-left', label: 'Bottom left', icon: ArrowDownLeft },
		{ where: 'bottom-right', label: 'Bottom right', icon: ArrowDownRight }
	];
</script>

<div class="head">
	<h2 class="serif title">Layer</h2>
	<p class="subtitle">
		{kindLabel} · {o.name} · on {trackName}
	</p>
</div>

<div class="sections">
	<section aria-label="Position and size">
		<h3 class="section-title">Position and size</h3>
		<div class="grid">
			{#each fields as f (f.key)}
				<label class="num">
					<span>{f.label}</span>
					<input
						type="number"
						step="1"
						aria-label="Layer {f.label.toLowerCase()}"
						value={px[f.key]}
						oninput={(e) => setPixels(f.key, e.currentTarget.value)}
					/>
				</label>
			{/each}
		</div>
		<div class="placements" role="group" aria-label="Quick placement">
			{#each placements as p (p.where)}
				<IconButton
					label={p.label}
					icon={p.icon}
					variant="soft"
					size="sm"
					onclick={() => editor.setOverlayBox(o.id, placeBox(o.box, p.where, format))}
				/>
			{/each}
		</div>
	</section>

	{#if o.kind !== 'card'}
		<section aria-label="Crop">
			<h3 class="section-title">Crop</h3>
			<div class="row">
				<Button variant="soft" size="sm" icon={CropIcon} onclick={() => editor.enterCrop(o.id)}
					>{o.crop ? 'Change crop' : 'Crop'}</Button
				>
				{#if o.crop}
					<button type="button" class="link" onclick={() => editor.removeOverlayCrop(o.id)}
						>Remove crop</button
					>
				{/if}
			</div>
		</section>
	{:else}
		<section aria-label="Card">
			<h3 class="section-title">Card</h3>
			<div class="stack">
				<CardContentFields
					card={o.card ?? defaultCard()}
					frame={{ width: px.w, height: px.h }}
					id={o.id}
					onchange={(card, key) => editor.setOverlayCard(o.id, card, key)}
				/>
			</div>
		</section>
	{/if}

	<section aria-label="Style">
		<h3 class="section-title">Style</h3>
		<OverlayStyleFields overlay={o} />
	</section>

	<section aria-label="Timing">
		<h3 class="section-title">Timing</h3>
		<Field label="Starts at">
			<PillStepper
				label="Starts at"
				decreaseLabel="Earlier"
				increaseLabel="Later"
				value={Math.round(placed.start * 10) / 10}
				min={0}
				max={Math.max(0, editor.duration - MIN_OVERLAY_SECONDS)}
				step={0.5}
				format={(v) => formatClock(v)}
				onchange={(v) => editor.setOverlayTiming(o.id, v, o.duration)}
			/>
		</Field>
		<Field label="Length">
			<PillStepper
				label="Layer length"
				decreaseLabel="Shorter"
				increaseLabel="Longer"
				value={Math.round(o.duration * 10) / 10}
				min={MIN_OVERLAY_SECONDS}
				max={maxLength}
				step={0.5}
				format={formatSeconds}
				onchange={(v) => editor.setOverlayTiming(o.id, placed.start, v)}
			/>
		</Field>
	</section>

	<section aria-label="Animation">
		<h3 class="section-title">Animation</h3>
		<OverlayAnimationFields overlay={o} />
	</section>

	{#if o.kind === 'video'}
		<section aria-label="Sound">
			<h3 class="section-title">Sound</h3>
			<Switch
				label="Play the video’s sound"
				checked={o.sound.on}
				onchange={(on) => editor.setOverlaySound(o.id, { ...o.sound, on })}
			/>
			{#if o.sound.on}
				<Slider
					label="Layer volume"
					value={o.sound.volume}
					oninput={(v) => editor.setOverlaySound(o.id, { ...o.sound, volume: v }, `volume:${o.id}`)}
				/>
			{/if}
		</section>
	{/if}

	<section aria-label="Layer order">
		<h3 class="section-title">Layer order</h3>
		<div class="row">
			<Button variant="soft" size="sm" icon={ArrowUp} onclick={() => editor.moveItemTrack(o.id, 1)}
				>Bring forward</Button
			>
			<Button variant="soft" size="sm" icon={ArrowDown} onclick={() => editor.moveItemTrack(o.id, -1)}
				>Send back</Button
			>
		</div>
	</section>
</div>

<div class="actions">
	<Button variant="ghost" size="sm" icon={Trash2} onclick={() => editor.deleteOverlay(o.id)}
		>Remove</Button
	>
</div>

<style>
	.title {
		font-size: var(--text-heading);
		line-height: 1;
	}
	.subtitle {
		margin-top: var(--space-2);
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		margin-top: var(--space-5);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	section:first-child {
		padding-top: 0;
		border-top: none;
	}
	.section-title {
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
	}
	.stack {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-4);
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-2);
	}
	.num {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.num input {
		width: 100%;
		min-width: 0;
		height: 34px;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--color-ink);
	}
	.num input:focus-visible {
		border-color: var(--color-ink);
		box-shadow: none;
	}
	.placements,
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
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
	.actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-5);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
</style>
