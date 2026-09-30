import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '$lib/model/types';

/**
 * Everything Scenes keeps lives in this IndexedDB database on the user's device:
 * imported files (as Blobs), their thumbnails, and projects.
 */

export type MediaKind = 'video' | 'photo' | 'audio';

export interface MediaInfo {
	id: string;
	name: string;
	kind: MediaKind;
	mime: string;
	size: number;
	/** Seconds. 0 for photos. */
	duration: number;
	/** Timestamp of the first frame/sample, in seconds (often 0). */
	startTime: number;
	width: number;
	height: number;
	hasAudio: boolean;
	/** Frames per second (videos), if known. */
	fps?: number;
	/** Content fingerprint (see fingerprint.ts), to store the same file only once. */
	hash?: string;
	createdAt: number;
}

export interface MediaRecord extends MediaInfo {
	blob: Blob;
}

/** What we remember about where the user was, restored with the project. */
export interface ProjectView {
	time: number;
	selectedId: string | null;
}

export interface ProjectRecord extends Project {
	view?: ProjectView;
	/** When this copy was written (ms). Used to pick the newest copy on load. */
	savedAt?: number;
}

/** Where a project was last saved as a file, and which version of it the file holds. */
export interface FileLink {
	projectId: string;
	/** The file's name, e.g. "summer-trip.scenes". */
	name: string;
	/** File System Access handle (Chrome/Edge) so Ctrl/Cmd+S can save there again. */
	handle?: FileSystemFileHandle;
	/** The project's `updatedAt` when it was saved to the file. */
	savedUpdatedAt: number;
}

interface ScenesDB extends DBSchema {
	media: { key: string; value: MediaRecord; indexes: { hash: string } };
	files: { key: string; value: FileLink };
	settings: { key: string; value: { key: string; value: unknown } };
	thumbnails: { key: string; value: { id: string; blob: Blob; key?: string } };
	projects: { key: string; value: ProjectRecord; indexes: { updatedAt: number } };
	waveforms: { key: string; value: { id: string; peaks: Float32Array; perSecond: number } };
	fonts: { key: string; value: FontFaceRecord };
}

/** A font face from this computer or an uploaded file, kept so projects render after a reload. */
export interface FontFaceRecord {
	id: string;
	family: string;
	source: 'local' | 'upload';
	weight: number;
	italic: boolean;
	/** For local fonts: the PostScript name, to avoid storing the same face twice. */
	postscriptName?: string;
	blob: Blob;
	createdAt: number;
}

const DB_NAME = 'scenes';
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase<ScenesDB>> | null = null;

export function db(): Promise<IDBPDatabase<ScenesDB>> {
	dbPromise ??= openDB<ScenesDB>(DB_NAME, DB_VERSION, {
		upgrade(database, oldVersion, _newVersion, transaction) {
			if (oldVersion < 1) {
				database.createObjectStore('media', { keyPath: 'id' });
				database.createObjectStore('thumbnails', { keyPath: 'id' });
				const projects = database.createObjectStore('projects', { keyPath: 'id' });
				projects.createIndex('updatedAt', 'updatedAt');
			}
			if (oldVersion < 2) {
				database.createObjectStore('waveforms', { keyPath: 'id' });
			}
			if (oldVersion < 3) {
				database.createObjectStore('fonts', { keyPath: 'id' });
			}
			if (oldVersion < 4) {
				// Many projects: deduplicate media by content, remember project files, settings.
				// Existing data is kept as it is; media fingerprints are filled in later.
				transaction.objectStore('media').createIndex('hash', 'hash');
				database.createObjectStore('files', { keyPath: 'projectId' });
				database.createObjectStore('settings', { keyPath: 'key' });
			}
		}
	});
	return dbPromise;
}

export async function putMedia(record: MediaRecord): Promise<void> {
	await (await db()).put('media', record);
}

export async function getMedia(id: string): Promise<MediaRecord | undefined> {
	return (await db()).get('media', id);
}

export async function deleteMedia(id: string): Promise<void> {
	const d = await db();
	const tx = d.transaction(['media', 'thumbnails', 'waveforms'], 'readwrite');
	await Promise.all([
		tx.objectStore('media').delete(id),
		tx.objectStore('thumbnails').delete(id),
		tx.objectStore('waveforms').delete(id),
		tx.done
	]);
}

export async function putWaveform(
	id: string,
	peaks: Float32Array,
	perSecond: number
): Promise<void> {
	await (await db()).put('waveforms', { id, peaks, perSecond });
}

export async function getWaveform(
	id: string
): Promise<{ peaks: Float32Array; perSecond: number } | undefined> {
	return (await db()).get('waveforms', id);
}

export async function putThumbnail(id: string, blob: Blob): Promise<void> {
	await (await db()).put('thumbnails', { id, blob });
}

