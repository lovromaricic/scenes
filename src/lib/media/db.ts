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

interface ScenesDB extends DBSchema {
	media: { key: string; value: MediaRecord };
	thumbnails: { key: string; value: { id: string; blob: Blob } };
	projects: { key: string; value: Project; indexes: { updatedAt: number } };
}

const DB_NAME = 'scenes';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ScenesDB>> | null = null;

export function db(): Promise<IDBPDatabase<ScenesDB>> {
	dbPromise ??= openDB<ScenesDB>(DB_NAME, DB_VERSION, {
		upgrade(database) {
			database.createObjectStore('media', { keyPath: 'id' });
			database.createObjectStore('thumbnails', { keyPath: 'id' });
			const projects = database.createObjectStore('projects', { keyPath: 'id' });
			projects.createIndex('updatedAt', 'updatedAt');
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
	const tx = d.transaction(['media', 'thumbnails'], 'readwrite');
	await Promise.all([
		tx.objectStore('media').delete(id),
		tx.objectStore('thumbnails').delete(id),
		tx.done
	]);
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
