/**
 * Apply only the latest of many quick updates, once per animation frame: pointermoves can arrive
 * several times a frame, and each would otherwise re-render. `flush()` applies a pending one
 * straight away (at the end of a drag, before committing).
 */
export function frameBatch<T>(apply: (value: T) => void) {
	let pending: { value: T } | null = null;
	let raf = 0;
	const run = () => {
		raf = 0;
		const p = pending;
		pending = null;
		if (p) apply(p.value);
	};
	return {
		push(value: T) {
			pending = { value };
			if (!raf) raf = requestAnimationFrame(run);
		},
		flush() {
			if (raf) cancelAnimationFrame(raf);
			run();
		},
		cancel() {
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			pending = null;
		}
	};
}
