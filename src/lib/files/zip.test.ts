// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BlobReader, TextReader, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { newProject } from '$lib/state/project';
import type { MediaInfo } from '$lib/media/db';
import { DAMAGED, NOT_A_PROJECT, TOO_NEW, projectFileName } from './format';
import { readProjectFile, writeProjectFile, type ProjectBundle } from './zip';

const info = (id: string, name: string, size: number): MediaInfo => ({
	id,
	name,
	kind: 'video',
	mime: 'video/mp4',
	size,
	duration: 2,
	startTime: 0,
	width: 64,
	height: 36,
	hasAudio: true,
	createdAt: 1
});

async function toBlob(bundle: ProjectBundle, progress?: number[]): Promise<Blob> {
	const chunks: Uint8Array[] = [];
	const writable = new WritableStream<Uint8Array>({ write: (c) => void chunks.push(c) });
	await writeProjectFile(bundle, writable, (p) => progress?.push(p));
	return new Blob(chunks as BlobPart[]);
}

function bundle(): ProjectBundle {
	const project = { ...newProject(), title: 'Summer trip' };
	const video = new Uint8Array(200_000).map((_, i) => (i * 31) % 251);
	return {
		project,
		view: { time: 1.5, selectedId: null },
		media: [
			{
				info: info('m1', 'beach.mp4', video.length),
				blob: new Blob([video], { type: 'video/mp4' }),
				thumbnail: new Blob(['thumb'], { type: 'image/jpeg' })
			}
		],
		fonts: [
			{
				meta: { id: 'f1', family: 'Pacifico', source: 'upload', weight: 400, italic: false, createdAt: 1 },
				blob: new Blob(['font-bytes'], { type: 'font/ttf' })
			}
		],
		thumbnail: new Blob(['project-thumb'], { type: 'image/jpeg' })
	};
}

describe('project files', () => {
	it('round-trips a project, its media, fonts and pictures', async () => {
		const input = bundle();
		const progress: number[] = [];
		const file = await toBlob(input, progress);
		expect(progress.at(-1)).toBe(1);
		expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);

		const opened = await readProjectFile(file);
		expect(opened.manifest).toMatchObject({ app: 'Scenes', formatVersion: 1, name: 'Summer trip' });
		expect(opened.data.project).toEqual(input.project);
		expect(opened.data.view).toEqual({ time: 1.5, selectedId: null });
		expect(opened.data.media[0]).toMatchObject({ id: 'm1', path: 'media/m1.mp4', thumbnailPath: 'thumbnails/m1.jpg' });
		expect(opened.data.fonts[0]).toMatchObject({ id: 'f1', family: 'Pacifico', path: 'fonts/f1.ttf' });

		const media = await opened.read('media/m1.mp4', 'video/mp4');
		expect(media.type).toBe('video/mp4');
		expect(new Uint8Array(await media.arrayBuffer())).toEqual(
			new Uint8Array(await input.media[0].blob.arrayBuffer())
		);
		expect(await (await opened.read('fonts/f1.ttf')).text()).toBe('font-bytes');
		expect(await (await opened.read('thumbnail.jpg')).text()).toBe('project-thumb');
		expect(await (await opened.read('thumbnails/m1.jpg')).text()).toBe('thumb');
	});

	it('stores media uncompressed, with the manifest first', async () => {
		const file = await toBlob(bundle());
		const entries = await new ZipReader(new BlobReader(file)).getEntries();
		expect(entries[0].filename).toBe('manifest.json');
		const media = entries.find((e) => e.filename === 'media/m1.mp4')!;
		expect(media.compressionMethod).toBe(0);
		expect(entries.map((e) => e.filename)).toEqual([
			'manifest.json',
			'project.json',
			'thumbnail.jpg',
			'thumbnails/m1.jpg',
			'fonts/f1.ttf',
			'media/m1.mp4'
		]);
	});

	it('says clearly when a file is not a project, damaged, or from a newer version', async () => {
		await expect(readProjectFile(new Blob(['just some notes']))).rejects.toThrow(NOT_A_PROJECT);

		const good = await toBlob(bundle());
		await expect(readProjectFile(good.slice(0, good.size - 5000))).rejects.toThrow(DAMAGED);

		// A corrupted project.json fails its checksum.
		const entries = await new ZipReader(new BlobReader(good)).getEntries();
		const json = entries.find((e) => e.filename === 'project.json')!;
		const bytes = new Uint8Array(await good.arrayBuffer());
		bytes[json.offset + 60 + (json.compressedSize >> 1)] ^= 0xff;
		await expect(readProjectFile(new Blob([bytes]))).rejects.toThrow(DAMAGED);

		// Other zips, and projects from a newer Scenes.
		const zipWith = async (files: Record<string, string>) => {
			const chunks: Uint8Array[] = [];
			const zip = new ZipWriter(new WritableStream<Uint8Array>({ write: (c) => void chunks.push(c) }));
			for (const [name, text] of Object.entries(files)) await zip.add(name, new TextReader(text));
			await zip.close();
			return new Blob(chunks as BlobPart[]);
		};
		await expect(readProjectFile(await zipWith({ 'readme.txt': 'hi' }))).rejects.toThrow(NOT_A_PROJECT);
		await expect(
			readProjectFile(await zipWith({ 'manifest.json': JSON.stringify({ app: 'Other', formatVersion: 1 }) }))
		).rejects.toThrow(NOT_A_PROJECT);
		await expect(
			readProjectFile(await zipWith({ 'manifest.json': JSON.stringify({ app: 'Scenes', formatVersion: 9 }) }))
		).rejects.toThrow(TOO_NEW);
		await expect(
			readProjectFile(
				await zipWith({
					'manifest.json': JSON.stringify({ app: 'Scenes', formatVersion: 1 }),
					'project.json': '{"project": {}}'
				})
			)
		).rejects.toThrow(DAMAGED);
	});

	it('makes safe file names', () => {
		expect(projectFileName('Summer trip')).toBe('Summer trip.scenes');
		expect(projectFileName('a/b: c?')).toBe('a b c.scenes');
		expect(projectFileName('  ')).toBe('Untitled video.scenes');
	});
});
