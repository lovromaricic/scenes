import { legacyFormat } from './format';
import { resolveTextStyle, TEXT_STYLE_SPECS } from './textStyle';
import type { Project } from './types';
import { migrateSounds } from './sound';
import { migrateToTracks } from './tracks';
import { placeScenes } from './timeline';
import { tidyKeyframes } from './keyframes';

/**
 * Pure helpers for managing many projects: what each one uses, what becomes unused when one is
 * deleted, bringing old project data up to date, and friendly dates.
 */

/** Every stored file (clip, photo, sound) a project refers to, including "Your media". */
export function projectMediaIds(
	project: Pick<Project, 'scenes' | 'sounds' | 'library'> & { overlays?: Project['overlays'] }
): string[] {
	const ids = [
		...project.scenes.filter((s) => s.kind !== 'card').map((s) => s.mediaId),
		...project.sounds.map((s) => s.mediaId),
		...(project.overlays ?? []).filter((o) => o.kind !== 'card').map((o) => o.mediaId),
		...(project.library ?? [])
	].filter(Boolean);
	return ids.filter((id, i) => ids.indexOf(id) === i);
}

/** Stored font faces (from this computer or uploaded) a project's words use. */
export function projectFontIds(project: Pick<Project, 'texts'>): string[] {
	const ids = project.texts.map((t) => t.font).filter((f) => f && f.source !== 'builtin').map((f) => f!.id);
	return ids.filter((id, i) => ids.indexOf(id) === i);
}

/** Media and fonts that only the deleted project used (so they can be deleted with it). */
export function orphansAfterDelete(
	projects: Pick<Project, 'id' | 'scenes' | 'sounds' | 'library' | 'texts'>[],
	deletedId: string
): { media: string[]; fonts: string[] } {
	const deleted = projects.find((p) => p.id === deletedId);
	if (!deleted) return { media: [], fonts: [] };
	const others = projects.filter((p) => p.id !== deletedId);
	const otherMedia = others.flatMap(projectMediaIds);
	const otherFonts = others.flatMap(projectFontIds);
	return {
		media: projectMediaIds(deleted).filter((id) => !otherMedia.includes(id)),
		fonts: projectFontIds(deleted).filter((id) => !otherFonts.includes(id))
	};
}

/**
 * Bring project data saved by an older version of Scenes up to date. Safe to run on current
 * data (it changes nothing then). Used when restoring from the browser and when opening files.
 */
export function migrateProject<T extends Partial<Project> & { aspect?: string }>(input: T): Project {
	const project = structuredClone(input) as Project & { aspect?: string };
	// Before formats, projects only had a shape ("aspect").
	if (!project.format) {
		project.format = legacyFormat(project.aspect);
		project.formatSet = true;
	}
	delete project.aspect;
	project.formatSet ??= true;
	project.scenes ??= [];
	project.texts ??= [];
	project.sounds ??= [];
	// Before trimming, fade lengths and Sound rows.
	project.sounds = migrateSounds(project.sounds as never) as never;
	project.overlays ??= [];
	// Before tracks: Layers rows, the Words lane and Sound rows become tracks; overlays linked to
	// scenes keep their place on the timeline.
	const sceneStarts = new Map(placeScenes(project.scenes).map((p) => [p.scene.id, p.start]));
	const withTracks = migrateToTracks(project as never, sceneStarts, () => crypto.randomUUID());
	Object.assign(project, withTracks);
	// Keyframes and volume points (format 3): sorted and well formed, or none.
	for (const o of project.overlays) {
		o.keyframes = tidyKeyframes(o.keyframes);
		o.volumePoints = tidyKeyframes(o.volumePoints);
		if (!o.keyframes) delete o.keyframes;
		if (!o.volumePoints) delete o.volumePoints;
	}
	for (const t of project.texts) {
		t.keyframes = tidyKeyframes(t.keyframes);
		if (!t.keyframes) delete t.keyframes;
	}
	for (const sc of project.scenes) {
		sc.keyframes = tidyKeyframes(sc.keyframes);
		sc.volumePoints = tidyKeyframes(sc.volumePoints);
		if (!sc.keyframes) delete sc.keyframes;
		if (!sc.volumePoints) delete sc.volumePoints;
	}
	for (const sd of project.sounds) {
		sd.volumePoints = tidyKeyframes(sd.volumePoints);
		if (!sd.volumePoints) delete sd.volumePoints;
	}
	// The range set with I and O (format 3): within reason, or none.
	const r = project.range;
	if (r && !(Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start && r.start >= 0)) project.range = null;
	project.mood ??= 'natural';
	project.title ??= 'My video';
	// Words in a style this version doesn't know are shown in the plain style.
	for (const text of project.texts) if (!(text.style in TEXT_STYLE_SPECS)) text.style = 'clean';
	// Before "Your media", the list is rebuilt from the scenes.
	project.library ??= project.scenes
		.filter((s) => s.kind !== 'card')
		.map((s) => s.mediaId)
		.filter((id, i, all) => all.indexOf(id) === i);
	project.createdAt ??= Date.now();
	project.updatedAt ??= project.createdAt;
	return project;
}

/** The total length and the fonts' families, for a project's card on the home screen. */
export function projectFonts(project: Pick<Project, 'texts'>): string[] {
	return project.texts.map((t) => resolveTextStyle(t).font.family).filter((f, i, all) => all.indexOf(f) === i);
}

/** "Edited just now", "Edited 5 minutes ago", "Edited yesterday", "Edited 3 Mar". */
export function formatEdited(time: number, now = Date.now()): string {
	const s = Math.max(0, (now - time) / 1000);
	if (s < 60) return 'Edited just now';
	const m = Math.floor(s / 60);
	if (m < 60) return `Edited ${m} minute${m === 1 ? '' : 's'} ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `Edited ${h} hour${h === 1 ? '' : 's'} ago`;
	const d = Math.floor(h / 24);
	if (d === 1) return 'Edited yesterday';
	if (d < 7) return `Edited ${d} days ago`;
	const date = new Date(time);
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	return `Edited ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}

/** A copy's name: "Trip" → "Trip (copy)". */
export function copyName(title: string): string {
	return `${title.replace(/\s+\(copy\)$/, '')} (copy)`;
}
