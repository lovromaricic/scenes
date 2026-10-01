<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button, ChipGroup, Field, PillStepper } from '$lib/ui';
	import { TEXT_ANIMATIONS } from '$lib/model/catalog';
	import { MIN_TEXT } from '$lib/model/edits';
	import { formatSeconds } from '$lib/model/time';
	import type { TextAnimation, TextItem } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import TextStylePicker from './TextStylePicker.svelte';
	import FontPicker from './FontPicker.svelte';
	import TextSizeField from './TextSizeField.svelte';
	import TextColorSettings from './TextColorSettings.svelte';
	import TextShadowSettings from './TextShadowSettings.svelte';
	import TransformFields from './TransformFields.svelte';
	import KeyframeSection from './KeyframeSection.svelte';
	import KeyframeButtons from './KeyframeButtons.svelte';
	import OffscreenButtons from './OffscreenButtons.svelte';
	import { DEFAULT_TEXT_WIDTH } from '$lib/render/text';

	let { item }: { item: TextItem } = $props();

	const editor = useEditor();

	const animationOptions = TEXT_ANIMATIONS.map((a) => ({ value: a.id, label: a.label }));
	const positions = [
		{ value: 'top', label: 'Top', y: 0.14 },
		{ value: 'middle', label: 'Middle', y: 0.5 },
		{ value: 'bottom', label: 'Bottom', y: 0.84 }
	] as const;
	type Position = (typeof positions)[number]['value'];
	const position = $derived<Position>(item.y < 0.33 ? 'top' : item.y > 0.66 ? 'bottom' : 'middle');

	const title = $derived(item.style === 'title' ? 'Title' : 'Words');
</script>

<div class="head">
	<div class="title-row">
		<h2 class="serif title">{title}</h2>
		<KeyframeButtons id={item.id} />
	</div>
	<p class="subtitle">Double-click the words on the video to type.</p>
</div>

<div class="fields">
	<Field label="Words">
		<!-- Live: every change shows on the preview and the timeline as it's typed (but not halfway
			through a character being composed, like č). Enter is a new line; Esc or a click
			elsewhere just stops typing. -->
		<textarea
			class="words"
			rows="2"
			value={item.text}
			aria-label="Words"
			spellcheck="false"
			autocomplete="off"
			autocapitalize="off"
			{...{ autocorrect: 'off' }}
			oninput={(e) => {
				if (!(e as unknown as InputEvent).isComposing) editor.typeTextWords(item.id, e.currentTarget.value);
			}}
			oncompositionend={(e) => editor.typeTextWords(item.id, e.currentTarget.value)}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					e.currentTarget.blur();
				}
			}}
			onblur={(e) => editor.finishTextWords(item.id, e.currentTarget.value)}></textarea>
	</Field>

	<Field label="Style">
		<TextStylePicker value={item.style} onchange={(s) => editor.setTextStyle(item.id, s)} />
	</Field>

	<Field label="Font">
		<FontPicker {item} />
	</Field>

	<TextSizeField {item} />

	<TextColorSettings {item} />

	<TextShadowSettings {item} />

	<Field label="Animation">
		<ChipGroup
			label="Animation"
			size="sm"
			options={animationOptions}
			value={item.animation}
			onchange={(a: TextAnimation) => editor.setTextAnimation(item.id, a)}
		/>
	</Field>

	<Field label="Position">
		<ChipGroup
			label="Position"
			size="sm"
			options={positions.map((p) => ({ value: p.value, label: p.label }))}
			value={position}
			onchange={(v: Position) =>
				editor.setTextPosition(item.id, 0.5, positions.find((p) => p.value === v)!.y)}
		/>
	</Field>

	<OffscreenButtons id={item.id} />

	<Field label="Width">
		<div class="width-row" data-testid="text-width">
			<span class="width-mode">
				{#if item.width === 'auto'}
					Auto: one line, broken only by Enter
				{:else if typeof item.width === 'number'}
					Fixed: {Math.round(item.width * editor.project.format.width)} px
				{:else}
					Wraps at {Math.round(DEFAULT_TEXT_WIDTH * editor.project.format.width)} px
				{/if}
			</span>
			{#if item.width !== 'auto'}
				<Button variant="soft" size="sm" onclick={() => editor.setTextWidth(item.id, 'auto')}>Auto width</Button>
			{/if}
		</div>
		<p class="hint">Drag the side handles on the video to set a width.</p>
	</Field>

	<Field label="Size and turn">
		<TransformFields id={item.id} linked={item.scaleLinked ?? true} noun="Words" withOpacity />
	</Field>

	<KeyframeSection id={item.id} />

	<div class="timing">
		<Field label="Starts at">
			<PillStepper
				label="Start"
				decreaseLabel="Earlier"
				increaseLabel="Later"
				value={Math.round(item.start * 10) / 10}
				min={0}
				max={Math.max(0, Math.floor((editor.duration - item.duration) * 10) / 10)}
				step={0.5}
				format={formatSeconds}
				onchange={(v) => editor.setTextTiming(item.id, v, item.duration)}
			/>
		</Field>
		<Field label="Length">
			<PillStepper
				label="Length"
				decreaseLabel="Shorter"
				increaseLabel="Longer"
				value={Math.round(item.duration * 10) / 10}
				min={MIN_TEXT}
				max={Math.max(MIN_TEXT, Math.floor((editor.duration - item.start) * 10) / 10)}
				step={0.5}
				format={formatSeconds}
				onchange={(v) => editor.setTextTiming(item.id, item.start, v)}
			/>
		</Field>
	</div>
</div>

<div class="actions">
	<Button variant="ghost" size="sm" icon={Trash2} onclick={() => editor.deleteText(item.id)}>
		Remove
	</Button>
</div>

<style>
	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

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
	.fields,
	.actions {
		animation: fade-in var(--dur) var(--ease-out);
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.words {
		width: 100%;
		min-height: 64px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		resize: vertical;
		line-height: 1.4;
	}
	.words:focus-visible {
		border-color: var(--color-ink);
		box-shadow: none;
	}
	.width-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		font-size: var(--text-sm);
	}
	.hint {
		margin-top: var(--space-1);
		font-size: var(--text-xs);
		color: var(--color-muted);
	}
	.timing {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
