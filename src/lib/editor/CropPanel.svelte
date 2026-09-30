<!--
	@component
	The right column while cropping: sizes, how much is cut from each side, shape lock, and
	Reset / Cancel / Done.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { Button, ChipGroup, Field } from '$lib/ui';
	import { CROP_RATIOS, setSide, sidesOf, type CropRatio, type Sides } from '$lib/model/crop';
	import { useEditor } from '$lib/state/context';

	const editor = useEditor();

	// What's being cropped: a scene or a layer (its source picture's size).
	const source = $derived(editor.croppingSource);
	const draft = $derived(editor.cropping?.draft ?? null);
	const sides = $derived(draft && source ? sidesOf(draft, source) : null);

	const fields: { side: keyof Sides; label: string }[] = [
		{ side: 'left', label: 'Left' },
		{ side: 'right', label: 'Right' },
		{ side: 'top', label: 'Top' },
		{ side: 'bottom', label: 'Bottom' }
	];

	function onSideInput(side: keyof Sides, value: string) {
		if (!draft || !source || value.trim() === '') return;
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		editor.setCropDraft(setSide(draft, side, n, source));
	}
</script>

{#if source && draft && sides}
	<div class="head">
		<h2 class="serif title">Crop</h2>
		<p class="subtitle">Drag the box on the preview, or type how much to cut from each side.</p>
	</div>

	<dl class="sizes">
		<div>
			<dt>Original</dt>
			<dd class="mono">{source.width} × {source.height}</dd>
		</div>
		<div>
			<dt>Cropped</dt>
			<dd class="mono" data-testid="cropped-size">{draft.w} × {draft.h}</dd>
		</div>
	</dl>

	<Field label="Cut from each side (pixels)">
		<div class="sides">
			{#each fields as f (f.side)}
				<label class="side">
					<span>{f.label}</span>
					<input
						type="number"
						min="0"
						step="1"
						aria-label="Cut from {f.label.toLowerCase()}"
						value={sides[f.side]}
						oninput={(e) => onSideInput(f.side, e.currentTarget.value)}
						onblur={(e) => (e.currentTarget.value = String(sides[f.side]))}
					/>
				</label>
			{/each}
		</div>
	</Field>

	<Field label="Shape">
		<ChipGroup
			label="Crop shape"
			size="sm"
			options={CROP_RATIOS.map((r) => ({ value: r.id, label: r.label }))}
			value={editor.cropping!.ratio}
			onchange={(r: CropRatio) => editor.setCropRatio(r)}
		/>
	</Field>
	<p class="tip">Hold Shift while dragging a corner to keep the shape.</p>

	<div class="actions">
		<Button
			variant="ghost"
			size="sm"
			onclick={() => {
				editor.setCropRatio('free');
				editor.setCropDraft({ x: 0, y: 0, w: source.width, h: source.height });
			}}>Reset</Button
		>
		<span class="spacer"></span>
		<Button variant="outline" size="sm" title="Cancel (Esc)" onclick={() => editor.cancelCrop()}
			>Cancel</Button
		>
		<Button
			variant="ink"
			size="sm"
			icon={Check}
			title="Done (Enter)"
			onclick={() => editor.applyCrop()}>Done</Button
		>
	</div>
{/if}

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
	.head,
	.sizes {
		animation: fade-in var(--dur) var(--ease-out);
	}
	.sizes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
		margin: 0;
	}
	.sizes div {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	dt {
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: var(--text-md);
	}
	.sides {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-2);
		width: 100%;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.side input {
		width: 100%;
		min-width: 0;
		height: 34px;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-ink);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
	.side input:focus-visible {
		border-color: var(--color-ink);
		box-shadow: none;
	}
	.tip {
		margin-top: calc(-1 * var(--space-2));
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.spacer {
		flex: 1;
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
