import { describe, expect, it } from 'vitest';
import { migrateProject } from './projects';
import {
	addTrack,
	allItems,
	deleteTrack,
	duplicateTrack,
	moveItems,
	moveTrack,
	renameTrack,
	settle
} from './items';
import { freeTrack, mainTrack, newTrack, nextTrackName, orderTracks, overlayTracksBottomUp, type Track } from './tracks';
import type { Project } from './types';

let n = 0;
const id = () => `id${++n}`;

const scene = (sid: string, length: number) => ({
	id: sid,
	mediaId: sid,
	kind: 'video' as const,
	name: sid,
	sourceStart: 0,
	sourceEnd: length,
	speed: 1 as const,
	volume: 1,
	mood: null,
	transition: { kind: 'cut' as const, duration: 0 }
});

describe('tracks', () => {
	it('keep overlay tracks above the main track and audio below', () => {
		const t = orderTracks([newTrack('a', 'audio', 'Audio 1'), mainTrack(), newTrack('o', 'overlay', 'Overlay 1')]);
		expect(t.map((x) => x.kind)).toEqual(['overlay', 'main', 'audio']);
		expect(overlayTracksBottomUp([newTrack('hi', 'overlay', 'x'), newTrack('lo', 'overlay', 'y'), mainTrack()]).map((x) => x.id)).toEqual(['lo', 'hi']);
	});
	it('name new tracks with the lowest free number', () => {
		expect(nextTrackName([newTrack('a', 'overlay', 'Overlay 1'), newTrack('b', 'overlay', 'Overlay 3')], 'overlay')).toBe('Overlay 2');
		expect(nextTrackName([], 'audio')).toBe('Audio 1');
	});
});

describe('migrating a project from before tracks', () => {
	const old = {
		id: 'p',
		title: 'Trip',
		format: { preset: 'landscape', width: 1280, height: 720, fps: 30 },
		formatSet: true,
		mood: 'natural',
		scenes: [scene('s1', 4), scene('s2', 6)],
		library: [],
		overlays: [
			// Linked to scene 2 (starting at 4 s), 1 s in; on the second Layers row.
			{ id: 'o1', kind: 'photo', mediaId: 'm', name: 'o1', sceneId: 's2', offset: 1, duration: 2, sourceStart: 0, row: 1, box: { x: 0, y: 0, w: 0.4, h: 0.4 }, style: {}, enter: 'none', exit: 'none', sound: { on: false, volume: 1 } },
			{ id: 'o2', kind: 'photo', mediaId: 'm', name: 'o2', sceneId: 's1', offset: 0.5, duration: 2, sourceStart: 0, row: 0, box: { x: 0, y: 0, w: 0.4, h: 0.4 }, style: {}, enter: 'none', exit: 'none', sound: { on: false, volume: 1 } }
		],
		texts: [{ id: 't1', text: 'Hi', start: 1, duration: 2, x: 0.5, y: 0.5, style: 'clean', animation: 'none' }],
		sounds: [
			{ id: 'm1', mediaId: 'a', name: 'song', start: 0, sourceStart: 0, duration: 10, volume: 1, kind: 'music', fadeIn: 1.5, fadeOut: 3, row: 0 },
			{ id: 'v1', mediaId: 'b', name: 'voice', start: 2, sourceStart: 0, duration: 2, volume: 1, kind: 'voice', fadeIn: 0, fadeOut: 0, row: 1 }
		],
		createdAt: 1,
		updatedAt: 1
	};
	const p = migrateProject(old as never);

	it('turns Layers rows, the Words lane and Sound rows into tracks, in the same stacking order', () => {
		expect(p.tracks.map((t) => [t.kind, t.name])).toEqual([
			['overlay', 'Text'],
			['overlay', 'Overlay 2'],
			['overlay', 'Overlay 1'],
			['main', 'Scenes'],
			['audio', 'Audio 1'],
			['audio', 'Audio 2']
		]);
		const track = (name: string) => p.tracks.find((t) => t.name === name)!.id;
		expect(p.overlays.find((o) => o.id === 'o1')!.trackId).toBe(track('Overlay 2'));
		expect(p.overlays.find((o) => o.id === 'o2')!.trackId).toBe(track('Overlay 1'));
		expect(p.texts[0].trackId).toBe(track('Text'));
		expect(p.sounds.map((s) => s.trackId)).toEqual([track('Audio 1'), track('Audio 2')]);
	});
	it('keeps overlays where they were on the timeline, and drops the old fields', () => {
		expect(p.overlays.find((o) => o.id === 'o1')!.start).toBe(5);
		expect(p.overlays.find((o) => o.id === 'o2')!.start).toBe(0.5);
		for (const o of p.overlays) {
			expect('sceneId' in o || 'offset' in o || 'row' in o).toBe(false);
		}
		expect(p.sounds.some((s) => 'row' in s)).toBe(false);
	});
	it('is safe to run again', () => {
		expect(migrateProject(p)).toEqual(p);
	});
	it('always has an overlay and an audio track', () => {
		const empty = migrateProject({ ...old, overlays: [], texts: [], sounds: [] } as never);
		expect(empty.tracks.map((t) => t.kind)).toEqual(['overlay', 'main', 'audio']);
	});
});

