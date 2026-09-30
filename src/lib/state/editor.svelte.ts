import {
	deleteUnusedMedia,
	getMediaInfos,
	getThumbnail,
	loadLatestProject,
	saveProject,
	putMedia,
	putThumbnail,
	requestPersistentStorage,
	type MediaInfo,
	type ProjectRecord
} from '$lib/media/db';
import { registerBlob } from '$lib/media/handles';
import { MediaImportError, probeFile } from '$lib/media/probe';
import {
	MAX_PHOTO,
	moveScene,
	removeScene,
	setLength,
	setSpeed,
	splitAt,
	trimEdge,
	type SourceBounds
} from '$lib/model/edits';
import { History } from '$lib/model/history';
import { placeScenes, totalDuration } from '$lib/model/timeline';
import type { AspectRatio, MoodId, Project, Scene, Speed } from '$lib/model/types';
import { Player } from '$lib/playback/player';
import { Autosaver, emergencyCopy, type SaveStatus } from './autosave';
import { newId, newProject, sceneFromMedia } from './project';
import { toasts } from './toasts.svelte';

interface EditOptions {
	/** Merge with the previous edit if it had the same key (e.g. holding the Length stepper). */
	key?: string;
	/** Select this id after the edit. */
	select?: string | null;
}

/**
 * The editor's reactive state and every editing action.
 *
 * All changes to the project go through `edit()`, which records an undo step and schedules an
 * autosave. The project itself is plain data; the actual edit logic lives in `$lib/model`.
 */
export class EditorStore {
	project = $state<Project>(newProject());
	selectedId = $state<string | null>(null);
	time = $state(0);
	playing = $state(false);
	/** Files still being read after a drop or pick. */
	importing = $state(0);
	/** Thumbnail object URLs by media id. */
	thumbnails = $state<Record<string, string>>({});
	/** What we know about each imported file, by media id. */
	media = $state<Record<string, MediaInfo>>({});
	/** True once the last project has been restored (or there was none). */
	ready = $state(false);
	canUndo = $state(false);
	canRedo = $state(false);
	saveStatus = $state<SaveStatus>('idle');

	readonly player = new Player();
	private readonly history = new History<Project>();
	private readonly autosaver = new Autosaver((s) => (this.saveStatus = s));
	/** Snapshot taken when a drag gesture starts, recorded as one undo step when it ends. */
	private gestureBefore: Project | null = null;

	duration = $derived(totalDuration(this.project.scenes));
	placed = $derived(placeScenes(this.project.scenes));
	selectedScene = $derived(this.placed.find((p) => p.scene.id === this.selectedId) ?? null);

	constructor() {
		this.player.on({
			time: (t) => (this.time = t),
			playing: (p) => (this.playing = p)
		});
	}

	// ─── Loading and saving ──────────────────────────────────────────────────────────────────

	/** Restore the most recent project from this device. */
	async load(): Promise<void> {
		try {
			let record = await loadLatestProject();
			// A copy written while the page was closing may be newer than the last database save.
			const copy = emergencyCopy.read();
			if (copy && (!record || (copy.savedAt ?? 0) > (record.savedAt ?? 0))) {
				record = copy;
				await saveProject(copy);
				emergencyCopy.clearIfSaved(copy.savedAt ?? 0);
			}
			if (record) {
				const { view, savedAt: _savedAt, ...project } = record;
				const ids = [...project.scenes, ...project.sounds]
					.map((s) => s.mediaId)
					.filter((id, i, all) => all.indexOf(id) === i);
				const infos = await getMediaInfos(ids);
				for (const info of infos) this.media[info.id] = info;
				// Scenes whose file has gone missing (e.g. storage was cleared) can't play; drop them.
				const missing = project.scenes.filter((s) => !this.media[s.mediaId]);
				if (missing.length) {
					project.scenes = project.scenes.filter((s) => this.media[s.mediaId]);
					toasts.show(
						`${missing.length === 1 ? 'One clip was' : `${missing.length} clips were`} missing from this device and has been left out.`,
						'error'
					);
				}
				this.project = project;
				this.selectedId = view?.selectedId ?? null;
				this.syncPlayer();
				this.player.seek(view?.time ?? 0);
				void this.loadThumbnails(ids);
			}
			void deleteUnusedMedia().catch(() => {});
		} catch (error) {
			console.error('Could not restore the last project', error);
			toasts.show('Your last project couldn’t be opened, so a new one was started.', 'error');
		} finally {
			this.ready = true;
		}
	}

	private record(): ProjectRecord {
		return {
			...($state.snapshot(this.project) as Project),
			view: { time: this.player.time, selectedId: this.selectedId },
			savedAt: Date.now()
		};
	}

