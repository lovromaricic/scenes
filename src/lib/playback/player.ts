import { AudioEngine } from '$lib/audio/engine';
import { sceneAudioClips } from '$lib/audio/clips';
import { getHandle } from '$lib/media/handles';
import { PhotoFrameSource, VideoFrameSource, type FrameSource } from '$lib/media/frames';
import { placeScenes, type PlacedScene } from '$lib/model/timeline';
import type { Project, Scene } from '$lib/model/types';
import { Compositor, type CompositeFrame } from '$lib/render/compositor';
import { sourceTimeAt } from './time';

/**
 * The playback engine. Runs its own requestAnimationFrame loop in plain TypeScript, outside
 * Svelte's reactivity: it owns the current time, drives decoding and draws through the
 * compositor. The UI reads time and play state through the callbacks.
 */

export interface PlayerEvents {
	time?: (time: number) => void;
	playing?: (playing: boolean) => void;
}

interface SourceEntry {
	mediaId: string;
	source: FrameSource | null;
	pending: boolean;
}

/** Seconds of upcoming scenes to start decoding before they're reached. */
const PREFETCH = 1.5;

export class Player {
	time = 0;
	playing = false;

	private scenes: Scene[] = [];
	private placed: PlacedScene[] = [];
	private duration = 0;
	private hasAudio: (mediaId: string) => boolean = () => false;

	private compositor: Compositor | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private sources = new Map<string, SourceEntry>();
	private audio = new AudioEngine();
	private raf = 0;
	private dirty = true;
	private lastDrawnKey = '';
	private events: PlayerEvents = {};
	private startToken = 0;
	/** While trimming, show this scene's frame at this source time instead of the playhead's. */
	private peekTarget: { sceneId: string; sourceTime: number } | null = null;

	on(events: PlayerEvents): void {
		this.events = events;
	}

	attach(canvas: HTMLCanvasElement): void {
		this.canvas = canvas;
		this.compositor = new Compositor(canvas);
		this.dirty = true;
		if (!this.raf) this.raf = requestAnimationFrame(this.tick);
	}

	detach(): void {
		cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.compositor?.dispose();
		this.compositor = null;
		this.canvas = null;
	}

	/** Size of the drawing buffer in device pixels. */
	resize(width: number, height: number): void {
		this.compositor?.resize(Math.max(2, Math.round(width)), Math.max(2, Math.round(height)));
		this.dirty = true;
	}

	setProject(project: Project, hasAudio: (mediaId: string) => boolean): void {
		const wasPlaying = this.playing;
		const oldAudioKey = this.audioKey();
		this.scenes = project.scenes;
		this.placed = placeScenes(project.scenes);
		this.duration = this.placed.at(-1)?.end ?? 0;
		this.hasAudio = hasAudio;

		// Drop decoders for scenes that no longer exist or now point at a different file.
		for (const [sceneId, entry] of this.sources) {
			const scene = this.scenes.find((s) => s.id === sceneId);
			if (!scene || scene.mediaId !== entry.mediaId) {
				entry.source?.dispose();
				this.sources.delete(sceneId);
			}
		}
		if (this.time > this.duration) this.setTime(this.duration);
		this.dirty = true;
		// Timing changed under a playing video: restart the sound from here so it stays in sync.
		if (wasPlaying && oldAudioKey !== this.audioKey()) void this.startAudio();
	}

	private audioKey(): string {
		return JSON.stringify(sceneAudioClips(this.scenes, this.hasAudio));
	}

	get length(): number {
		return this.duration;
	}

	async play(): Promise<void> {
		if (this.playing || this.duration <= 0) return;
		if (this.time >= this.duration - 0.01) this.setTime(0);
		this.setPlaying(true);
		await this.startAudio();
	}

	private async startAudio(): Promise<void> {
		const token = ++this.startToken;
		this.audio.stop();
		// Give the decoder a moment to have the first frame ready, so playback starts cleanly.
		await this.waitForFrame(this.time, 400);
		if (token !== this.startToken || !this.playing) return;
		await this.audio.play(sceneAudioClips(this.scenes, this.hasAudio), this.time);
	}

	pause(): void {
		if (!this.playing) return;
		this.startToken++;
		this.setTime(this.audio.now());
		this.audio.stop();
		this.setPlaying(false);
		this.dirty = true;
	}

	toggle(): void {
		if (this.playing) this.pause();
		else void this.play();
	}

	seek(time: number): void {
		const t = Math.min(this.duration, Math.max(0, time));
		this.setTime(t);
		this.dirty = true;
		if (this.playing) void this.startAudio();
	}

	/** Show a specific frame of a scene without moving the playhead (used while trimming). */
	peek(sceneId: string, sourceTime: number): void {
		this.peekTarget = { sceneId, sourceTime };
		this.dirty = true;
	}

	endPeek(): void {
		this.peekTarget = null;
		this.dirty = true;
	}

