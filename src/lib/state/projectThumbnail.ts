import { getMediaInfos, getThumbnail, projectThumbnail, putProjectThumbnail } from '$lib/media/db';
import { croppedSize } from '$lib/model/crop';
import { frameRect, showsBars } from '$lib/model/framing';
import type { MediaInfo } from '$lib/media/db';
import type { Project } from '$lib/model/types';
import { drawCard } from '$lib/render/card';
import { visualsAt } from '$lib/render/visuals';
import { placeScenes } from '$lib/model/timeline';
import { compose } from '$lib/model/composition';
import { sceneFrameAt } from '$lib/model/keyframes';
import { overlayDraw } from '$lib/render/overlay';

/**
 * The picture on a project's card on the home screen: its first scene, in the project's shape,
 * with its crop and framing. Small (320 px wide) and regenerated only when the first scene, its
 * look or the format changes.
 */

const WIDTH = 320;

export function thumbnailKey(project: Project): string {
	const s = sceneAtStart(project);
	// Layers showing at the start are part of the picture too.
	const layers = startLayers(project).map((p) => p.overlay);
	return s
		? JSON.stringify([s.mediaId, s.kind, s.crop, s.frame, s.keyframes, s.card, project.format.width, project.format.height, layers])
		: '';
}

/**
 * The scene showing at 0 s, by the same rule the preview and export use (`compose`). (It's the
 * first scene: no transition can be running at the very start.)
 */
function sceneAtStart(project: Pick<Project, 'scenes'>) {
	const placed = placeScenes(project.scenes);
	return compose(placed, 0, (p) => ({ start: p.scene.sourceStart, end: p.scene.sourceEnd })).a?.placed.scene;
}

/** Pictures on (shown) overlay tracks at the very start, lowest track first. */
function startLayers(project: Project) {
	const length = placeScenes(project.scenes).at(-1)?.end ?? 0;
	return visualsAt(project, 0, length).flatMap((v) => (v.type === 'overlay' ? [v.placed] : []));
}

export async function makeProjectThumbnail(project: Project, media: Record<string, MediaInfo>): Promise<Blob | null> {
	const scene = sceneAtStart(project);
	if (!scene) return null;
	const w = WIDTH;
	const h = Math.round((WIDTH * project.format.height) / project.format.width);
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#141417';
	ctx.fillRect(0, 0, w, h);
	if (scene.kind === 'card') {
		if (scene.card) drawCard(ctx, scene.card, 0, 0, w, h);
	} else {
		const blob = await getThumbnail(scene.mediaId);
		const info = media[scene.mediaId];
		if (!blob || !info) return null;
		const image = await createImageBitmap(blob);
		// The media thumbnail is smaller than the source: map the crop proportionally.
		const k = image.width / info.width;
		const crop = scene.crop ?? { x: 0, y: 0, w: info.width, h: info.height };
		const size = croppedSize(scene.crop, info);
		const r = frameRect(sceneFrameAt(scene.frame, scene.keyframes, scene.sourceStart), size.width, size.height, w, h);
		if (showsBars(r, w, h) && scene.frame?.bars === 'white') {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, w, h);
		}
		ctx.drawImage(image, crop.x * k, crop.y * k, crop.w * k, crop.h * k, r.x, r.y, r.w, r.h);
		image.close();
	}
	await drawLayers(ctx, project, media, w, h);
	return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
}

/** Layers at the start, drawn like the compositor draws them (corners, border, shadow, opacity). */
async function drawLayers(
	ctx: OffscreenCanvasRenderingContext2D,
	project: Project,
	media: Record<string, MediaInfo>,
	w: number,
	h: number
) {
	for (const p of startLayers(project)) {
		const o = p.overlay;
		let image: ImageBitmap | null = null;
		let size = { width: w, height: h };
		if (o.kind !== 'card') {
			const blob = await getThumbnail(o.mediaId);
			const info = media[o.mediaId];
			if (!blob || !info) continue;
			image = await createImageBitmap(blob);
			size = info;
		}
		// Fully shown (no entrance), as it is once it has appeared.
		const d = overlayDraw(
			{ image: (image ?? new OffscreenCanvas(1, 1)) as never, width: size.width, height: size.height, exact: true } as never,
			{ ...p, overlay: { ...o, enter: 'none' } },
			p.start + Math.min(1, o.duration / 2),
			project.mood,
			w,
			h,
			project.format.width,
			size
		);
		const { x, y, w: bw, h: bh } = d.rect;
		const path = (inset: number) => {
			const r = Math.max(0, d.radius - inset);
			const p2 = new Path2D();
			p2.roundRect(x + inset, y + inset, bw - 2 * inset, bh - 2 * inset, r);
			return p2;
		};
		ctx.save();
		// Turned around its centre, like the compositor.
		ctx.translate(x + bw / 2, y + bh / 2);
		ctx.rotate(d.rotation);
		ctx.translate(-(x + bw / 2), -(y + bh / 2));
		ctx.globalAlpha = d.opacity;
		if (d.shadow) {
			ctx.shadowColor = `rgba(0,0,0,${d.shadow.alpha})`;
			ctx.shadowBlur = d.shadow.blur;
			ctx.shadowOffsetY = d.shadow.offsetY;
		}
		ctx.fillStyle = d.borderWidth > 0 ? o.style.borderColor : '#000';
		ctx.fill(path(0));
		ctx.shadowColor = 'transparent';
		ctx.clip(path(d.borderWidth));
		const ix = x + d.borderWidth;
		const iy = y + d.borderWidth;
		const iw = bw - 2 * d.borderWidth;
		const ih = bh - 2 * d.borderWidth;
		if (o.kind === 'card') {
			if (o.card) drawCard(ctx, o.card, ix, iy, iw, ih);
		} else if (image) {
			// uv is bottom-up in 0–1 of the image; the thumbnail is the same picture, smaller.
			const [u, v, uw, vh] = d.uv;
			ctx.drawImage(
				image,
				u * image.width,
				(1 - v - vh) * image.height,
				uw * image.width,
				vh * image.height,
				ix,
				iy,
				iw,
				ih
			);
			image.close();
		}
		ctx.restore();
	}
}

/**
 * The project's picture, made again if it's missing or out of date (e.g. the editor was closed
 * before it caught up). Returns null for empty projects.
 */
export async function currentProjectThumbnail(project: Project): Promise<Blob | null> {
	const key = thumbnailKey(project);
	if (!key) return null;
	const stored = await projectThumbnail(project.id);
	if (stored && stored.key === key) return stored.blob;
	const scene = sceneAtStart(project);
	const media: Record<string, MediaInfo> = {};
	if (scene && scene.kind !== 'card') for (const info of await getMediaInfos([scene.mediaId])) media[info.id] = info;
	const blob = await makeProjectThumbnail(project, media).catch(() => null);
	if (blob) await putProjectThumbnail(project.id, blob, key);
	return blob ?? stored?.blob ?? null;
}