	/** Save soon. Called after every change, and when the playhead or selection moves. */
	scheduleSave(): void {
		if (this.ready) this.autosaver.schedule(this.record());
	}

	/** Save right away (page hidden or closing). */
	flushSave(): Promise<void> {
		if (!this.ready) return Promise.resolve();
		const record = this.record();
		emergencyCopy.write(record);
		this.autosaver.schedule(record);
		return this.autosaver.flush();
	}

	private async loadThumbnails(ids: string[]): Promise<void> {
		for (const id of ids) {
			if (this.thumbnails[id]) continue;
			const blob = await getThumbnail(id);
			if (blob) this.thumbnails[id] = URL.createObjectURL(blob);
		}
	}

	// ─── History ────────────────────────────────────────────────────────────────────────────

	private snapshot(): Project {
		return $state.snapshot(this.project) as Project;
	}

	/** Apply one undoable change. `change` gets a copy of the project and returns the new one. */
	edit(label: string, change: (project: Project) => Project, options: EditOptions = {}): void {
		const before = this.snapshot();
		const after = { ...change(structuredClone(before)), updatedAt: Date.now() };
		this.history.record(label, before, after, options.key);
		this.project = after;
		if (options.select !== undefined) this.selectedId = options.select;
		this.afterChange();
	}

	/** Start a drag: changes until `endGesture` become one undo step. */
	beginGesture(): void {
		this.gestureBefore = this.snapshot();
	}

	endGesture(label: string, change: (project: Project) => Project): void {
		const before = this.gestureBefore ?? this.snapshot();
		this.gestureBefore = null;
		const after = { ...change(structuredClone(this.snapshot())), updatedAt: Date.now() };
		if (
			JSON.stringify(after.scenes) === JSON.stringify(before.scenes) &&
			after.title === before.title
		) {
			return;
		}
		this.history.record(label, before, after);
		this.project = after;
		this.afterChange();
	}

	undo(): void {
		const step = this.history.undo();
		if (step) this.restore(step.state, `Undid ${step.label.toLowerCase()}`);
	}

	redo(): void {
		const step = this.history.redo();
		if (step) this.restore(step.state, `Redid ${step.label.toLowerCase()}`);
	}

	private restore(state: Project, message: string): void {
		this.project = structuredClone(state);
		if (this.selectedId && !this.findItem(this.selectedId)) this.selectedId = null;
		toasts.show(message);
		this.afterChange();
	}

	private findItem(id: string): boolean {
		return (
			this.project.scenes.some((s) => s.id === id) ||
			this.project.texts.some((t) => t.id === id) ||
			this.project.sounds.some((s) => s.id === id)
		);
	}

	private afterChange(): void {
		this.canUndo = this.history.canUndo;
		this.canRedo = this.history.canRedo;
		this.syncPlayer();
		this.scheduleSave();
	}

	// ─── Playback ───────────────────────────────────────────────────────────────────────────

	/** Push the current project to the player. */
	syncPlayer(): void {
		const media = this.media;
		this.player.setProject(this.snapshot(), (id) => !!media[id]?.hasAudio);
	}

	togglePlay(): void {
		this.player.unlockAudio();
		this.player.toggle();
		if (!this.player.playing) this.scheduleSave();
	}

	seek(t: number): void {
		this.player.seek(t);
	}

	/** Nudge the playhead by `delta` seconds. */
	nudge(delta: number): void {
		this.player.seek(this.player.time + delta);
	}

	select(id: string | null): void {
		this.selectedId = id;
		// Selecting a scene shows it: jump there unless the playhead is already inside it.
		const placed = this.placed.find((p) => p.scene.id === id);
		if (placed && !(this.time >= placed.start && this.time < placed.end)) this.seek(placed.start);
		this.scheduleSave();
	}

	// ─── Scene edits ────────────────────────────────────────────────────────────────────────

	bounds(scene: Scene): SourceBounds {
		if (scene.kind === 'photo') return { start: 0, end: MAX_PHOTO };
		const info = this.media[scene.mediaId];
		return info
			? { start: info.startTime, end: info.duration }
			: { start: scene.sourceStart, end: scene.sourceEnd };
	}

	private updateScene(label: string, id: string, fn: (s: Scene) => Scene, key?: string): void {
		const scene = this.project.scenes.find((s) => s.id === id);
		if (!scene) return;
		this.edit(label, (p) => ({ ...p, scenes: p.scenes.map((s) => (s.id === id ? fn(s) : s)) }), {
			key
		});
	}

	setSceneLength(id: string, length: number): void {
		const scene = this.project.scenes.find((s) => s.id === id);
		if (!scene) return;
		const bounds = this.bounds(scene);
		this.updateScene('Length', id, (s) => setLength(s, length, bounds), `length:${id}`);
	}

