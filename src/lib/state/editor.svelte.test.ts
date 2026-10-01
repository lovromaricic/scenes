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
		store.setFormat({ preset: 'vertical', width: 1080, height: 1920, fps: 30 });
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

describe('EditorStore animatable values', () => {
	it('changes the item itself without keyframes, and the keyframe at the playhead with them', () => {
		const store = setup();
		const id = store.addCardOverlay(1)!;
		store.seek(2);
		store.setItemValues(id, { x: 0.25, rotation: 30 });
		let o = store.project.overlays[0];
		expect(o.box.x + o.box.w / 2).toBeCloseTo(0.25);
		expect(o.rotation).toBe(30);
		expect(o.keyframes).toBeUndefined();

		// With keyframes: a new keyframe at the playhead, the item's own values untouched.
		store.edit('Keyframes', (p) => ({
			...p,
			overlays: p.overlays.map((x) => ({
				...x,
				keyframes: [{ id: 'a', time: 0, values: store.itemValues(id, 1)!, easing: { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 } }]
			}))
		}));
		store.seek(3);
		store.setItemValues(id, { x: 0.75 });
		o = store.project.overlays[0];
		expect(o.box.x + o.box.w / 2).toBeCloseTo(0.25);
		expect(o.keyframes!.map((k) => k.time)).toEqual([0, 2]);
		expect(store.itemValues(id, 3)!.x).toBeCloseTo(0.75);
		expect(store.itemValues(id, 2)!.x).toBeCloseTo(0.5);
		// Updating it again at the same time changes that keyframe.
		store.setItemValues(id, { rotation: 90 });
		expect(store.project.overlays[0].keyframes).toHaveLength(2);
		expect(store.itemValues(id, 3)!.rotation).toBe(90);
	});

	it('trimming from the left keeps the motion where it was; moving takes it along', () => {
		const store = setup();
		const id = store.addCardOverlay(1)!;
		store.edit('Keyframes', (p) => ({
			...p,
			overlays: p.overlays.map((x) => ({
				...x,
				keyframes: [
					{ id: 'a', time: 1, values: { ...store.itemValues(id, 1)!, x: 0.1 }, easing: { kind: 'hold' } },
					{ id: 'b', time: 3, values: { ...store.itemValues(id, 1)!, x: 0.9 }, easing: { kind: 'hold' } }
				]
			}))
		}));
		// Keyframes at 2 s and 4 s on the timeline.
		store.setOverlayTiming(id, 1.5, 4.5); // trim 0.5 s off the left (end stays at 6)
		expect(store.project.overlays[0].keyframes!.map((k) => k.time)).toEqual([0.5, 2.5]);
		expect(store.itemValues(id, 4)!.x).toBeCloseTo(0.9);
		store.setOverlayTiming(id, 2.5, 4.5); // moved 1 s later
		expect(store.project.overlays[0].keyframes!.map((k) => k.time)).toEqual([0.5, 2.5]);
		expect(store.itemValues(id, 5)!.x).toBeCloseTo(0.9);
	});
});
