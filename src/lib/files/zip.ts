import {
	BlobReader,
	BlobWriter,
	TextReader,
	TextWriter,
	ZipReader,
	ZipWriter,
	configure,
	type Entry,
	type FileEntry
} from '@zip.js/zip.js';
import type { MediaInfo, ProjectView } from '$lib/media/db';
import type { Project } from '$lib/model/types';
import {
	APP_NAME,
	DAMAGED,
	FILE_FORMAT_VERSION,
	NOT_A_PROJECT,
	ProjectFileError,
	checkManifest,
	fontPath,
	mediaPath,
	mediaThumbnailPath,
	migrateProjectJson,
	type FontMeta,
	type Manifest,
	type ProjectJson
} from './format';

// Everything happens on the main thread's event loop in small async steps; media isn't
// compressed, so there's no heavy work to hand to workers.
configure({ useWebWorkers: false });

/** Everything that goes into a project file. */
export interface ProjectBundle {
	project: Project;
	view?: ProjectView;
	media: { info: MediaInfo; blob: Blob; thumbnail?: Blob }[];
	fonts: { meta: FontMeta; blob: Blob }[];
	thumbnail?: Blob | null;
}

/**
 * Write a project file to a stream, entry by entry (media is read in slices, never loaded whole).
 * `onProgress` gets 0–1 by bytes written.
 */
export async function writeProjectFile(
	bundle: ProjectBundle,
	writable: WritableStream<Uint8Array>,
	onProgress?: (fraction: number) => void,
	signal?: AbortSignal
): Promise<void> {
	const { project } = bundle;
	const total =
		bundle.media.reduce((n, m) => n + m.blob.size + (m.thumbnail?.size ?? 0), 0) +
		bundle.fonts.reduce((n, f) => n + f.blob.size, 0) +
		(bundle.thumbnail?.size ?? 0) +
		1;
	let done = 0;
	const report = () => onProgress?.(Math.min(1, done / total));

	const zip = new ZipWriter(writable, { bufferedWrite: false, signal });
	const addText = (name: string, text: string, level = 6) =>
		zip.add(name, new TextReader(text), { level });
	const addBlob = async (name: string, blob: Blob) => {
		let last = 0;
		await zip.add(name, new BlobReader(blob), {
			level: 0,
			onprogress: async (progress) => {
				done += progress - last;
				last = progress;
				report();
			}
		});
		done += blob.size - last;
		report();
	};

	const manifest: Manifest = {
		app: APP_NAME,
		formatVersion: FILE_FORMAT_VERSION,
		name: project.title,
		createdAt: project.createdAt,
		savedAt: Date.now()
	};
	const json: ProjectJson = {
		project,
		view: bundle.view,
		media: bundle.media.map(({ info, thumbnail }) => ({
			...info,
			path: mediaPath(info),
			thumbnailPath: thumbnail ? mediaThumbnailPath(info) : undefined
		})),
		fonts: bundle.fonts.map(({ meta, blob }) => ({ ...meta, path: fontPath(meta, blob) }))
	};
	// The manifest is small and left uncompressed, so any zip tool can show what the file is.
	await addText('manifest.json', JSON.stringify(manifest, null, 2), 0);
	await addText('project.json', JSON.stringify(json));
	if (bundle.thumbnail) await addBlob('thumbnail.jpg', bundle.thumbnail);
	for (const m of bundle.media) if (m.thumbnail) await addBlob(mediaThumbnailPath(m.info), m.thumbnail);
	for (const f of bundle.fonts) await addBlob(fontPath(f.meta, f.blob), f.blob);
	for (const m of bundle.media) await addBlob(mediaPath(m.info), m.blob);
	await zip.close();
	onProgress?.(1);
}

/** A project file, read and checked (media is still inside the file until it's stored). */
export interface OpenedProjectFile {
	manifest: Manifest;
	data: ProjectJson;
	/** The contents of an entry, as a Blob. Stored (uncompressed) entries are slices of the file. */
	read(path: string, type?: string): Promise<Blob>;
	has(path: string): boolean;
	close(): Promise<void>;
}

const isFile = (e: Entry): e is FileEntry => !e.directory;

/** Read a project file's manifest and project, checking it's a Scenes project and not damaged. */
export async function readProjectFile(file: Blob): Promise<OpenedProjectFile> {
	let reader: ZipReader<unknown>;
	let entries: FileEntry[];
	try {
		reader = new ZipReader(new BlobReader(file));
		entries = (await reader.getEntries()).filter(isFile);
	} catch {
		throw new ProjectFileError(await looksLikeZip(file) ? DAMAGED : NOT_A_PROJECT);
	}
	const byName = new Map(entries.map((e) => [e.filename, e]));

	const text = async (name: string, missing: string) => {
		const entry = byName.get(name);
		if (!entry) throw new ProjectFileError(missing);
		try {
			return JSON.parse(await entry.getData(new TextWriter(), { checkSignature: true })) as unknown;
		} catch {
			throw new ProjectFileError(DAMAGED);
		}
	};

	const manifest = checkManifest(await text('manifest.json', NOT_A_PROJECT));
	const data = migrateProjectJson(await text('project.json', DAMAGED), manifest.formatVersion);

	async function read(path: string, type = ''): Promise<Blob> {
		const entry = byName.get(path);
		if (!entry) throw new ProjectFileError(DAMAGED);
		if (entry.compressionMethod === 0 && !entry.encrypted) {
			// Stored as is: take it straight from the file, without copying it into memory.
			const header = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
			if (header.byteLength < 30 || header.getUint32(0, true) !== 0x04034b50) {
				throw new ProjectFileError(DAMAGED);
			}
			const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
			const end = start + entry.uncompressedSize;
			if (end > file.size) throw new ProjectFileError(DAMAGED);
			return file.slice(start, end, type);
		}
		try {
			return await entry.getData(new BlobWriter(type), { checkSignature: true });
		} catch {
			throw new ProjectFileError(DAMAGED);
		}
	}

	return {
		manifest,
		data,
		read,
		has: (path) => byName.has(path),
		close: () => reader.close()
	};
}

/** Whether a file starts like a zip archive (so a failure to read it means it's damaged). */
async function looksLikeZip(file: Blob): Promise<boolean> {
	const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	return head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
}
