<!--
	@component
	Scale and rotation (and, for words, opacity) of an overlay or words, at the playhead. With
	keyframes, changing a value sets the keyframe at the playhead (adding one if needed). Width and
	height scale together unless unlinked.
-->
<script lang="ts">
	import Link from '@lucide/svelte/icons/link';
	import Unlink from '@lucide/svelte/icons/unlink';
	import { Slider } from '$lib/ui';
	import { useEditor } from '$lib/state/context';

	interface Props {
		id: string;
		/** Words have no opacity elsewhere, so it's shown here. */
		withOpacity?: boolean;
		linked: boolean;
		/** "Layer" or "Words": used in the fields' names. */
		noun: string;
	}

	let { id, withOpacity = false, linked, noun }: Props = $props();

	const editor = useEditor();
	const v = $derived(editor.itemValues(id));
	const pct = (n: number) => Math.round(n * 1000) / 10;

	function number(value: string): number | null {
		if (value.trim() === '') return null;
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}

	function setScale(axis: 'x' | 'y', value: string) {
		const n = number(value);
		if (n === null || !v) return;
		const s = Math.max(1, n) / 100;
		if (linked) {
			// Both together, keeping their proportion.
			const k = s / (axis === 'x' ? v.scaleX : v.scaleY);
			editor.setItemValues(id, { scaleX: v.scaleX * k, scaleY: v.scaleY * k }, `scale:${id}`, 'Scale');
		} else {
			editor.setItemValues(id, axis === 'x' ? { scaleX: s } : { scaleY: s }, `scale-${axis}:${id}`, 'Scale');
		}
	}

	function setRotation(value: string) {
		const n = number(value);
		if (n !== null) editor.setItemValues(id, { rotation: n }, `rotation:${id}`, 'Rotate');
	}
</script>

{#if v}
	<div class="transform">
		<label class="num">
			<span>{linked ? 'Scale' : 'Width scale'}</span>
			<span class="unit">
				<input
					type="number"
					step="1"
					min="1"
					aria-label="{noun} {linked ? 'scale' : 'width scale'}"
					value={pct(v.scaleX)}
					oninput={(e) => setScale('x', e.currentTarget.value)}
				/>%
			</span>
		</label>
		{#if !linked}
			<label class="num">
				<span>Height scale</span>
				<span class="unit">
					<input
						type="number"
						step="1"
						min="1"
						aria-label="{noun} height scale"
						value={pct(v.scaleY)}
						oninput={(e) => setScale('y', e.currentTarget.value)}
					/>%
				</span>
			</label>
		{/if}
		<button
			type="button"
			class="link"
			aria-pressed={linked}
			aria-label={linked ? 'Width and height scale together (unlink)' : 'Width and height scale separately (link)'}
			title={linked ? 'Unlink width and height' : 'Link width and height'}
			onclick={() => editor.setScaleLinked(id, !linked)}
		>
			{#if linked}<Link size={14} aria-hidden="true" />{:else}<Unlink size={14} aria-hidden="true" />{/if}
		</button>
		<label class="num">
			<span>Rotation</span>
			<span class="unit">
				<input
					type="number"
					step="1"
					aria-label="{noun} rotation"
					value={Math.round(v.rotation * 10) / 10}
					oninput={(e) => setRotation(e.currentTarget.value)}
				/>°
			</span>
		</label>
	</div>
	{#if withOpacity}
		<label class="opacity">
			<span>Opacity</span>
			<Slider
				label="{noun} opacity"
				value={v.opacity}
				min={0}
				oninput={(o) => editor.setItemValues(id, { opacity: o }, `opacity:${id}`, 'Opacity')}
			/>
		</label>
	{/if}
{/if}

<style>
	.transform {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: end;
		gap: var(--space-2);
	}
	.transform:has(.num:nth-of-type(2) + .link) {
		grid-template-columns: 1fr 1fr auto 1fr;
	}
	.num {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.unit {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--color-muted);
	}
	input {
		width: 100%;
		min-width: 0;
		height: 32px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-ink);
		font: inherit;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
	.link {
		display: grid;
		place-items: center;
		width: 28px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-muted);
		cursor: pointer;
	}
	.link[aria-pressed='true'] {
		color: var(--color-ink);
	}
	.opacity {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
</style>
