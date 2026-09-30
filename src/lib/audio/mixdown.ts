import { AudioBufferSink } from 'mediabunny';
import { getHandle } from '$lib/media/handles';
import { bufferPlacement, type AudioClip } from './clips';
import { scheduleClipGain } from './gain';

/**
 * Renders the project's sound for a stretch of time into an AudioBuffer, offline (faster than
 * real time) with an OfflineAudioContext. Uses the same clips and gain curves as live playback.
 * Export renders the soundtrack in short chunks with this, so long videos never hold the whole
 * soundtrack in memory.
 */
export async function mixdown(
	clips: AudioClip[],
	from: number,
	to: number,
	sampleRate = 48000,
	channels = 2
): Promise<AudioBuffer> {
	const length = Math.max(1, Math.round((to - from) * sampleRate));
	const ctx = new OfflineAudioContext(channels, length, sampleRate);
	const ctxTime = (t: number) => Math.max(0, t - from);

	await Promise.all(
		clips
			.filter((clip) => clip.end > from && clip.start < to)
			.map(async (clip) => {
				const handle = await getHandle(clip.mediaId);
				if (!handle.audio) return;
				const sink = new AudioBufferSink(handle.audio);
				const gain = ctx.createGain();
				gain.connect(ctx.destination);
				const playFrom = Math.max(from, clip.start);
				scheduleClipGain(gain.gain, clip, playFrom, ctxTime);

				const playTo = Math.min(to, clip.end);
				const srcFrom = clip.sourceStart + (playFrom - clip.start) * clip.speed;
				const srcTo = clip.sourceStart + (playTo - clip.start) * clip.speed;
				for await (const wrapped of sink.buffers(srcFrom, srcTo)) {
					const place = bufferPlacement(clip, wrapped.timestamp, playFrom);
					if (place.offset >= wrapped.buffer.duration) continue;
					const node = ctx.createBufferSource();
					node.buffer = wrapped.buffer;
					node.playbackRate.value = clip.speed;
					node.connect(gain);
					node.start(ctxTime(place.timelineStart), place.offset);
					node.stop(ctxTime(clip.end));
				}
			})
	);

	return ctx.startRendering();
}