export async function getThumbnail(id: string): Promise<Blob | undefined> {
	return (await (await db()).get('thumbnails', id))?.blob;
}

/**
 * Ask the browser not to evict our data under storage pressure (once), and record the answer.
 * Returns whether storage is persistent.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	try {
		let persisted = (await navigator.storage?.persisted?.()) ?? false;
		if (!persisted && !(await getSetting('persistAsked'))) {
			persisted = (await navigator.storage?.persist?.()) ?? false;
			await putSetting('persistAsked', true);
		}
		await putSetting('persisted', persisted);
		return persisted;
	} catch {
		// Not supported: data still saves, it just may be evicted under pressure.
		return false;
	}
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
	return (await (await db()).get('settings', key))?.value as T | undefined;
}

export async function putSetting(key: string, value: unknown): Promise<void> {
	await (await db()).put('settings', { key, value });
}

/** How much space the browser is using for Scenes, and how much it may use. */
export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean }> {
	const est = (await navigator.storage?.estimate?.()) ?? {};
	const persisted = (await navigator.storage?.persisted?.()) ?? false;
	return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
}

export async function saveProject(record: ProjectRecord): Promise<void> {
	await (await db()).put('projects', record);
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
	return (await db()).get('projects', id);
}

/** Every project, most recently edited first. */
export async function listProjects(): Promise<ProjectRecord[]> {
	const all = await (await db()).getAll('projects');
	return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A stored file with this content, if there is one. */
export async function findMediaByHash(hash: string): Promise<MediaInfo | undefined> {
	const record = await (await db()).getFromIndex('media', 'hash', hash);
	if (!record) return undefined;
	const { blob: _blob, ...info } = record;
	return info;
}

/** Fill in fingerprints for files stored before deduplication existed (in the background). */
export async function backfillMediaHashes(hash: (blob: Blob) => Promise<string>): Promise<void> {
	const d = await db();
	for (const id of await d.getAllKeys('media')) {
		const record = await d.get('media', id);
		if (!record || record.hash) continue;
		record.hash = await hash(record.blob);
		await d.put('media', record);
	}
}

export async function getFileLink(projectId: string): Promise<FileLink | undefined> {
	return (await db()).get('files', projectId);
}

export async function putFileLink(link: FileLink): Promise<void> {
	await (await db()).put('files', link);
}

/** A project's picture for the home screen, with the key of what it shows (see thumbnailKey). */
export async function projectThumbnail(
	projectId: string
): Promise<{ blob: Blob; key?: string } | undefined> {
	return (await db()).get('thumbnails', `project:${projectId}`);
}

export async function putProjectThumbnail(projectId: string, blob: Blob, key?: string): Promise<void> {
	await (await db()).put('thumbnails', { id: `project:${projectId}`, blob, key });
}

/**
 * Delete a project, its thumbnail and file link, and the media and fonts that only it used
 * (files another project uses too are kept).
 */
export async function deleteProject(id: string, orphans: { media: string[]; fonts: string[] }): Promise<void> {
	const d = await db();
	await d.delete('projects', id);
	await d.delete('thumbnails', `project:${id}`);
	await d.delete('files', id);
	for (const mediaId of orphans.media) await deleteMedia(mediaId);
	for (const fontId of orphans.fonts) await deleteFontFace(fontId);
}

/** Info for stored media, without touching the file contents. */
export async function getMediaInfos(ids: string[]): Promise<MediaInfo[]> {
	const d = await db();
	const tx = d.transaction('media');
	const records = await Promise.all(ids.map((id) => tx.store.get(id)));
	return records.filter((r): r is MediaRecord => !!r).map(({ blob: _blob, ...info }) => info);
}

/** Delete stored files that no saved project uses any more. Returns how many were removed. */
export async function deleteUnusedMedia(): Promise<number> {
	const d = await db();
	const used = new Set<string>();
	for (const project of await d.getAll('projects')) {
		for (const scene of project.scenes) used.add(scene.mediaId);
		for (const sound of project.sounds) used.add(sound.mediaId);
		for (const id of project.library ?? []) used.add(id);
		for (const o of project.overlays ?? []) used.add(o.mediaId);
	}
	const ids = await d.getAllKeys('media');
	const unused = ids.filter((id) => !used.has(id));
	for (const id of unused) await deleteMedia(id);
	return unused.length;
}

export async function putFontFace(record: FontFaceRecord): Promise<void> {
	await (await db()).put('fonts', record);
}

export async function getFontFace(id: string): Promise<FontFaceRecord | undefined> {
	return (await db()).get('fonts', id);
}

export async function listFontFaces(): Promise<Omit<FontFaceRecord, 'blob'>[]> {
	const all = await (await db()).getAll('fonts');
	return all.map(({ blob: _blob, ...rest }) => rest);
}

export async function deleteFontFace(id: string): Promise<void> {
	await (await db()).delete('fonts', id);
}
