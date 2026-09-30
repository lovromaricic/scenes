import {
	deleteProject,
	getProject,
	listProjects,
	projectThumbnail,
	putProjectThumbnail,
	saveProject,
	type ProjectRecord
} from '$lib/media/db';
import { copyName, migrateProject, orphansAfterDelete } from '$lib/model/projects';
import { emergencyCopy } from './autosave';
import { newId } from './project';

/**
 * The projects kept in this browser, for the home screen: listing, renaming, duplicating and
 * deleting. Editing a project happens in the editor (EditorStore); these work on stored copies.
 */

/**
 * Store any emergency copies (written when a tab closed before IndexedDB caught up) that are newer
 * than the stored project, so the home screen and these actions see the latest version.
 */
export async function settleEmergencyCopies(): Promise<void> {
	for (const id of emergencyCopy.ids()) {
		const copy = emergencyCopy.read(id);
		if (!copy) continue;
		const stored = await getProject(id);
		if (!stored || (copy.savedAt ?? 0) > (stored.savedAt ?? 0)) await saveProject(copy);
		emergencyCopy.remove(id);
	}
}

const pending = new Set<Promise<unknown>>();

/** Saves still being written by an editor that was just closed; the home screen waits for them. */
export function trackPendingSave(save: Promise<unknown>): void {
	pending.add(save);
	void save.finally(() => pending.delete(save));
}

/** Every project, most recently edited first, brought up to date. */
export async function allProjects(): Promise<ProjectRecord[]> {
	await Promise.allSettled([...pending]);
	await settleEmergencyCopies();
	return (await listProjects()).map((p) => ({ ...p, ...migrateProject(p) }));
}

export async function renameProject(id: string, title: string): Promise<void> {
	const project = await getProject(id);
	if (!project) return;
	const clean = title.trim().slice(0, 80) || 'Untitled video';
	if (clean === project.title) return;
	const now = Date.now();
	await saveProject({ ...project, title: clean, updatedAt: now, savedAt: now });
}

/** A copy with its own id, sharing the same stored media (files are kept once). */
export async function duplicateProject(id: string): Promise<ProjectRecord | undefined> {
	const project = await getProject(id);
	if (!project) return undefined;
	const now = Date.now();
	const copy: ProjectRecord = {
		...structuredClone(project),
		id: newId(),
		title: copyName(project.title),
		createdAt: now,
		updatedAt: now,
		savedAt: now
	};
	await saveProject(copy);
	const thumb = await projectThumbnail(id);
	if (thumb) await putProjectThumbnail(copy.id, thumb.blob, thumb.key);
	return copy;
}

/** Delete a project, and the media and fonts no other project uses. */
export async function removeProject(id: string): Promise<void> {
	emergencyCopy.remove(id);
	const projects = await listProjects();
	await deleteProject(id, orphansAfterDelete(projects, id));
}
