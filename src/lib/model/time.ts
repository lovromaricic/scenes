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

/** How times are shown on the clock and the timeline's live labels (chosen per device). */
export type TimeFormat = 'seconds' | 'frames';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * Clock time with hundredths: "0:02.45", "12:05.00", "1:02:03.45". Always rounds down (with a
 * hair of tolerance for float error), so it reads steadily and never runs ahead.
 */
export function formatHundredths(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds * 100 + 1e-4));
	const cs = total % 100;
	const s = Math.floor(total / 100) % 60;
	const m = Math.floor(total / 6000) % 60;
	const h = Math.floor(total / 360000);
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}.${pad(cs)}` : `${m}:${pad(s)}.${pad(cs)}`;
}

/**
 * Clock time as seconds and frames at `fps`: "0:02:14" (2 s and 14 frames), "1:02:03:14" with
 * hours. Rounds down to the frame being shown.
 */
export function formatFrames(seconds: number, fps: number): string {
	const rate = Math.max(1, Math.round(fps));
	const total = Math.max(0, Math.floor(seconds * rate + 1e-4));
	const f = total % rate;
	const whole = Math.floor(total / rate);
	const s = whole % 60;
	const m = Math.floor(whole / 60) % 60;
	const h = Math.floor(whole / 3600);
	const ff = pad(f, String(rate - 1).length);
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}:${ff}` : `${m}:${pad(s)}:${ff}`;
}

/** A clock time in the chosen format. */
export function formatTime(seconds: number, format: TimeFormat, fps: number): string {
	return format === 'frames' ? formatFrames(seconds, fps) : formatHundredths(seconds);
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
