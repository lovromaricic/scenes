<!--
	@component
	Font size in project pixels (12–400): a slider and a number field. Stored relative to the
	frame, so it keeps its look when the project's format changes.
-->
<script lang="ts">
	import { Field, Slider } from '$lib/ui';
	import { MAX_TEXT_PX, MIN_TEXT_PX, resolveTextStyle } from '$lib/model/textStyle';
	import { shortSide } from '$lib/model/format';
	import type { TextItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';

	let { item }: { item: TextItem } = $props();

	const editor = useEditor();
	const short = $derived(shortSide(editor.project.format));
	const px = $derived(Math.round(resolveTextStyle(item).size * short));

	function set(value: number, key?: string) {
		if (!Number.isFinite(value)) return;
		const v = Math.min(MAX_TEXT_PX, Math.max(MIN_TEXT_PX, Math.round(value)));
		editor.setTextSize(item.id, v / short, key ?? `size:${item.id}`);
	}
</script>

<Field label="Size">
	<div class="size">
		<div class="slider">
			<Slider
				label="Text size"
				min={MIN_TEXT_PX}
				max={MAX_TEXT_PX}
				step={1}
				value={px}
				format={() => ''}
				oninput={(v) => set(v)}
			/>
		</div>
		<label class="num">
			<input
				type="number"
				aria-label="Text size in pixels"
				min={MIN_TEXT_PX}
				max={MAX_TEXT_PX}
				value={px}
				onchange={(e) => set(Number(e.currentTarget.value), `size-field:${item.id}`)}
				onkeydown={(e) =>
					e.key === 'Enter' && set(Number(e.currentTarget.value), `size-field:${item.id}`)}
			/>
			<span>px</span>
		</label>
	</div>
</Field>

<style>
	.size {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
	}
	.slider {
		flex: 1;
		min-width: 0;
	}
	.num {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	input {
		width: 64px;
		height: 32px;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--color-ink);
	}
	input:focus-visible {
		border-color: var(--color-ink);
		box-shadow: none;
	}
</style>
