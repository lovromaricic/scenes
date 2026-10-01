<!--
	@component
	Font size in project pixels (12–2000): a slider and a number field. Stored relative to the
	frame, so it keeps its look when the project's format changes. The slider is curved: the usual
	sizes (up to about 200 px) take most of it. In the field, the arrow keys change the size by 1
	(Shift: 10), and anything typed outside 12–2000 is brought into range.
-->
<script lang="ts">
	import { Field, Slider } from '$lib/ui';
	import {
		MAX_TEXT_PX,
		MIN_TEXT_PX,
		resolveTextStyle,
		sliderToTextPx,
		textPxToSlider
	} from '$lib/model/textStyle';
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

	/** What's typed, brought into 12–2000 (shown that way even if the size doesn't change). */
	function commit(input: HTMLInputElement) {
		if (input.value.trim() === '') {
			input.value = String(px);
			return;
		}
		set(Number(input.value), `size-field:${item.id}`);
		input.value = String(px);
	}

	function onkeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (event.key === 'Enter') {
			commit(event.currentTarget);
			return;
		}
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
		set(px + step, `size-field:${item.id}`);
	}
</script>

<Field label="Size">
	<div class="size">
		<div class="slider">
			<Slider
				label="Text size"
				min={0}
				max={1}
				step={0.001}
				value={textPxToSlider(px)}
				format={(p) => `${sliderToTextPx(p)} px`}
				showValue={false}
				oninput={(p) => set(sliderToTextPx(p))}
			/>
		</div>
		<label class="num">
			<input
				type="number"
				aria-label="Text size in pixels"
				min={MIN_TEXT_PX}
				max={MAX_TEXT_PX}
				value={px}
				step="1"
				onchange={(e) => commit(e.currentTarget)}
				{onkeydown}
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