	setSceneSpeed(id: string, speed: Speed): void {
		this.updateScene('Speed', id, (s) => setSpeed(s, speed));
	}

	setSceneMood(id: string, mood: MoodId | null): void {
		this.updateScene('Mood', id, (s) => ({ ...s, mood }));
	}

	setSceneVolume(id: string, volume: number): void {
		this.updateScene('Clip sound', id, (s) => ({ ...s, volume }), `volume:${id}`);
	}

	/** Finish dragging a card edge. `delta` is in timeline seconds. */
	trimScene(id: string, edge: 'start' | 'end', delta: number): void {
		const scene = this.project.scenes.find((s) => s.id === id);
		if (!scene || Math.abs(delta) < 1e-3) return;
		const bounds = this.bounds(scene);
		this.edit('Trim', (p) => ({
			...p,
			scenes: p.scenes.map((s) => (s.id === id ? trimEdge(s, edge, delta, bounds) : s))
		}));
		// Keep the playhead on the edited edge so the result is visible.
		const placed = this.placed.find((p) => p.scene.id === id);
		if (placed)
			this.seek(edge === 'start' ? placed.start : Math.max(placed.start, placed.end - 1 / 30));
	}

	moveScene(from: number, to: number): void {
		if (from === to) return;
		const id = this.project.scenes[from]?.id;
		this.edit('Move scene', (p) => ({ ...p, scenes: moveScene(p.scenes, from, to) }), {
			select: id ?? null
		});
	}

	splitAtPlayhead(): void {
		const result = splitAt(this.snapshot().scenes, this.player.time, newId);
		if (!result) {
			toasts.show(
				this.project.scenes.length
					? 'Move the playhead into a scene to split it there.'
					: 'Add a clip first, then split it.'
			);
			return;
		}
		this.edit('Split', (p) => ({ ...p, scenes: result.scenes }), { select: result.secondId });
	}

	deleteScene(id: string): void {
		const index = this.project.scenes.findIndex((s) => s.id === id);
		if (index === -1) return;
		const after = removeScene(this.project.scenes, id);
		const nextSelected = after[Math.min(index, after.length - 1)]?.id ?? null;
		this.edit('Delete scene', (p) => ({ ...p, scenes: removeScene(p.scenes, id) }), {
			select: nextSelected
		});
	}

	/** Delete whatever is selected. */
	deleteSelected(): void {
		const id = this.selectedId;
		if (id && this.project.scenes.some((s) => s.id === id)) this.deleteScene(id);
	}

	setAspect(aspect: AspectRatio): void {
		if (aspect !== this.project.aspect) this.edit('Video shape', (p) => ({ ...p, aspect }));
	}

	setTitle(title: string): void {
		const clean = title.trim().slice(0, 80) || 'My video';
		if (clean !== this.project.title) this.edit('Rename', (p) => ({ ...p, title: clean }));
	}

	// ─── Import ─────────────────────────────────────────────────────────────────────────────

	/** Add photos and videos as scenes at the end, in the order given. */
	async importFiles(files: File[]): Promise<void> {
		if (files.length === 0) return;
		void requestPersistentStorage();
		this.importing += files.length;
		let added = 0;
		// Scenes appear one by one as files are read, but the whole import is one undo step.
		const before = this.snapshot();
		for (const file of files) {
			try {
				const { info: probed, thumbnail } = await probeFile(file);
				if (probed.kind === 'audio') {
					toasts.show(`“${file.name}” is a sound file. Add it from Sound instead.`, 'error');
					continue;
				}
				const info: MediaInfo = { ...probed, id: newId(), createdAt: Date.now() };
				await putMedia({ ...info, blob: file });
				registerBlob(info, file);
				if (thumbnail) {
					await putThumbnail(info.id, thumbnail);
					this.thumbnails[info.id] = URL.createObjectURL(thumbnail);
				}
				this.media[info.id] = info;
				const scene = sceneFromMedia(info);
				this.project.scenes.push(scene);
				this.selectedId = scene.id;
				this.syncPlayer();
				added++;
			} catch (error) {
				const message =
					error instanceof MediaImportError
						? error.message
						: `“${file.name}” couldn’t be added. ${
								error instanceof DOMException && error.name === 'QuotaExceededError'
									? 'Your browser is out of storage space.'
									: 'Please try another file.'
							}`;
				if (!(error instanceof MediaImportError)) console.error(error);
				toasts.show(message, 'error');
			} finally {
				this.importing--;
			}
		}
		if (added > 0) {
			const after = { ...this.snapshot(), updatedAt: Date.now() };
			this.history.record(added > 1 ? 'Add scenes' : 'Add scene', before, after);
			this.project.updatedAt = after.updatedAt;
			this.afterChange();
		}
		if (added > 1) toasts.show(`Added ${added} scenes`);
	}
}
