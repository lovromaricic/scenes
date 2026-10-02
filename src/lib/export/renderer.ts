import { getHandle } from '$lib/media/handles';
import type { FrameResult } from '$lib/media/frames';
import { compose, scenesNeeded } from '$lib/model/composition';
import type { SourceBounds } from '$lib/model/edits';
import { placeOverlays, type PlacedOverlay } from '$lib/model/overlay';
import { placeScenes, videoLength, type PlacedScene } from '$lib/model/timeline';
import type { Project, Scene } from '$lib/model/types';
import { CardCache } from '$lib/render/card';
import { Compositor, type CompositeFrame } from '$lib/render/compositor';
import { ensureFonts } from '$lib/render/fonts';
import { layerInput } from '$lib/render/frame';
import { cardSize, overlayDraw } from '$lib/render/overlay';
import { TextSpriteCache } from '$lib/render/text';
import { textDraw, visualsAt, type VisualDraw } from '$lib/render/visuals';
import { resolveTextStyle } from '$lib/model/textStyle';
import { PhotoExportReader, VideoExportReader, type ExportFrameReader } from './reader';

/** How far ahead (seconds) the next scenes' decoders are started. */
const PREPARE_AHEAD = 2;

export interface RendererOptions {
	project: Project;
	width: number;
	height: number;
	bounds: (scene: Scene) => SourceBounds;
	/** A file's own picture size (crops are measured in it). */
	sourceSize: (mediaId: string) => { width: number; height: number } | null;
	/** Only the overlay tracks and words, on a transparent background ("Overlays only"). */
	overlaysOnly?: boolean;
}

/**
 * Draws the video's frames one at a time, exactly as the preview does (the same compositor,
 * `compose`, keyframes and overlay drawing), for every kind of saving: video, GIF, a single frame
 * and transparent overlays. Frames are asked for in time order; decoders are started a little
 * ahead and freed once they're behind.
 */
export class FrameRenderer {
	readonly canvas: OffscreenCanvas;
	readonly duration: number;
	private readonly compositor: Compositor;
	private readonly sprites = new TextSpriteCache();
	private readonly cards = new CardCache();
	private readonly readers = new Map<string, Promise<ExportFrameReader>>();
	private readonly lastGood = new Map<string, FrameResult>();
	private readonly placed: PlacedScene[];
	private readonly layers: PlacedOverlay[];
	private lastPrepared = -Infinity;

	constructor(private readonly o: RendererOptions) {
		this.placed = placeScenes(o.project.scenes);
		this.duration = videoLength(o.project);
		this.layers = placeOverlays(o.project.overlays ?? []);
		this.canvas = new OffscreenCanvas(o.width, o.height);
		this.compositor = new Compositor(this.canvas, { transparent: !!o.overlaysOnly });
	}

	/** Every font the words use must be ready before the first frame. */
	async ready(): Promise<void> {
		await ensureFonts(this.o.project.texts.map((t) => resolveTextStyle(t).font));
	}

	private readerFor(scene: Pick<Scene, 'id' | 'mediaId'>): Promise<ExportFrameReader> {
		let r = this.readers.get(scene.id);
		if (!r) {
			r = getHandle(scene.mediaId).then((h) =>
				h.info.kind === 'photo'
					? new PhotoExportReader(h, this.o.width, this.o.height)
					: new VideoExportReader(h, this.o.width, this.o.height)
			);
			this.readers.set(scene.id, r);
		}
		return r;
	}

	/**
	 * Start the decoders of the scenes needed in the next 2 seconds (the same `compose` rules as
	 * drawing), so the incoming scene of a transition is ready when it starts.
	 */
	private prepareAhead(t: number) {
		if (t - this.lastPrepared < 0.5 && t >= this.lastPrepared) return;
		this.lastPrepared = t;
		if (this.o.overlaysOnly) return;
		for (const n of scenesNeeded(this.placed, t, t + PREPARE_AHEAD, (p) => this.o.bounds(p.scene))) {
			if (n.placed.scene.kind === 'card') continue;
			void this.readerFor(n.placed.scene)
				.then((r) => r.prepare(n.firstSourceTime))
				.catch(() => {});
		}
	}

