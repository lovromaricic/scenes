/**
 * Human-friendly time formatting. Durations are always shown in plain words
 * ("31 sec", "2 min 5 sec"); clock times as m:ss.
 */

/** Clock-style time, e.g. 0:12, 1:05, 1:02:03. Always rounds down so the clock never runs ahead. */
export function formatClock(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds + 1e-6));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Friendly total length, e.g. "31 sec", "2 min", "2 min 5 sec". */
export function formatLength(seconds: number): string {
	const total = Math.max(0, Math.round(seconds));
	if (total < 60) return `${total} sec`;
	const m = Math.floor(total / 60);
	const s = total % 60;
	return s === 0 ? `${m} min` : `${m} min ${s} sec`;
}

/** Short duration for cards and steppers, e.g. "4.5s" or "12s". */
export function formatShort(seconds: number): string {
	const rounded = Math.round(seconds * 10) / 10;
	if (rounded >= 60) return formatClock(rounded);
	return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
}

/** Stepper-style value, e.g. "4.0 sec". */
export function formatSeconds(seconds: number): string {
	return `${(Math.round(seconds * 10) / 10).toFixed(1)} sec`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}
