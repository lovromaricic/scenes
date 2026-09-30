<script lang="ts">
	let { missing }: { missing: string[] } = $props();
</script>

<main class="unsupported">
	<div class="card">
		<h1 class="serif">This browser can’t run Scenes yet</h1>
		<p>
			Scenes edits your videos right here on your device, which needs a few newer browser features.
			Please open it in the latest <strong>Google Chrome</strong> or
			<strong>Microsoft Edge</strong>.
		</p>
		<p class="detail">Missing: {missing.join(', ')}</p>
	</div>
</main>

<style>
	.unsupported {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: var(--space-6);
		background: var(--color-surface);
	}
	.card {
		max-width: 520px;
		padding: var(--space-10);
		border-radius: var(--radius-card-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-float);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: 40px;
		line-height: 1.05;
	}
	p {
		font-size: var(--text-lg);
		line-height: 1.5;
	}
	.detail {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
</style>
