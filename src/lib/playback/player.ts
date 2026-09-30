import { AudioEngine } from '$lib/audio/engine';
import { projectAudioClips, type AudioClip } from '$lib/audio/clips';
import { getHandle } from '$lib/media/handles';
import {
	PhotoFrameSource,
	VideoFrameSource,
	type FrameImage,
	type FrameSource
} from '$lib/media/frames';
import { placeScenes, type PlacedScene } from '$lib/model/timeline';
import { compose, type Composition, type LayerRef } from '$lib/model/composition';
import type { SourceBounds } from '$lib/model/edits';
import type { Size } from '$lib/model/crop';
import { DEFAULT_FRAME } from '$lib/model/framing';
import type { MoodId, Project, Scene, TextItem } from '$lib/model/types';
import {
	Compositor,
	type CompositeFrame,
	type LayerInput,
	type TextDraw
} from '$lib/render/compositor';
import { loadTextFonts, TextSpriteCache } from '$lib/render/text';
import { ensureFonts, onFontsChange } from '$lib/render/fonts';
import { resolveTextStyle } from '$lib/model/textStyle';
import { layerInput } from '$lib/render/frame';
import { textDraw, visualsAt, type VisualDraw } from '$lib/render/visuals';
import type { Track } from '$lib/model/tracks';
import { CardCache } from '$lib/render/card';
import { placeOverlays, type Overlay, type PlacedOverlay } from '$lib/model/overlay';
import { cardSize, overlayDraw, type OverlayDraw } from '$lib/render/overlay';

/** What has its own decoder: a scene, or a layer (even when both use the same file). */
type Decodable = Pick<Scene, 'id' | 'kind' | 'mediaId'>;
import { sourceTimeAt } from './time';

