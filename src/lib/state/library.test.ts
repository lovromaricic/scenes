import { describe, expect, it } from 'vitest';
import {
	findMediaByHash,
	getFontFace,
	getMedia,
	getProject,
	listProjects,
	projectThumbnail,
	putFontFace,
	putMedia,
	putProjectThumbnail,
	saveProject
} from '$lib/media/db';
import { fingerprint } from '$lib/media/fingerprint';
import type { Project } from '$lib/model/types';
import { emergencyCopy } from './autosave';
import { allProjects, duplicateProject, removeProject, renameProject } from './library';
import { newProject, sceneFromMedia } from './project';

const media = (id: string) => ({
	id,
	name: `${id}.mp4`,
	kind: 'video' as const,
	mime: 'video/mp4',
	size: 3,
	duration: 2,
	startTime: 0,
	width: 64,
	height: 36,
	hasAudio: false,
	createdAt: 1,
	blob: new Blob([id])
});

function projectUsing(mediaIds: string[], fontId?: string): Project {
	const p = newProject();
	p.scenes = mediaIds.map((id) => sceneFromMedia(media(id)));
	p.library = [...mediaIds];
	if (fontId)
		p.texts = [
			{
				id: 't',
				text: 'Hi',
				style: 'caption',
				start: 0,
				end: 1,
				position: 'bottom',
				font: { id: fontId, family: 'Up', source: 'upload', weight: 400, italic: false }
			} as unknown as Project['texts'][number]
		];
	return p;
}

describe('project library', () => {
	it('duplicates a project with a new id and "(copy)" name, sharing its media', async () => {
		await putMedia(media('dup-a'));
		const p = { ...projectUsing(['dup-a']), title: 'Trip', updatedAt: 10 };
		await saveProject(p);
		await putProjectThumbnail(p.id, new Blob(['jpg']));
		const copy = (await duplicateProject(p.id))!;
		expect(copy.id).not.toBe(p.id);
		expect(copy.title).toBe('Trip (copy)');
		expect(copy.scenes[0].mediaId).toBe('dup-a');
		expect(await projectThumbnail(copy.id)).toBeTruthy();
		expect((await listProjects())[0].id).toBe(copy.id);
	});

	it('renames a project', async () => {
		const p = newProject();
		await saveProject(p);
		await renameProject(p.id, '  Summer trip ');
		expect((await getProject(p.id))!.title).toBe('Summer trip');
		await renameProject(p.id, '   ');
		expect((await getProject(p.id))!.title).toBe('Untitled video');
	});

	it('deleting keeps files another project uses and removes the rest', async () => {
		await putMedia(media('del-shared'));
		await putMedia(media('del-own'));
		await putFontFace({ id: 'font-own', family: 'Up', source: 'upload', weight: 400, italic: false, blob: new Blob(['f']), createdAt: 1 });
		const a = projectUsing(['del-shared', 'del-own'], 'font-own');
		const b = projectUsing(['del-shared']);
		await saveProject(a);
		await saveProject(b);
		await removeProject(a.id);
		expect(await getProject(a.id)).toBeUndefined();
		expect(await getMedia('del-shared')).toBeTruthy();
		expect(await getMedia('del-own')).toBeUndefined();
		expect(await getFontFace('font-own')).toBeUndefined();
	});

	it('home picks up a newer emergency copy', async () => {
		const p = { ...newProject(), savedAt: 5 };
		await saveProject(p);
		emergencyCopy.write({ ...p, title: 'Closed too soon', savedAt: 9 });
		const all = await allProjects();
		expect(all.find((x) => x.id === p.id)!.title).toBe('Closed too soon');
		expect(emergencyCopy.read(p.id)).toBeNull();
	});

	it('finds stored media by content fingerprint', async () => {
		const blob = new Blob(['same bytes']);
		const hash = await fingerprint(blob);
		expect(await fingerprint(new Blob(['same bytes']))).toBe(hash);
		expect(await fingerprint(new Blob(['other bytes']))).not.toBe(hash);
		await putMedia({ ...media('hashed'), blob, hash });
		expect((await findMediaByHash(hash))?.id).toBe('hashed');
	});
});
