<!-- @component The Scenes mark: two frames and a playhead. -->
<script lang="ts">
	let { size = 28 }: { size?: number } = $props();
</script>

<svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
	<rect width="32" height="32" rx="8" fill="var(--color-ink)" />
	<rect x="6" y="9" width="8" height="14" rx="2" fill="var(--color-bg)" />
	<rect x="16" y="9" width="10" height="14" rx="2" fill="var(--color-bg)" opacity=".55" />
	<rect x="15" y="5" width="2" height="22" rx="1" fill="var(--color-accent)" />
</svg>