	/** Make sure the audio context exists; call from a click so the browser allows sound. */
	unlockAudio(): void {
		void this.audio.ensureContext().catch(() => {});
	}

	private setTime(t: number) {
		this.time = t;
		this.events.time?.(t);
	}

	private setPlaying(p: boolean) {
		this.playing = p;
		this.events.playing?.(p);
	}

	private waitForFrame(t: number, timeoutMs: number): Promise<void> {
		const start = performance.now();
		return new Promise((resolve) => {
			const check = () => {
				const frame = this.frameForTime(t, true);
				if (
					(frame && frame.exact) ||
					performance.now() - start > timeoutMs ||
					!this.placed.length
				) {
					resolve();
				} else {
					setTimeout(check, 16);
				}
			};
			check();
		});
	}

	private sourceFor(scene: Scene): FrameSource | null {
		let entry = this.sources.get(scene.id);
		if (!entry) {
			entry = { mediaId: scene.mediaId, source: null, pending: true };
			this.sources.set(scene.id, entry);
			const created = entry;
			getHandle(scene.mediaId)
				.then((handle) => {
					if (this.sources.get(scene.id) !== created) return;
					const redraw = () => (this.dirty = true);
					created.source =
						handle.info.kind === 'photo'
							? new PhotoFrameSource(handle, redraw)
							: new VideoFrameSource(handle, redraw);
					created.pending = false;
					this.dirty = true;
				})
				.catch((error) => {
					console.warn('Could not open media', error);
					created.pending = false;
				});
		}
		return entry.source;
	}

	private frameForTime(t: number, playing: boolean) {
		const current = this.placedAt(t);
		if (!current) return null;
		const source = this.sourceFor(current.scene);
		if (!source) return null;
		const srcT = sourceTimeAt(current, t);
		source.want(srcT, playing);
		return source.frameAt(srcT);
	}

	private peekFrame(target: { sceneId: string; sourceTime: number }) {
		const scene = this.scenes.find((s) => s.id === target.sceneId);
		const source = scene && this.sourceFor(scene);
		if (!source) return null;
		source.want(target.sourceTime, false);
		return source.frameAt(target.sourceTime);
	}

	private placedAt(t: number): PlacedScene | null {
		const placed = this.placed;
		if (!placed.length) return null;
		for (const p of placed) if (t < p.end) return p;
		return placed[placed.length - 1];
	}

	/** Keep decoders busy only for scenes near the playhead; let the rest sleep. */
	private manageSources(t: number) {
		const current = this.placedAt(t);
		const ahead = this.playing ? PREFETCH : 0.6;
		for (const p of this.placed) {
			const near =
				p === current || (p.start >= t && p.start - t < ahead) || (p.end <= t && t - p.end < 0.3);
			if (near) {
				const source = this.sourceFor(p.scene);
				if (source && p !== current)
					source.want(sourceTimeAt(p, Math.max(p.start, Math.min(t, p.end))), this.playing);
			} else if (p.scene.id !== this.peekTarget?.sceneId) {
				this.sources.get(p.scene.id)?.source?.idle();
			}
		}
	}

	private tick = () => {
		this.raf = requestAnimationFrame(this.tick);
		let t = this.time;
		if (this.playing) {
			t = Math.min(this.audio.now(), this.duration);
			if (t !== this.time) this.setTime(t);
			if (t >= this.duration) {
				this.pause();
				this.setTime(this.duration);
			}
		}
		if (!this.compositor || !this.canvas) return;

		this.manageSources(t);
		const frame = this.peekTarget
			? this.peekFrame(this.peekTarget)
			: this.frameForTime(t, this.playing);
		const key = `${this.canvas.width}x${this.canvas.height}|${frame ? objectId(frame.image) : 'none'}`;
		if (!this.dirty && key === this.lastDrawnKey) return;
		this.dirty = false;
		this.lastDrawnKey = key;

		const composite: CompositeFrame = {
			layer: frame ? { image: frame.image, width: frame.width, height: frame.height } : null
		};
		this.compositor.render(composite);
	};

	/** For tests: the colour of a pixel in the preview. */
	readPixel(x: number, y: number) {
		return this.compositor?.readPixel(x, y) ?? null;
	}

	/** For tests: audio context state and how many sound buffers are queued. */
	audioStats() {
		return this.audio.stats();
	}

	/** For tests: whether the frame at the current time is decoded exactly. */
	isFrameReady(): boolean {
		return !!this.frameForTime(this.time, this.playing)?.exact;
	}

	dispose(): void {
		this.pause();
		this.detach();
		for (const entry of this.sources.values()) entry.source?.dispose();
		this.sources.clear();
	}
}

const ids = new WeakMap<object, number>();
let nextId = 1;
function objectId(o: object): number {
	let id = ids.get(o);
	if (!id) {
		id = nextId++;
		ids.set(o, id);
	}
	return id;
}