describe('items on tracks', () => {
	const base = (): Pick<Project, 'tracks' | 'overlays' | 'texts' | 'sounds'> => ({
		tracks: [newTrack('A', 'overlay', 'Overlay 2'), newTrack('B', 'overlay', 'Overlay 1'), mainTrack(), newTrack('S', 'audio', 'Audio 1')],
		overlays: [
			{ id: 'x', trackId: 'B', start: 0, duration: 4 } as never,
			{ id: 'y', trackId: 'B', start: 5, duration: 2 } as never
		],
		texts: [{ id: 't', trackId: 'A', start: 1, duration: 2 } as never],
		sounds: [{ id: 's', trackId: 'S', start: 0, duration: 10 } as never]
	});

	it('moving onto an item on the same track puts it on a new track just above', () => {
		const p = moveItems(base(), ['y'], -3, id);
		const y = p.overlays.find((o) => o.id === 'y')!;
		expect(y.start).toBe(2);
		const i = p.tracks.findIndex((t) => t.id === y.trackId);
		expect(p.tracks[i + 1].id).toBe('B');
		expect(p.tracks[i].kind).toBe('overlay');
	});
	it('moves between tracks of the right kind only', () => {
		const p = moveItems(base(), ['y'], 0, id, 'A');
		expect(p.overlays.find((o) => o.id === 'y')!.trackId).toBe('A');
		const q = moveItems(base(), ['y'], 0, id, 'S');
		expect(q.overlays.find((o) => o.id === 'y')!.trackId).toBe('B');
	});
	it('moves a selection together, never before 0', () => {
		const p = moveItems(base(), ['x', 't'], -2, id);
		expect(p.overlays.find((o) => o.id === 'x')!.start).toBe(0);
		expect(p.texts[0].start).toBe(1);
	});
	it('settle leaves items that fit alone', () => {
		expect(settle(base(), 'y', id)).toEqual(base());
	});
	it('finds a free track, top first', () => {
		const b = base();
		expect(freeTrack(b.tracks as Track[], allItems(b), 'overlay', { start: 4, duration: 1 })?.id).toBe('A');
		expect(freeTrack(b.tracks as Track[], allItems(b), 'overlay', { start: 1, duration: 1 })).toBeNull();
	});
	it('adds, renames, duplicates, moves and deletes tracks', () => {
		let p = addTrack(base(), 'audio', 99, 'S2');
		expect(p.tracks.at(-1)!.name).toBe('Audio 2');
		p = renameTrack(p, 'A', '  Logo  ');
		expect(p.tracks[0].name).toBe('Logo');
		expect(renameTrack(p, 'main', 'Nope').tracks.find((t) => t.kind === 'main')!.name).toBe('Scenes');
		p = duplicateTrack(p, 'B', id);
		const copy = p.tracks[1];
		expect(copy.name).toBe('Overlay 1 copy');
		expect(p.overlays.filter((o) => o.trackId === copy.id)).toHaveLength(2);
		// An overlay track can't go below the main track.
		p = moveTrack(p, 'A', 10);
		expect(p.tracks.findIndex((t) => t.id === 'A')).toBeLessThan(p.tracks.findIndex((t) => t.kind === 'main'));
		p = deleteTrack(p, 'B');
		expect(p.tracks.some((t) => t.id === 'B')).toBe(false);
		expect(p.overlays.some((o) => o.id === 'x')).toBe(false);
		expect(deleteTrack(p, 'main')).toBe(p);
	});
});
