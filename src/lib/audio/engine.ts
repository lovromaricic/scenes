import { AudioBufferSink } from 'mediabunny';
import { getHandle } from '$lib/media/handles';
import { bufferPlacement, type AudioClip } from './clips';
import { scheduleClipGain } from './gain';

/**
 * Mixes and plays all sound through the Web Audio API, and is the master clock during playback:
 * the preview shows whatever frame matches the time you are hearing.
 *
 * Audio is decoded in a streaming way, a couple of seconds ahead of the playhead, so long
 * projects never need their whole soundtrack in memory.
 */

const LOOKAHEAD = 2.0;
const START_DELAY = 0.08;

export class AudioEngine {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private generation = 0;
	private nodes = new Set<AudioScheduledSourceNode>();
	private gains = new Map<string, { gain: GainNode; clip: AudioClip }>();
	private muted = false;
	private sinks = new Map<string, AudioBufferSink>();
	private ctxStart = 0;
	private t0 = 0;
	private running = false;

	/** Must be called from a user gesture the first time (browsers block audio otherwise). */
	async ensureContext(): Promise<AudioContext> {
		if (!this.ctx) {
			this.ctx = new AudioContext({ latencyHint: 'interactive' });
			this.master = this.ctx.createGain();
			this.master.gain.value = this.muted ? 0 : 1;
			this.master.connect(this.ctx.destination);
		}
		if (this.ctx.state !== 'running') await this.ctx.resume();
		return this.ctx;
	}

	/** Start playing `clips` from timeline time `t0`. */
	async play(clips: AudioClip[], t0: number): Promise<void> {
		const ctx = await this.ensureContext();
		this.stop();
		const gen = ++this.generation;
		this.t0 = t0;
		this.ctxStart = ctx.currentTime + START_DELAY;
		this.running = true;
		for (const clip of clips) {
			if (clip.end > t0 + 1e-3) void this.scheduleClip(clip, gen);
		}
	}

	/** Whether sound is playing (the clock is only meaningful while it is). */
	get isRunning(): boolean {
		return this.running;
	}

	/** Current timeline time according to what is audible right now. */
	now(): number {
		if (!this.ctx || !this.running) return this.t0;
		const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
		return this.t0 + Math.max(0, this.ctx.currentTime - latency - this.ctxStart);
	}

	stop(): void {
		this.generation++;
		this.running = false;
		for (const node of this.nodes) {
			try {
				node.stop();
			} catch {
				// Already stopped.
			}
			node.disconnect();
		}
		this.nodes.clear();
		for (const { gain } of this.gains.values()) gain.disconnect();
		this.gains.clear();
	}

	/** Silence everything (e.g. while recording a voiceover, to avoid echo). */
	setMuted(muted: boolean): void {
		this.muted = muted;
		if (this.master && this.ctx)
			this.master.gain.setValueAtTime(muted ? 0 : 1, this.ctx.currentTime);
	}

	/**
	 * Apply new volumes/fades to sound that is already playing, without restarting it
	 * (so dragging a volume slider during playback is smooth).
	 */
	retune(clips: AudioClip[]): void {
		if (!this.ctx || !this.running) return;
		const now = this.now();
		for (const clip of clips) {
			const entry = this.gains.get(clip.id);
			if (!entry) continue;
			entry.clip = clip;
			entry.gain.gain.cancelScheduledValues(this.ctx.currentTime);
			this.shapeGain(entry.gain, clip, Math.max(now, clip.start));
		}
	}

	/** For tests and debugging. */
	stats(): { state: string; scheduled: number } {
		return { state: this.ctx?.state ?? 'none', scheduled: this.nodes.size };
	}

	/** Forget decoders for a file (e.g. after it is removed). */
	forget(mediaId: string): void {
		this.sinks.delete(mediaId);
	}

	private ctxTime(timeline: number): number {
		return this.ctxStart + (timeline - this.t0);
	}

	private async sinkFor(mediaId: string): Promise<AudioBufferSink | null> {
		let sink = this.sinks.get(mediaId);
		if (!sink) {
			const handle = await getHandle(mediaId);
			if (!handle.audio) return null;
			sink = new AudioBufferSink(handle.audio);
			this.sinks.set(mediaId, sink);
		}
		return sink;
	}

	private async waitUntilNear(ctxWhen: number, gen: number): Promise<boolean> {
		const ctx = this.ctx!;
		while (gen === this.generation && ctxWhen - ctx.currentTime > LOOKAHEAD) {
			await new Promise((r) => setTimeout(r, 100));
		}
		return gen === this.generation;
	}

	private async scheduleClip(clip: AudioClip, gen: number): Promise<void> {
		const ctx = this.ctx!;
		const from = Math.max(this.t0, clip.start);
		if (!(await this.waitUntilNear(this.ctxTime(from), gen))) return;

		let sink: AudioBufferSink | null;
		try {
			sink = await this.sinkFor(clip.mediaId);
		} catch {
			return;
		}
		if (!sink || gen !== this.generation) return;

		const gain = ctx.createGain();
		gain.connect(this.master!);
		this.gains.set(clip.id, { gain, clip });
		this.shapeGain(gain, clip, from);

		const srcFrom = clip.sourceStart + (from - clip.start) * clip.speed;
		const srcTo = clip.sourceStart + (clip.end - clip.start) * clip.speed;
		const clipEnd = this.ctxTime(clip.end);

		try {
			for await (const wrapped of sink.buffers(srcFrom, srcTo)) {
				if (gen !== this.generation) break;
				const place = bufferPlacement(clip, wrapped.timestamp, this.t0);
				let when = this.ctxTime(place.timelineStart);
				let offset = place.offset;
				const now = ctx.currentTime;
				if (when < now) {
					offset += (now - when) * clip.speed;
					when = now;
				}
				if (offset >= wrapped.buffer.duration || when >= clipEnd) continue;

				const node = ctx.createBufferSource();
				node.buffer = wrapped.buffer;
				node.playbackRate.value = clip.speed;
				node.connect(gain);
				node.start(when, offset);
				node.stop(clipEnd);
				this.nodes.add(node);
				node.onended = () => {
					this.nodes.delete(node);
					node.disconnect();
				};
				if (!(await this.waitUntilNear(when, gen))) break;
			}
		} catch (error) {
			console.warn('Audio decoding stopped', error);
		}
	}

	private shapeGain(gain: GainNode, clip: AudioClip, from: number) {
		scheduleClipGain(gain.gain, clip, from, (t) =>
			Math.max(this.ctx!.currentTime, this.ctxTime(t))
		);
	}
}