	private async layer(ref: { placed: PlacedScene; sourceTime: number; contentTime: number } | null) {
		if (!ref) return null;
		const { project, width, height } = this.o;
		const scene = ref.placed.scene;
		if (scene.kind === 'card') {
			return scene.card
				? layerInput(this.cards.frame(scene.card, width, height), scene, project.mood, width, height, undefined, ref.contentTime)
				: null;
		}
		const decoded = await (await this.readerFor(scene)).frameAt(ref.sourceTime);
		// If a frame isn't there, the scene keeps its last good frame (never a black gap).
		if (decoded) this.lastGood.set(scene.id, decoded);
		else if (import.meta.env.DEV) console.debug(`[export] no frame for ${scene.id} at ${ref.sourceTime}; using its last one`);
		const frame = decoded ?? this.lastGood.get(scene.id) ?? null;
		return frame
			? layerInput(frame, scene, project.mood, width, height, this.o.sourceSize(scene.mediaId) ?? undefined, ref.contentTime)
			: null;
	}

	private async overlayFrame(p: PlacedOverlay, t: number) {
		const o = p.overlay;
		if (o.kind === 'card') {
			if (!o.card) return null;
			const size = cardSize(p, this.o.width, this.o.height);
			return this.cards.frame(o.card, size.width, size.height);
		}
		return (await this.readerFor(o)).frameAt(o.sourceStart + (t - p.start));
	}

	/** The overlay tracks' pictures and words at `t`, lowest first (hidden tracks left out). */
	private async visuals(t: number): Promise<VisualDraw[]> {
		const { project, width, height } = this.o;
		const draws: VisualDraw[] = [];
		for (const v of visualsAt(project, t, this.duration)) {
			if (v.type === 'text') {
				const d = textDraw(v.item, t, width, height, this.sprites, this.compositor.maxTextureSize);
				if (d) draws.push({ type: 'text', draw: d });
				continue;
			}
			const frame = await this.overlayFrame(v.placed, t);
			if (!frame) continue;
			draws.push({
				type: 'overlay',
				draw: overlayDraw(
					frame,
					v.placed,
					t,
					project.mood,
					width,
					height,
					project.format.width,
					this.o.sourceSize(v.placed.overlay.mediaId) ?? undefined
				)
			});
		}
		return draws;
	}

	/** Draw the frame at timeline time `t` onto `canvas`. */
	async render(t: number): Promise<void> {
		this.prepareAhead(t);
		let frame: CompositeFrame;
		if (this.o.overlaysOnly) {
			frame = { a: null, visuals: await this.visuals(t) };
		} else {
			const c = compose(this.placed, t, (p) => this.o.bounds(p.scene));
			frame = { a: await this.layer(c.a), b: await this.layer(c.b), transition: c.transition, visuals: await this.visuals(t) };
		}
		this.compositor.render(frame);
		this.sprites.endFrame();
		this.release(t);
	}

	/** Scenes and layers well behind `t` won't be needed again (frames go forward): free them. */
	private release(t: number) {
		const done = [
			...this.placed.filter((p) => p.end + 1.5 < t).map((p) => p.scene.id),
			...this.layers.filter((p) => p.end + 1.5 < t).map((p) => p.overlay.id)
		];
		for (const id of done) {
			const r = this.readers.get(id);
			if (r) {
				void r.then((x) => x.dispose()).catch(() => {});
				this.readers.delete(id);
			}
		}
	}

	dispose(): void {
		for (const r of this.readers.values()) void r.then((x) => x.dispose()).catch(() => {});
		this.readers.clear();
		this.compositor.dispose();
	}
}
