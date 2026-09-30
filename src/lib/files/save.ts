import { getFileLink, getProject, putFileLink } from '$lib/media/db';
import { FILE_TYPES, projectFileName } from './format';
import { collectBundle } from './store';
import { writeProjectFile } from './zip';

/**
 * Saving a project to a `.scenes` file. In Chrome and Edge the file is chosen with the system's
 * save dialog, and its handle is remembered so the next save goes to the same file without
 * asking. Other browsers download the file instead.
 */

interface FilePickerWindow {
	showSaveFilePicker?: (options: {
		suggestedName?: string;
		types?: typeof FILE_TYPES;
		id?: string;
	}) => Promise<FileSystemFileHandle>;
	showOpenFilePicker?: (options: {
		types?: typeof FILE_TYPES;
		multiple?: boolean;
		id?: string;
	}) => Promise<FileSystemFileHandle[]>;
}

interface PermissionHandle {
	queryPermission?: (d: { mode: 'readwrite' | 'read' }) => Promise<PermissionState>;
	requestPermission?: (d: { mode: 'readwrite' | 'read' }) => Promise<PermissionState>;
}

const pickers = () => window as unknown as FilePickerWindow;

export const canPickFiles = () => typeof pickers().showSaveFilePicker === 'function';

/** Whether we may write to a remembered file (asking again if the browser wants to). */
async function mayWrite(handle: FileSystemFileHandle): Promise<boolean> {
	const h = handle as unknown as PermissionHandle;
	try {
		if (!h.queryPermission) return true;
		let state = await h.queryPermission({ mode: 'readwrite' });
		if (state === 'prompt' && h.requestPermission) state = await h.requestPermission({ mode: 'readwrite' });
		return state === 'granted';
	} catch {
		return false;
	}
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export interface SavedFile {
	name: string;
	/** The project's `updatedAt` that the file now holds. */
	savedUpdatedAt: number;
	downloaded: boolean;
}

/**
 * Save a stored project to a file. With `saveAs`, always ask where; otherwise save to the file it
 * was last saved to or opened from when possible. Resolves null if the user cancelled.
 */
export async function saveProjectToFile(
	projectId: string,
	options: { saveAs?: boolean; onProgress?: (fraction: number) => void } = {}
): Promise<SavedFile | null> {
	// Choose the file first, while the click or key press still counts as the user's action.
	const link = await getFileLink(projectId);
	let handle: FileSystemFileHandle | null = null;
	if (!options.saveAs && link?.handle && (await mayWrite(link.handle))) handle = link.handle;
	if (!handle && canPickFiles()) {
		const project = await getProject(projectId);
		try {
			handle = await pickers().showSaveFilePicker!({
				suggestedName: link?.name ?? projectFileName(project?.title ?? ''),
				types: FILE_TYPES,
				id: 'scenes-projects'
			});
		} catch (error) {
			if (isAbort(error)) return null;
			throw error;
		}
	}

	const bundle = await collectBundle(projectId);
	const savedUpdatedAt = bundle.project.updatedAt;
	if (handle) {
		const writable = await handle.createWritable();
		try {
			await writeProjectFile(bundle, writable, options.onProgress);
		} catch (error) {
			await writable.abort().catch(() => {});
			throw error;
		}
		await putFileLink({ projectId, name: handle.name, handle, savedUpdatedAt });
		return { name: handle.name, savedUpdatedAt, downloaded: false };
	}

	// No file picker (Firefox, Safari): write to private storage, then download it.
	const name = projectFileName(bundle.project.title);
	const file = await writeToTemporaryFile(name, (writable) =>
		writeProjectFile(bundle, writable, options.onProgress)
	);
	download(file, name);
	await putFileLink({ projectId, name, savedUpdatedAt });
	return { name, savedUpdatedAt, downloaded: true };
}

const TEMP_PREFIX = 'scenes-project-';

/** Write to a file in the browser's private storage (on disk), or to memory without it. */
async function writeToTemporaryFile(
	name: string,
	write: (writable: WritableStream<Uint8Array>) => Promise<void>
): Promise<Blob> {
	let root: FileSystemDirectoryHandle | null = null;
	try {
		root = await navigator.storage.getDirectory();
	} catch {
		root = null;
	}
	if (root) {
		for await (const entry of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
			if (entry.startsWith(TEMP_PREFIX)) await root.removeEntry(entry).catch(() => {});
		}
		const handle = await root.getFileHandle(`${TEMP_PREFIX}${Date.now()}`, { create: true });
		const writable = await handle.createWritable();
		await write(writable);
		return new File([await handle.getFile()], name);
	}
	const chunks: Uint8Array[] = [];
	await write(new WritableStream({ write: (chunk) => void chunks.push(chunk) }));
	return new File(chunks as BlobPart[], name);
}

function download(file: Blob, name: string) {
	const url = URL.createObjectURL(file);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Ask the user for a project file. Chrome and Edge also give a handle, so saving goes back to the
 * same file. Resolves null if cancelled.
 */
export async function pickProjectFile(): Promise<{ file: File; handle?: FileSystemFileHandle } | null> {
	const open = pickers().showOpenFilePicker;
	if (open) {
		try {
			const [handle] = await open({ types: FILE_TYPES, multiple: false, id: 'scenes-projects' });
			return { file: await handle.getFile(), handle };
		} catch (error) {
			if (isAbort(error)) return null;
			throw error;
		}
	}
	const { pickFiles } = await import('$lib/media/picker');
	const [file] = await pickFiles('.scenes', false);
	return file ? { file } : null;
}
