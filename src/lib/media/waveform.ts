import { AudioBufferSink, type InputAudioTrack } from 'mediabunny';

/** Peaks per second of audio. Enough detail for the Sound lane at any zoom we use. */
export const PEAKS_PER_SECOND = 25;

/**
 * Loudness peaks (0–1) of a whole audio track, PEAKS_PER_SECOND values per second, decoded in a
 * streaming way so long songs don't need to fit in memory. Peaks are normalised so the loudest
 * part reaches 1.
 */
export async function computePeaks(
	track: InputAudioTrack,
	startTime: number,
	duration: number
): Promise<Float32Array> {
	const count = Math.max(1, Math.ceil((duration - startTime) * PEAKS_PER_SECOND));
	const peaks = new Float32Array(count);
	const sink = new AudioBufferSink(track);
	for await (const { buffer, timestamp } of sink.buffers()) {
		const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
			buffer.getChannelData(c)
		);
		const rate = buffer.sampleRate;
		const perPeak = rate / PEAKS_PER_SECOND;
		for (let i = 0; i < buffer.length; i += 16) {
			const index = Math.floor((timestamp - startTime) * PEAKS_PER_SECOND + i / perPeak);
			if (index < 0 || index >= count) continue;
			let v = 0;
			for (const ch of channels) v = Math.max(v, Math.abs(ch[i]));
			if (v > peaks[index]) peaks[index] = v;
		}
	}
	let max = 0;
	for (const p of peaks) max = Math.max(max, p);
	if (max > 0) for (let i = 0; i < count; i++) peaks[i] = Math.sqrt(peaks[i] / max);
	return peaks;
}