/** What the player needs to know about imported files. */
export interface MediaLookup {
	hasAudio(mediaId: string): boolean;
	/** The usable source range of a scene's file. */
	bounds(scene: Scene): SourceBounds;
	/** The file's own picture size in pixels (crops are measured in it). */
	sourceSize(mediaId: string): Size | null;
}

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
	private texts: TextItem[] = [];
	private tracks: Track[] = [];
	private sounds: Project['sounds'] = [];
	private overlays: Overlay[] = [];
	private placedOverlays: PlacedOverlay[] = [];
	private projectWidth = 1920;
	private readonly sprites = new TextSpriteCache();
	private readonly cards = new CardCache();
	/** A text being edited on the preview is drawn by the HTML editor instead. */
	private hiddenTextId: string | null = null;
	private placed: PlacedScene[] = [];
	private duration = 0;
	private mood: MoodId = 'natural';
	private lookup: MediaLookup = {
		hasAudio: () => false,
		bounds: (s) => ({ start: s.sourceStart, end: s.sourceEnd }),
		sourceSize: () => null
	};
	private hasAudio = (mediaId: string) => this.lookup.hasAudio(mediaId);

	private compositor: Compositor | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private sources = new Map<string, SourceEntry>();
	private audio = new AudioEngine();
	private raf = 0;
	private dirty = true;
	private lastDrawnKey = '';
	private events: PlayerEvents = {};
	private startToken = 0;
	/** While cropping, show this scene's whole source picture (no crop, fitted, no words). */
	private cropViewId: string | null = null;
	/** While trimming, show this scene's frame at this source time instead of the playhead's. */
	private peekTarget: { sceneId: string; sourceTime: number } | null = null;

	private readonly stopFontWatch = onFontsChange(() => (this.dirty = true));

	on(events: PlayerEvents): void {
		this.events = events;
	}

	/**
	 * Canvases the player can draw into. The last one attached is drawn to; e.g. full-screen
	 * "Watch" attaches its own canvas on top of the editor's and detaches it when closed.
	 */
	private surfaces: { canvas: HTMLCanvasElement; width: number; height: number }[] = [];

	attach(canvas: HTMLCanvasElement): void {
		if (this.surfaces.some((s) => s.canvas === canvas)) return;
		this.surfaces.push({ canvas, width: canvas.width, height: canvas.height });
		this.activate();
		void loadTextFonts().then(() => {
			// Anything drawn before the fonts arrived used a fallback font: draw it again.
			this.sprites.clear();
			this.dirty = true;
		});
		if (!this.raf) this.raf = requestAnimationFrame(this.tick);
	}

	detach(canvas: HTMLCanvasElement): void {
		const wasActive = this.canvas === canvas;
		this.surfaces = this.surfaces.filter((s) => s.canvas !== canvas);
		if (wasActive) this.activate();
		if (!this.surfaces.length) {
			cancelAnimationFrame(this.raf);
			this.raf = 0;
		}
	}

	private activate() {
		this.compositor?.dispose();
		this.compositor = null;
		const top = this.surfaces.at(-1);
		this.canvas = top?.canvas ?? null;
		if (top) {
			this.compositor = new Compositor(top.canvas);
			if (top.width > 0) this.compositor.resize(top.width, top.height);
		}
		this.dirty = true;
		this.lastDrawnKey = '';
	}

	/** Size of a canvas's drawing buffer in device pixels. */
	resize(canvas: HTMLCanvasElement, width: number, height: number): void {
		const surface = this.surfaces.find((s) => s.canvas === canvas);
		if (!surface) return;
		surface.width = Math.max(2, Math.round(width));
		surface.height = Math.max(2, Math.round(height));
		if (canvas === this.canvas && this.compositor) {
			this.compositor.resize(surface.width, surface.height);
			// Resizing clears the canvas: redraw straight away so it never flashes black.
			this.dirty = true;
			this.draw(this.time);
		}
		this.dirty = true;
	}

	setProject(project: Project, lookup: MediaLookup): void {
		const wasPlaying = this.playing;
		const oldAudioKey = this.audioKey();
		this.scenes = project.scenes;
		this.texts = project.texts;
		// Start loading the fonts the words use; the text redraws as each one arrives.
		void ensureFonts(project.texts.map((t) => resolveTextStyle(t).font));
		this.sounds = project.sounds;
		this.placed = placeScenes(project.scenes);
		this.duration = this.placed.at(-1)?.end ?? 0;
		this.overlays = project.overlays ?? [];
		this.tracks = project.tracks ?? [];
		this.placedOverlays = placeOverlays(this.overlays, this.tracks.map((t) => t.id));
		this.projectWidth = project.format.width;
		this.lookup = lookup;
		this.mood = project.mood;

		// Drop decoders for scenes and layers that no longer exist or now point at a different file.
		for (const [id, entry] of this.sources) {
			const item: Decodable | undefined =
				this.scenes.find((s) => s.id === id) ?? this.overlays.find((o) => o.id === id);
			if (!item || item.mediaId !== entry.mediaId) {
				entry.source?.dispose();
				this.sources.delete(id);
			}
		}
		if (this.time > this.duration) this.setTime(this.duration);
		this.dirty = true;
		if (wasPlaying) {
			// Timing changed under a playing video: restart the sound from here so it stays in sync.
			// Only volume or fades changed: adjust the sound that's already playing.
			if (oldAudioKey !== this.audioKey()) void this.startAudio();
			else this.audio.retune(this.audioClips());
		}
	}

	private audioClips(): AudioClip[] {
		return projectAudioClips(
			{ scenes: this.scenes, sounds: this.sounds, overlays: this.overlays, tracks: this.tracks },
			this.hasAudio
		);
	}

	/** What the sound depends on, apart from volume and fades (those can change live). */
	private audioKey(): string {
		return JSON.stringify(
			this.audioClips().map((c) => [c.id, c.mediaId, c.start, c.end, c.sourceStart, c.speed])
		);
	}

	setMuted(muted: boolean): void {
		this.audio.setMuted(muted);
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
		await this.audio.play(this.audioClips(), this.time);
	}

	pause(): void {
		if (!this.playing) return;
		this.startToken++;
		// Before the sound has started (still waiting for the first frame) the clock is stale.
		if (this.audio.isRunning) this.setTime(Math.min(this.audio.now(), this.duration));
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

	/** Show a scene's whole, uncropped source (crop mode), or `null` to go back to normal. */
	setCropView(sceneId: string | null): void {
		this.cropViewId = sceneId;
		this.dirty = true;
	}

	hideText(id: string | null): void {
		this.hiddenTextId = id;
		this.dirty = true;
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
				if (
					this.framesReady(t, true) ||
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

	private sourceFor(scene: Decodable): FrameSource | null {
		if (scene.kind === 'card') return null;
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

	private composition(t: number): Composition {
		return compose(this.placed, t, (p) => this.lookup.bounds(p.scene));
	}

	/** The decoded frame for one layer of a composition (asking the decoder for it if needed). */
	private layerFrame(ref: LayerRef, playing: boolean) {
		const scene = ref.placed.scene;
		if (scene.kind === 'card') {
			return this.canvas && scene.card
				? this.cards.frame(scene.card, this.canvas.width, this.canvas.height)
				: null;
		}
		const source = this.sourceFor(ref.placed.scene);
		if (!source) return null;
		source.want(ref.sourceTime, playing);
		return source.frameAt(ref.sourceTime);
	}

	private layerInput(ref: LayerRef, playing: boolean): LayerInput | null {
		const frame = this.layerFrame(ref, playing);
		return frame && this.canvas
			? layerInput(
					frame,
					ref.placed.scene,
					this.mood,
					this.canvas.width,
					this.canvas.height,
					this.lookup.sourceSize(ref.placed.scene.mediaId) ?? undefined
				)
			: null;
	}

	/** Whether every frame needed at time `t` is decoded exactly (scenes and layers). */
	private framesReady(t: number, playing: boolean): boolean {
		const c = this.composition(t);
		const a = c.a && this.layerFrame(c.a, playing);
		const b = c.b && this.layerFrame(c.b, playing);
		const scenesReady = !!a && a.exact && (!c.b || (!!b && b.exact));
		return scenesReady && this.overlaysAt(t).every((p) => this.overlayFrame(p, t, playing)?.exact ?? false);
	}

	/** What's on the (shown) overlay tracks at `t`, in drawing order. */
	private visualsAt(t: number) {
		return visualsAt({ tracks: this.tracks, overlays: this.overlays, texts: this.texts }, t, this.duration);
	}

	private overlaysAt(t: number): PlacedOverlay[] {
		return this.visualsAt(t).flatMap((v) => (v.type === 'overlay' ? [v.placed] : []));
	}

	/** An overlay's picture at time `t`: a video frame, the photo, or the card at its box size. */
	private overlayFrame(p: PlacedOverlay, t: number, playing: boolean) {
		const o = p.overlay;
		if (o.kind === 'card') {
			if (!this.canvas || !o.card) return null;
			const size = cardSize(p, this.canvas.width, this.canvas.height);
			return this.cards.frame(o.card, size.width, size.height);
		}
		const source = this.sourceFor(o);
		if (!source) return null;
		const sourceTime = o.sourceStart + (t - p.start);
		source.want(sourceTime, playing);
		return source.frameAt(sourceTime);
	}

	/** Pictures and words on the overlay tracks at `t`, lowest track first. */
	private visualDraws(t: number, playing: boolean, textOnly = false): VisualDraw[] {
		if (!this.canvas) return [];
		const { width, height } = this.canvas;
		const draws: VisualDraw[] = [];
		for (const v of this.visualsAt(t)) {
			if (v.type === 'text') {
				// Words being typed are shown by the HTML editor instead.
				if (v.item.id === this.hiddenTextId) continue;
				const d = textDraw(v.item, t, width, height, this.sprites);
				if (d) draws.push({ type: 'text', draw: d });
				continue;
			}
			if (textOnly) continue;
			const frame = this.overlayFrame(v.placed, t, playing);
			if (!frame) continue;
			draws.push({
				type: 'overlay',
				draw: overlayDraw(
					frame,
					v.placed,
					t,
					this.mood,
					width,
					height,
					this.projectWidth,
					this.lookup.sourceSize(v.placed.overlay.mediaId) ?? undefined
				)
			});
		}
		return draws;
	}

	private peekFrame(target: { sceneId: string; sourceTime: number }) {
		const scene = this.scenes.find((s) => s.id === target.sceneId);
		const source = scene && this.sourceFor(scene);
		if (!source) return null;
		source.want(target.sourceTime, false);
		return source.frameAt(target.sourceTime);
	}

	/**
	 * What crop mode shows: a scene, or a layer (as a stand-in scene with the layer's id, so it
	 * uses the layer's own decoder), at the source time under the playhead.
	 */
	private cropTarget(id: string, t: number): (PlacedScene & { sourceTime: number }) | null {
		const scene = this.placed.find((p) => p.scene.id === id);
		if (scene) return { ...scene, sourceTime: sourceTimeAt(scene, t) };
		const layer = this.placedOverlays.find((p) => p.overlay.id === id);
		if (!layer) return null;
		const o = layer.overlay;
		const local = Math.min(Math.max(0, t - layer.start), o.duration - 1 / 30);
		const stand: Scene = {
			id: o.id,
			mediaId: o.mediaId,
			kind: o.kind,
			name: o.name,
			sourceStart: o.sourceStart,
			sourceEnd: o.sourceStart + o.duration,
			speed: 1,
			volume: 0,
			mood: null,
			transition: { kind: 'cut', duration: 0 },
			crop: o.crop
		};
		return {
			scene: stand,
			index: -1,
			start: layer.start,
			end: layer.end,
			duration: o.duration,
			sourceTime: o.kind === 'video' ? o.sourceStart + local : 0
		};
	}

	private placedAt(t: number): PlacedScene | null {
		const placed = this.placed;
		if (!placed.length) return null;
		for (const p of placed) if (t < p.end) return p;
		return placed[placed.length - 1];
	}

	/** Keep decoders busy only for scenes and layers near the playhead; let the rest sleep. */
	private manageSources(t: number) {
		const ahead0 = this.playing ? PREFETCH : 0.6;
		for (const p of this.placedOverlays) {
			if (p.overlay.kind === 'card') continue;
			const near = (t >= p.start && t < p.end) || (p.start >= t && p.start - t < ahead0);
			if (near) {
				const source = this.sourceFor(p.overlay);
				if (source && !(t >= p.start && t < p.end)) source.want(p.overlay.sourceStart, this.playing);
			} else if (this.cropViewId !== p.overlay.id) {
				this.sources.get(p.overlay.id)?.source?.idle();
			}
		}
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
		// The audio clock drives time, but only once sound has actually started: while playback is
		// warming up (waiting for the first frame), time holds still.
		if (this.playing && this.audio.isRunning) {
			t = Math.min(this.audio.now(), this.duration);
			if (t !== this.time) this.setTime(t);
			if (t >= this.duration) {
				this.pause();
				this.setTime(this.duration);
			}
		}
		this.draw(t);
	};

	/** Draw the frame for time `t` if anything changed since the last draw. */
	private draw(t: number) {
		if (!this.compositor || !this.canvas) return;

		this.manageSources(t);
		let composite: CompositeFrame;
		const cropPlaced = this.cropViewId ? this.cropTarget(this.cropViewId, t) : null;
		if (cropPlaced) {
			const whole: Scene = {
				...cropPlaced.scene,
				crop: undefined,
				frame: { ...DEFAULT_FRAME, mode: 'fit' }
			};
			const ref = {
				placed: { ...cropPlaced, scene: whole },
				sourceTime: cropPlaced.sourceTime
			};
			const frame = this.layerFrame(ref, false);
			composite = {
				a: frame
					? layerInput(
							frame,
							whole,
							this.mood,
							this.canvas.width,
							this.canvas.height,
							this.lookup.sourceSize(whole.mediaId) ?? undefined
						)
					: null
			};
		} else if (this.peekTarget) {
			const frame = this.peekFrame(this.peekTarget);
			const scene = this.scenes.find((s) => s.id === this.peekTarget!.sceneId);
			composite = {
				a:
					frame && scene
						? layerInput(
								frame,
								scene,
								this.mood,
								this.canvas.width,
								this.canvas.height,
								this.lookup.sourceSize(scene.mediaId) ?? undefined
							)
						: null
			};
		} else {
			const c = this.composition(t);
			composite = {
				a: c.a ? this.layerInput(c.a, this.playing) : null,
				b: c.b ? this.layerInput(c.b, this.playing) : null,
				transition: c.transition
			};
		}
		// Crop mode shows just the picture; while trimming (peek) only words stay on top.
		const visuals = cropPlaced ? [] : this.visualDraws(t, this.playing, !!this.peekTarget);
		composite.visuals = visuals;
		const layerKey = (l: LayerInput | null | undefined) =>
			l
				? `${objectId(l.image)}:${JSON.stringify(l.grade)}:${JSON.stringify(l.rect)}:${l.bars}`
				: 'none';
		const key = [
			`${this.canvas.width}x${this.canvas.height}`,
			layerKey(composite.a),
			layerKey(composite.b),
			composite.transition
				? `${composite.transition.kind}:${composite.transition.progress.toFixed(4)}`
				: '',
			visuals
				.map(({ type, draw: d }) =>
					type === 'text'
						? `t:${d.key}:${d.opacity.toFixed(3)}:${d.scale.toFixed(3)}:${d.cx.toFixed(1)}:${d.cy.toFixed(1)}`
						: `o:${objectId(d.image)}:${JSON.stringify(d.rect)}:${JSON.stringify(d.uv)}:${d.radius}:${d.borderWidth}:${d.borderColor}:${JSON.stringify(d.shadow)}:${d.opacity.toFixed(3)}`
				)
				.join(',')
		].join('|');
		if (!this.dirty && key === this.lastDrawnKey) return;
		this.dirty = false;
		this.lastDrawnKey = key;

		this.compositor.render(composite);
		this.sprites.endFrame();
	}

	/** For tests: the colour of a pixel in the preview. */
	readPixel(x: number, y: number) {
		return this.compositor?.readPixel(x, y) ?? null;
	}

	/** The decoded picture of a scene at a source time, if it's ready (used by the reframe view). */
	frameImage(sceneId: string, sourceTime: number): FrameImage | null {
		const scene: Decodable | undefined =
			this.scenes.find((s) => s.id === sceneId) ?? this.overlays.find((o) => o.id === sceneId);
		const source = scene && this.sourceFor(scene);
		if (!source) return null;
		source.want(sourceTime, false);
		return source.frameAt(sourceTime)?.image ?? null;
	}

	/** For tests: audio context state and how many sound buffers are queued. */
	audioStats() {
		return this.audio.stats();
	}

	/** For tests: whether the frames at the current time are decoded exactly. */
	isFrameReady(): boolean {
		return this.framesReady(this.time, this.playing);
	}

	dispose(): void {
		this.pause();
		cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.compositor?.dispose();
		this.compositor = null;
		this.surfaces = [];
		this.canvas = null;
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
