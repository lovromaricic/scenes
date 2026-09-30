import { getThumbnail } from '$lib/media/db';
import { croppedSize } from '$lib/model/crop';
import { frameRect, showsBars } from '$lib/model/framing';
import type { MediaInfo } from '$lib/media/db';
import type { Project } from '$lib/model/types';
import { drawCard } from '$lib/render/card';

/**
 * The picture on a project's card on the home screen: its first scene, in the project's shape,
 * with its crop and framing. Small (320 px wide) and regenerated only when the first scene, its
 * look or the format changes.
 */

const WIDTH = 320;

export function thumbnailKey(project: Project): string {
	const s = project.scenes[0];
	return s ? JSON.stringify([s.mediaId, s.kind, s.crop, s.frame, s.card, project.format.width, project.format.height]) : '';
}

export async function makeProjectThumbnail(project: Project, media: Record<string, MediaInfo>): Promise<Blob | null> {
	const scene = project.scenes[0];
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
		const r = frameRect(scene.frame, size.width, size.height, w, h);
		if (showsBars(r, w, h) && scene.frame?.bars === 'white') {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, w, h);
		}
		ctx.drawImage(image, crop.x * k, crop.y * k, crop.w * k, crop.h * k, r.x, r.y, r.w, r.h);
		image.close();
	}
	return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
}
