import { describe, expect, it } from 'vitest';
import { copyName, formatEdited, migrateProject, orphansAfterDelete, projectFontIds, projectMediaIds } from './projects';
import type { Project, Scene } from './types';

const scene = (id: string, mediaId: string, kind: Scene['kind'] = 'video'): Scene => ({
	id,
	mediaId,
	kind,
	name: id,
	sourceStart: 0,
	sourceEnd: 3,
	speed: 1,
	volume: 1,
	mood: null,
	transition: { kind: 'cut', duration: 0 }
});

const project = (id: string, extra: Partial<Project>): Project =>
	migrateProject({ id, title: id, scenes: [], texts: [], sounds: [], library: [], createdAt: 1, updatedAt: 1, ...extra });

describe('what a project uses', () => {
	it('lists media from scenes, sounds and "Your media", but not cards', () => {
		const p = project('a', {
			scenes: [scene('s1', 'm1'), scene('s2', ''), scene('s3', 'm1')],
			sounds: [{ id: 'x', mediaId: 'm2', name: 'm', start: 0, sourceStart: 0, duration: 1, volume: 1, kind: 'music', fadeIn: 1.5, fadeOut: 3, trackId: 'a1' }],
			library: ['m1', 'm3']
		});
		p.scenes[1].kind = 'card';
		expect(projectMediaIds(p)).toEqual(['m1', 'm2', 'm3']);
	});
	it('lists stored fonts, not built-in ones', () => {
		const p = project('a', {
			texts: [
				{ id: 't1', trackId: 'o1', text: 'a', start: 0, duration: 1, x: 0, y: 0, style: 'clean', animation: 'none', font: { family: 'Mine', source: 'upload', id: 'f1', weight: 400, italic: false } },
				{ id: 't2', trackId: 'o1', text: 'b', start: 0, duration: 1, x: 0, y: 0, style: 'clean', animation: 'none', font: { family: 'Lora', source: 'builtin', id: 'lora', weight: 400, italic: false } }
			]
		});
		expect(projectFontIds(p)).toEqual(['f1']);
	});
});

describe('orphansAfterDelete', () => {
	it('keeps files another project still uses', () => {
		const a = project('a', { scenes: [scene('s', 'shared'), scene('t', 'onlyA')] });
		const b = project('b', { library: ['shared'] });
		expect(orphansAfterDelete([a, b], 'a')).toEqual({ media: ['onlyA'], fonts: [] });
		expect(orphansAfterDelete([a, b], 'missing')).toEqual({ media: [], fonts: [] });
	});
});

describe('migrateProject', () => {
	it('brings an old single-shape project up to date without losing anything', () => {
		const old = { id: 'p', title: 'My video', aspect: '9:16', mood: 'golden', scenes: [scene('s', 'm')], texts: [], sounds: [], createdAt: 5, updatedAt: 9 };
		const p = migrateProject(old as unknown as Partial<Project>);
		expect(p).toMatchObject({ id: 'p', title: 'My video', mood: 'golden', library: ['m'], updatedAt: 9 });
		expect(p.format).toMatchObject({ preset: 'vertical', width: 1080, height: 1920 });
		expect('aspect' in p).toBe(false);
	});
	it('changes nothing on current data', () => {
		const p = project('p', { scenes: [scene('s', 'm')], library: ['m'] });
		expect(migrateProject(p)).toEqual(p);
	});
});

describe('names and dates', () => {
	it('formats edit times', () => {
		const now = new Date(2026, 8, 30, 12, 0).getTime();
		expect(formatEdited(now - 20_000, now)).toBe('Edited just now');
		expect(formatEdited(now - 5 * 60_000, now)).toBe('Edited 5 minutes ago');
		expect(formatEdited(now - 2 * 3600_000, now)).toBe('Edited 2 hours ago');
		expect(formatEdited(now - 30 * 3600_000, now)).toBe('Edited yesterday');
		expect(formatEdited(now - 3 * 86400_000, now)).toBe('Edited 3 days ago');
		expect(formatEdited(new Date(2026, 2, 3).getTime(), now)).toBe('Edited 3 Mar');
	});
	it('names copies', () => {
		expect(copyName('Trip')).toBe('Trip (copy)');
		expect(copyName('Trip (copy)')).toBe('Trip (copy)');
	});
	it('shows words in an unknown style in the plain style', () => {
		const p = migrateProject({ texts: [{ id: 't', style: 'sparkly' }] } as never);
		expect(p.texts[0].style).toBe('clean');
	});
});
