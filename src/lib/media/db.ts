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

interface ScenesDB extends DBSchema {
	media: { key: string; value: MediaRecord };
	thumbnails: { key: string; value: { id: string; blob: Blob } };
	projects: { key: string; value: ProjectRecord; indexes: { updatedAt: number } };
	waveforms: { key: string; value: { id: string; peaks: Float32Array; perSecond: number } };
}

const DB_NAME = 'scenes';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<ScenesDB>> | null = null;

export function db(): Promise<IDBPDatabase<ScenesDB>> {
	dbPromise ??= openDB<ScenesDB>(DB_NAME, DB_VERSION, {
		upgrade(database, oldVersion) {
			if (oldVersion < 1) {
				database.createObjectStore('media', { keyPath: 'id' });
				database.createObjectStore('thumbnails', { keyPath: 'id' });
				const projects = database.createObjectStore('projects', { keyPath: 'id' });
				projects.createIndex('updatedAt', 'updatedAt');
			}
			if (oldVersion < 2) {
				database.createObjectStore('waveforms', { keyPath: 'id' });
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

/** Ask the browser not to evict our data under storage pressure. Best effort. */
export async function requestPersistentStorage(): Promise<void> {
	try {
		if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
			await navigator.storage.persist?.();
		}
	} catch {
		// Not supported or denied: data still saves, it just may be evicted under pressure.
	}
}

export async function saveProject(record: ProjectRecord): Promise<void> {
	await (await db()).put('projects', record);
}

/** The most recently edited project, if any. */
export async function loadLatestProject(): Promise<ProjectRecord | undefined> {
	const d = await db();
	const cursor = await d.transaction('projects').store.index('updatedAt').openCursor(null, 'prev');
	return cursor?.value;
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
	}
	const ids = await d.getAllKeys('media');
	const unused = ids.filter((id) => !used.has(id));
	for (const id of unused) await deleteMedia(id);
	return unused.length;
}
