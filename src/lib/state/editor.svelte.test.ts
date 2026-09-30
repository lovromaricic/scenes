import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '$lib/media/db';
import { totalDuration } from '$lib/model/timeline';
import type { Project } from '$lib/model/types';
import { EditorStore } from './editor.svelte';
import { newProject, sceneFromMedia } from './project';

function media(id: string, duration: number): MediaInfo {
	return {
		id,
		name: `${id}.mp4`,
		kind: 'video',
		mime: 'video/mp4',
		size: 1,
		duration,
		startTime: 0,
		width: 640,
		height: 360,
		hasAudio: true,
		createdAt: 0
	};
}

function setup() {
	const store = new EditorStore();
	const infos = [media('red', 4), media('green', 3), media('blue', 3)];
	for (const info of infos) store.media[info.id] = info;
	const project: Project = { ...newProject(), scenes: infos.map(sceneFromMedia) };
	store.project = project;
	store.syncPlayer();
	return store;
}

const snap = (s: EditorStore) => JSON.stringify({ ...s.project, updatedAt: 0 });
const names = (s: EditorStore) => s.project.scenes.map((x) => x.name);

describe('EditorStore editing with undo/redo', () => {
	it('steps back and forth through every kind of edit', () => {
		const store = setup();
		const states = [snap(store)];
		const ids = store.project.scenes.map((s) => s.id);

		store.moveScene(0, 2);
		expect(names(store)).toEqual(['Green', 'Blue', 'Red']);
		states.push(snap(store));

		store.setSceneLength(ids[0], 2);
		expect(totalDuration(store.project.scenes)).toBe(8);
		states.push(snap(store));

		store.setSceneSpeed(ids[1], 2);
		expect(totalDuration(store.project.scenes)).toBe(6.5);
		states.push(snap(store));

		store.trimScene(ids[2], 'start', 1);
		expect(store.project.scenes[1].sourceStart).toBe(1);
		states.push(snap(store));

		store.seek(1);
		store.splitAtPlayhead();
		expect(store.project.scenes).toHaveLength(4);
		states.push(snap(store));

		store.deleteScene(store.project.scenes[0].id);
		expect(store.project.scenes).toHaveLength(3);
		states.push(snap(store));

		store.setSceneMood(ids[2], 'golden');
		store.setAspect('9:16');
		store.setTitle('Holiday');
		states.push(snap(store));

		// Undo all the way back, checking each intermediate state (the last three edits are 3 steps).
		store.undo();
		store.undo();
		store.undo();
		for (let i = states.length - 2; i >= 0; i--) {
			expect(snap(store)).toBe(states[i]);
			store.undo();
		}
		expect(store.canUndo).toBe(false);
		expect(snap(store)).toBe(states[0]);

		// And redo all the way forward again.
		for (let i = 1; i < states.length - 1; i++) {
			store.redo();
			expect(snap(store)).toBe(states[i]);
		}
		store.redo();
		store.redo();
		store.redo();
		expect(snap(store)).toBe(states.at(-1));
		expect(store.canRedo).toBe(false);
	});

	it('merges holding the Length stepper into one undo step', () => {
		const store = setup();
		const id = store.project.scenes[0].id;
		store.setSceneLength(id, 3.5);
		store.setSceneLength(id, 3);
		store.setSceneLength(id, 2.5);
		store.undo();
		expect(totalDuration(store.project.scenes)).toBe(10);
	});

	it('selects the next scene after a delete and clears a selection that undo removes', () => {
		const store = setup();
		const [a, b] = store.project.scenes.map((s) => s.id);
		store.selectedId = a;
		store.deleteSelected();
		expect(store.selectedId).toBe(b);
		store.undo();
		store.seek(1);
		store.splitAtPlayhead();
		const second = store.selectedId;
		expect(second).not.toBe(a);
		store.undo();
		expect(store.selectedId).toBeNull();
	});

	it('refuses to split at a cut', () => {
		const store = setup();
		store.seek(4);
		store.splitAtPlayhead();
		expect(store.project.scenes).toHaveLength(3);
		expect(store.canUndo).toBe(false);
	});
});
