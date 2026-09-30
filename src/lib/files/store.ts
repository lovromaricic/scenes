import {
	deleteMedia,
	findMediaByHash,
	getFontFace,
	getMedia,
	getProject,
	getThumbnail,
	listProjects,
	putFileLink,
	putFontFace,
	putMedia,
	putProjectThumbnail,
	putThumbnail,
	saveProject,
	type MediaInfo
} from '$lib/media/db';
import { fingerprint } from '$lib/media/fingerprint';
import { copyName, projectFontIds, projectMediaIds } from '$lib/model/projects';
import type { Project } from '$lib/model/types';
import { emergencyCopy } from '$lib/state/autosave';
import { newId } from '$lib/state/project';
import { currentProjectThumbnail, thumbnailKey } from '$lib/state/projectThumbnail';
import { DAMAGED, ProjectFileError } from './format';
import type { OpenedProjectFile, ProjectBundle } from './zip';

/**
 * Moving projects between this browser's storage and project files: gathering everything a
 * project needs to go into a file, and storing an opened file's project, media and fonts.
 */

/** A project with its media (clips, photos, sounds used or in "Your media") and fonts. */
export async function collectBundle(projectId: string): Promise<ProjectBundle> {
	const record = await getProject(projectId);
	if (!record) throw new Error('This video isn’t in the app any more.');
	const { view, savedAt: _savedAt, ...project } = record;
	const media: ProjectBundle['media'] = [];
	for (const id of projectMediaIds(project)) {
		const stored = await getMedia(id);
		if (!stored) continue;
		const { blob, ...info } = stored;
		media.push({ info, blob, thumbnail: await getThumbnail(id) });
	}
	const fonts: ProjectBundle['fonts'] = [];
	for (const id of projectFontIds(project)) {
		const stored = await getFontFace(id);
		if (!stored) continue;
		const { blob, ...meta } = stored;
		fonts.push({ meta, blob });
	}
	const thumbnail = await currentProjectThumbnail(project).catch(() => null);
	return { project, view, media, fonts, thumbnail };
}

export type OpenMode = 'new' | 'replace' | 'copy';

/**
 * Store an opened project file's project, media and fonts in this browser.
 * - `new`: the project isn't in the app yet; it keeps its id.
 * - `replace`: overwrite the project with the same id.
 * - `copy`: keep both; the file's project gets a new id and " (copy)" in its name.
 * Files already stored (same id or same contents) aren't stored again.
 * Returns the id of the stored project.
 */
export async function storeOpenedFile(
	opened: OpenedProjectFile,
	options: {
		mode: OpenMode;
		fileName: string;
		handle?: FileSystemFileHandle;
		onProgress?: (fraction: number) => void;
	}
): Promise<string> {
	const { data } = opened;
	const total = data.media.reduce((n, m) => n + (m.size || 0), 0) + 1;
	let done = 0;
	const ids = new Map<string, string>();

	for (const m of data.media) {
		const { path, thumbnailPath, ...fields } = m;
		const info: MediaInfo = fields;
		if (await getMedia(info.id)) {
			ids.set(info.id, info.id);
		} else {
			const blob = await opened.read(path, info.mime);
			if (blob.size !== info.size) throw new ProjectFileError(DAMAGED);
			const hash = info.hash ?? (await fingerprint(blob));
			const same = await findMediaByHash(hash);
			if (same) {
				ids.set(info.id, same.id);
			} else {
				await putMedia({ ...info, hash, blob });
				if (thumbnailPath && opened.has(thumbnailPath)) {
					await putThumbnail(info.id, await opened.read(thumbnailPath, 'image/jpeg'));
				}
				ids.set(info.id, info.id);
			}
		}
		done += info.size || 0;
		options.onProgress?.(done / total);
	}
	for (const f of data.fonts) {
		if (await getFontFace(f.id)) continue;
		const { path, ...meta } = f;
		await putFontFace({ ...meta, blob: await opened.read(path) });
	}

	// The project, pointing at the stored media.
	const project: Project = structuredClone(data.project);
	const mapId = (id: string) => ids.get(id) ?? id;
	for (const scene of project.scenes) if (scene.kind !== 'card') scene.mediaId = mapId(scene.mediaId);
	for (const sound of project.sounds) sound.mediaId = mapId(sound.mediaId);
	for (const o of project.overlays) if (o.kind !== 'card') o.mediaId = mapId(o.mediaId);
	project.library = project.library.map(mapId).filter((id, i, all) => all.indexOf(id) === i);
	if (options.mode === 'copy') {
		project.id = newId();
		project.title = copyName(project.title);
		project.updatedAt = Date.now();
	}

	const previous = options.mode === 'replace' ? await getProject(project.id) : undefined;
	emergencyCopy.remove(project.id);
	await saveProject({ ...project, view: data.view, savedAt: Date.now() });
	if (opened.has('thumbnail.jpg')) {
		const picture = await opened.read('thumbnail.jpg', 'image/jpeg');
		await putProjectThumbnail(project.id, picture, thumbnailKey(project));
	}
	if (previous) await deleteUnusedBy(previous);
	// Opened from a file: Save to file goes back to that file (not for a copy — it's a new project).
	if (options.mode !== 'copy') {
		await putFileLink({
			projectId: project.id,
			name: options.fileName,
			handle: options.handle,
			savedUpdatedAt: project.updatedAt
		});
	}
	options.onProgress?.(1);
	return project.id;
}

/** After replacing a project: delete the media the old version used that nothing uses now. */
async function deleteUnusedBy(old: Project): Promise<void> {
	const used = new Set((await listProjects()).flatMap(projectMediaIds));
	for (const id of projectMediaIds(old)) if (!used.has(id)) await deleteMedia(id);
	// Fonts are small and stay in the font list, so they're kept.
}
