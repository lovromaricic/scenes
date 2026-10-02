/**
 * Finding the beats in a piece of music, offline (for the demo's beat sync, see build-demo.ts).
 *
 * 1. Onset strength: how much louder each short frame (~11.6 ms) is than the one before, per
 *    frequency band (spectral flux on a log-magnitude spectrum), so drum hits and note starts
 *    stand out.
 * 2. Tempo: the lag (in the usual 70–180 BPM range) at which that onset curve repeats best
 *    (autocorrelation, gently weighted towards ~120 BPM).
 * 3. Beats: the phase whose grid of beats lands on the strongest onsets; each beat is then
 *    nudged to the nearest onset peak within a few frames.
 */

const FRAME = 1024;
const HOP = 256;

/** The onset strength curve: one value per HOP samples. */
export function onsetStrength(samples: Float32Array, sampleRate: number): { values: Float32Array; rate: number } {
	const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
	const bins = FRAME / 2;
	const window = new Float32Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
	const values = new Float32Array(frames);
	let previous = new Float32Array(bins);
	const re = new Float32Array(FRAME);
	const im = new Float32Array(FRAME);
	for (let f = 0; f < frames; f++) {
		for (let i = 0; i < FRAME; i++) {
			re[i] = samples[f * HOP + i] * window[i];
			im[i] = 0;
		}
		fft(re, im);
		const current = new Float32Array(bins);
		let flux = 0;
		for (let k = 1; k < bins; k++) {
			current[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
			const rise = current[k] - previous[k];
			if (rise > 0) flux += rise;
		}
		values[f] = flux;
		previous = current;
	}
	// Remove the slow trend (a moving average), keep what sticks out.
	const out = new Float32Array(frames);
	const half = 8;
	for (let f = 0; f < frames; f++) {
		let sum = 0;
		let n = 0;
		for (let j = Math.max(0, f - half); j <= Math.min(frames - 1, f + half); j++) {
			sum += values[j];
			n++;
		}
		out[f] = Math.max(0, values[f] - sum / n);
	}
	return { values: out, rate: sampleRate / HOP };
}

/** Beats per minute, from the onset curve. */
export function estimateTempo(onsets: Float32Array, rate: number): number {
	const minLag = Math.round((60 / 180) * rate);
	const maxLag = Math.round((60 / 70) * rate);
	let best = minLag;
	let bestScore = -Infinity;
	for (let lag = minLag; lag <= maxLag; lag++) {
		let sum = 0;
		for (let i = lag; i < onsets.length; i++) sum += onsets[i] * onsets[i - lag];
		const bpm = (60 * rate) / lag;
		// A mild preference for tempos near 120 BPM (log-Gaussian), against half/double errors.
		const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
		const score = (sum / (onsets.length - lag)) * weight;
		if (score > bestScore) {
			bestScore = score;
			best = lag;
		}
	}
	return (60 * rate) / best;
}

/** Beat times in seconds. */
export function detectBeats(samples: Float32Array, sampleRate: number): { bpm: number; beats: number[] } {
	const { values, rate } = onsetStrength(samples, sampleRate);
	const bpm = estimateTempo(values, rate);
	const period = (60 / bpm) * rate;
	// The phase whose beat grid collects the most onset strength.
	let bestPhase = 0;
	let bestScore = -Infinity;
	for (let phase = 0; phase < period; phase += 0.5) {
		let score = 0;
		for (let t = phase; t < values.length; t += period) score += values[Math.round(t)] ?? 0;
		if (score > bestScore) {
			bestScore = score;
			bestPhase = phase;
		}
	}
	const beats: number[] = [];
	const reach = Math.max(1, Math.round(period * 0.1));
	for (let t = bestPhase; t < values.length; t += period) {
		// Onto the strongest onset close by.
		let at = Math.round(t);
		for (let j = Math.max(0, at - reach); j <= Math.min(values.length - 1, Math.round(t) + reach); j++) {
			if (values[j] > values[at]) at = j;
		}
		// A hit shows up most once it's about three quarters into the frame: time it there.
		beats.push(Math.round(((at * HOP + FRAME * 0.75) / (rate * HOP)) * 1000) / 1000);
	}
	return { bpm: Math.round(bpm * 10) / 10, beats };
}

/** `t` moved onto the nearest beat if one is within `within` seconds; otherwise `t`. */
export function snapToBeat(t: number, beats: number[], within = 0.15): number {
	let best = t;
	let distance = within + 1e-9;
	for (const b of beats) {
		const d = Math.abs(b - t);
		if (d <= distance) {
			distance = d;
			best = b;
		}
	}
	return best;
}

/** In-place radix-2 FFT (length a power of two). */
function fft(re: Float32Array, im: Float32Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const angle = (-2 * Math.PI) / len;
		const wr = Math.cos(angle);
		const wi = Math.sin(angle);
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const a = i + k;
				const b = a + len / 2;
				const tr = re[b] * cr - im[b] * ci;
				const ti = re[b] * ci + im[b] * cr;
				re[b] = re[a] - tr;
				im[b] = im[a] - ti;
				re[a] += tr;
				im[a] += ti;
				const next = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = next;
			}
		}
	}
}
