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
/** A very short fade at a loop's join, so the jump back doesn't click. */
const LOOP_FADE = 0.004;

/** A stretch of the timeline played from a moment on the audio clock (see `segment`). */
interface Segment {
	from: number;
	to: number;
	/** Audio-clock time at which `from` plays. */
	ctxFrom: number;
	index: number;
}

export class AudioEngine {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private generation = 0;
	private nodes = new Set<AudioScheduledSourceNode>();
	private gains = new Map<string, { gain: GainNode; clip: AudioClip; segment: Segment }>();
	private segmentGains = new Map<number, GainNode>();
	/** Repeat this part of the timeline (null: play to the end once). */
	private loop: { start: number; end: number } | null = null;
	private clips: AudioClip[] = [];
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

	/**
	 * Start playing `clips` from timeline time `t0`; with `loop`, that part of the timeline repeats
	 * seamlessly: each pass is scheduled on the audio clock ahead of time, right after the one
	 * before, with a few milliseconds' fade at the join.
	 */
	async play(clips: AudioClip[], t0: number, loop: { start: number; end: number } | null = null): Promise<void> {
		const ctx = await this.ensureContext();
		this.stop();
		const gen = ++this.generation;
		this.t0 = t0;
		this.ctxStart = ctx.currentTime + START_DELAY;
		this.loop = loop && loop.end - loop.start > 0.05 && t0 < loop.end ? { ...loop } : null;
		this.clips = clips;
		this.running = true;
		void this.scheduleSegments(gen);
	}

	/**
	 * Pass `k` of the playback: the first from `t0` (to the loop's end, or the end of everything);
	 * then, when looping, the loop again and again, each starting where the last one ends.
	 */
	private segment(k: number): Segment {
		const loop = this.loop;
		if (k === 0) return { from: this.t0, to: loop?.end ?? Infinity, ctxFrom: this.ctxStart, index: 0 };
		const length = loop!.end - loop!.start;
		return {
			from: loop!.start,
			to: loop!.end,
			ctxFrom: this.ctxStart + (loop!.end - this.t0) + (k - 1) * length,
			index: k
		};
	}

	private async scheduleSegments(gen: number): Promise<void> {
		for (let k = 0; ; k++) {
			const segment = this.segment(k);
			if (k > 0 && !(await this.waitUntilNear(segment.ctxFrom, gen))) return;
			if (gen !== this.generation) return;
			this.startSegment(segment, gen);
			if (!this.loop) return;
		}
	}

	private startSegment(segment: Segment, gen: number) {
		const ctx = this.ctx!;
		const out = ctx.createGain();
		out.connect(this.master!);
		if (this.loop) {
			const end = segment.ctxFrom + (segment.to - segment.from);
			if (segment.index > 0) {
				out.gain.setValueAtTime(0, segment.ctxFrom);
				out.gain.linearRampToValueAtTime(1, segment.ctxFrom + LOOP_FADE);
			}
			out.gain.setValueAtTime(1, Math.max(segment.ctxFrom + LOOP_FADE, end - LOOP_FADE));
			out.gain.linearRampToValueAtTime(0, end);
		}
		this.segmentGains.set(segment.index, out);
		// Passes that have finished playing by now: let them go.
		for (const [k, gain] of this.segmentGains)
			if (k < segment.index - 1) {
				gain.disconnect();
				this.segmentGains.delete(k);
				for (const [key, entry] of this.gains)
					if (entry.segment.index === k) {
						entry.gain.disconnect();
						this.gains.delete(key);
					}
			}
		for (const clip of this.clips)
			if (clip.end > segment.from + 1e-3 && clip.start < segment.to) void this.scheduleClip(clip, gen, segment, out);
	}

	/** Whether sound is playing (the clock is only meaningful while it is). */
	get isRunning(): boolean {
		return this.running;
	}

	/** Current timeline time according to what is audible right now (back at the loop's start after its end). */
	now(): number {
		if (!this.ctx || !this.running) return this.t0;
		const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
		const elapsed = Math.max(0, this.ctx.currentTime - latency - this.ctxStart);
		const loop = this.loop;
		if (!loop) return this.t0 + elapsed;
		const first = loop.end - this.t0;
		if (elapsed < first) return this.t0 + elapsed;
		return loop.start + ((elapsed - first) % (loop.end - loop.start));
	}

	stop(): void {
		this.generation++;
		this.running = false;
		this.loop = null;
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
		for (const gain of this.segmentGains.values()) gain.disconnect();
		this.segmentGains.clear();
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
		const byId = new Map(clips.map((c) => [c.id, c]));
		for (const entry of this.gains.values()) {
			const clip = byId.get(entry.clip.id);
			if (!clip) continue;
			entry.clip = clip;
			entry.gain.gain.cancelScheduledValues(this.ctx.currentTime);
			// From now in the pass that's playing; from its start in one that's still to come.
			const seg = entry.segment;
			const playing = this.ctxTime(seg.from, seg) <= this.ctx.currentTime;
			this.shapeGain(entry.gain, clip, Math.max(clip.start, seg.from, playing ? now : seg.from), seg);
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

	/** When timeline time `timeline` plays on the audio clock, in a pass. */
	private ctxTime(timeline: number, segment: Segment): number {
		return segment.ctxFrom + (timeline - segment.from);
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

	private async scheduleClip(clip: AudioClip, gen: number, segment: Segment, out: GainNode): Promise<void> {
		const ctx = this.ctx!;
		const from = Math.max(segment.from, clip.start);
		const to = Math.min(segment.to, clip.end);
		if (!(await this.waitUntilNear(this.ctxTime(from, segment), gen))) return;

		let sink: AudioBufferSink | null;
		try {
			sink = await this.sinkFor(clip.mediaId);
		} catch {
			return;
		}
		if (!sink || gen !== this.generation) return;

		const gain = ctx.createGain();
		gain.connect(out);
		this.gains.set(`${clip.id}@${segment.index}`, { gain, clip, segment });
		this.shapeGain(gain, clip, from, segment);

		const srcFrom = clip.sourceStart + (from - clip.start) * clip.speed;
		const srcTo = clip.sourceStart + (to - clip.start) * clip.speed;
		const clipEnd = this.ctxTime(to, segment);

		try {
			for await (const wrapped of sink.buffers(srcFrom, srcTo)) {
				if (gen !== this.generation) break;
				const place = bufferPlacement(clip, wrapped.timestamp, segment.from);
				let when = this.ctxTime(place.timelineStart, segment);
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

	private shapeGain(gain: GainNode, clip: AudioClip, from: number, segment: Segment) {
		scheduleClipGain(gain.gain, clip, from, (t) =>
			Math.max(this.ctx!.currentTime, this.ctxTime(t, segment))
		);
	}
}
