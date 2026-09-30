import type { FontFaceRecord, MediaInfo, ProjectView } from '$lib/media/db';
import { migrateProject } from '$lib/model/projects';
import type { Project } from '$lib/model/types';

/**
 * The `.scenes` project file: a zip archive with
 *
 *   manifest.json   what this is (app, format version, name, dates) — written first
 *   project.json    the project, plus info about its media and fonts
 *   thumbnail.jpg   the project's picture
 *   media/…         clips, photos and sounds (stored uncompressed: they're compressed already)
 *   thumbnails/…    each clip's small picture, so opening doesn't need to decode anything
 *   fonts/…         uploaded fonts and fonts from this computer that the words use
 *
 * Built-in fonts come with the app and aren't included.
 */

export const APP_NAME = 'Scenes';
export const FILE_FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.scenes';
export const FILE_MIME = 'application/x-scenes-project';
export const FILE_TYPES = [{ description: 'Scenes project', accept: { [FILE_MIME]: [FILE_EXTENSION] } }];

export interface Manifest {
	app: string;
	formatVersion: number;
	name: string;
	createdAt: number;
	savedAt: number;
}

export interface FileMedia extends MediaInfo {
	/** Path of the file inside the archive. */
	path: string;
	thumbnailPath?: string;
}

export type FontMeta = Omit<FontFaceRecord, 'blob'>;

export interface FileFont extends FontMeta {
	path: string;
}

export interface ProjectJson {
	project: Project;
	view?: ProjectView;
	media: FileMedia[];
	fonts: FileFont[];
}

/** Something the user can read when a file can't be opened. */
export class ProjectFileError extends Error {}

export const NOT_A_PROJECT = 'This file isn’t a Scenes project. Project files end in .scenes.';
export const DAMAGED = 'This project file is damaged, so it can’t be opened. If you have another copy, try that one.';
export const TOO_NEW =
	'This project was saved by a newer version of Scenes. Reload the page to get the latest version, then try again.';

const extension = (name: string, fallback: string) => {
	const m = /\.([a-z0-9]{1,8})$/i.exec(name);
	return (m ? m[1] : fallback).toLowerCase();
};

export const mediaPath = (info: MediaInfo) => `media/${info.id}.${extension(info.name, 'bin')}`;
export const mediaThumbnailPath = (info: MediaInfo) => `thumbnails/${info.id}.jpg`;
export function fontPath(font: FontMeta, blob: Blob): string {
	const ext = /woff2/.test(blob.type) ? 'woff2' : /woff/.test(blob.type) ? 'woff' : /otf|opentype/.test(blob.type) ? 'otf' : 'ttf';
	return `fonts/${font.id}.${ext}`;
}

/** A safe file name for a project: "Summer trip" → "Summer trip.scenes". */
export function projectFileName(title: string): string {
	const clean = Array.from(title)
		.filter((ch) => ch.charCodeAt(0) >= 32)
		.join('')
		.replace(/[\\/:*?"<>|]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80);
	return `${clean || 'Untitled video'}${FILE_EXTENSION}`;
}

/** Check the manifest; throws a ProjectFileError with a friendly message if it's not usable. */
export function checkManifest(value: unknown): Manifest {
	const m = value as Partial<Manifest> | null;
	if (!m || typeof m !== 'object' || m.app !== APP_NAME) throw new ProjectFileError(NOT_A_PROJECT);
	if (typeof m.formatVersion !== 'number' || m.formatVersion < 1) throw new ProjectFileError(DAMAGED);
	if (m.formatVersion > FILE_FORMAT_VERSION) throw new ProjectFileError(TOO_NEW);
	return m as Manifest;
}

/**
 * Bring project.json from any earlier format version up to date, and check it has what's needed.
 * Version 1 is the first; later versions add their steps here (`if (version < 2) …`).
 */
export function migrateProjectJson(value: unknown, _version: number): ProjectJson {
	const data = value as Partial<ProjectJson> | null;
	const project = data?.project as Partial<Project> | undefined;
	if (
		!data ||
		!project ||
		typeof project.id !== 'string' ||
		!Array.isArray(project.scenes) ||
		!Array.isArray(data.media)
	) {
		throw new ProjectFileError(DAMAGED);
	}
	return {
		project: migrateProject(project),
		view: data.view,
		media: data.media,
		fonts: Array.isArray(data.fonts) ? data.fonts : []
	};
}
