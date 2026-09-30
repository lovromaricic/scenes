<!--
	@component
	Shown over the preview while recording a voiceover: a 3-2-1 countdown, then a timer and Stop.
-->
<script lang="ts">
	import Square from '@lucide/svelte/icons/square';
	import { formatClock } from '$lib/model/time';
	import { useEditor } from '$lib/state/context';

	const editor = useEditor();
	const rec = $derived(editor.recording);
</script>

{#if rec}
	<div class="recording" role="status" aria-live="polite">
		{#if rec.phase === 'countdown'}
			<div class="countdown">
				{#key rec.count}<span class="serif count">{rec.count}</span>{/key}
				<p>Get ready to speak…</p>
			</div>
		{/if}
		<div class="bar">
			<span class="dot" class:live={rec.phase === 'recording'} aria-hidden="true"></span>
			<span class="label">
				{rec.phase === 'recording' ? 'Recording' : 'Starting'}
				<span class="mono">{formatClock(rec.elapsed)}</span>
			</span>
			<button type="button" class="stop" onclick={() => editor.stopVoiceover()}>
				<Square size={12} strokeWidth={2.5} fill="currentColor" aria-hidden="true" />
				{rec.phase === 'recording' ? 'Stop' : 'Cancel'}
			</button>
		</div>
	</div>
{/if}

<style>
	.recording {
		position: absolute;
		inset: 0;
		z-index: 10;
		pointer-events: none;
	}
	.countdown {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		border-radius: inherit;
		background: var(--color-scrim);
		color: var(--color-on-ink);
	}
	.count {
		font-size: 120px;
		line-height: 1;
		animation: count-in 600ms var(--ease-out);
	}
	.bar {
		position: absolute;
		left: 50%;
		bottom: var(--space-4);
		translate: -50% 0;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 6px 6px 6px var(--space-4);
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		box-shadow: var(--shadow-float);
		pointer-events: auto;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--color-on-ink-muted);
	}
	.dot.live {
		background: var(--color-bg);
		animation: pulse 1s ease-in-out infinite;
	}
	.label {
		display: flex;
		gap: var(--space-2);
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
	}
	.stop {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 var(--space-4);
		border: none;
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-ink);
		font-weight: var(--weight-medium);
	}
	.stop:focus-visible {
		box-shadow:
			0 0 0 2px var(--color-ink),
			0 0 0 4px var(--color-bg);
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
	@keyframes count-in {
		from {
			opacity: 0;
			transform: scale(1.3);
		}
	}
</style>
