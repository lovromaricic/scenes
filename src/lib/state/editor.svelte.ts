import {
	findMediaByHash,
	getProject,
	getMediaInfos,
	putProjectThumbnail,
	getThumbnail,
	getWaveform,
	putWaveform,
	saveProject,
	putMedia,
	putThumbnail,
	requestPersistentStorage,
	backfillMediaHashes,
	getFileLink,
	type FileLink,
	type MediaInfo,
	type ProjectRecord
} from '$lib/media/db';
import { getHandle, registerBlob } from '$lib/media/handles';
import { saveProjectToFile } from '$lib/files/save';
import {
	MAX_FADE,
	MIN_SOUND,
	MUSIC_FADE_IN,
	MUSIC_FADE_OUT,
	assignSoundRow,
	compactSoundRows,
	freeRow,
	soundEnd,
	splitSound,
	trimSound
} from '$lib/model/sound';
import {
	MAX_VIDEO_OVERLAYS,
	MIN_OVERLAY_SECONDS,
	linkAt,
	OVERLAY_SECONDS,
	DEFAULT_OVERLAY_STYLE,
	defaultBox,
	rowCount,
	tooManyVideos,
	assignRow,
	compactRows,
	maxOverlayDuration,
	moveOverlayTo,
	overlaysOf,
	placeOverlays,
	relinkByTime,
	sendBack,
	fitShape,
	type Overlay,
	type OverlayBox,
	type OverlayStyle
} from '$lib/model/overlay';
import { MicrophoneError, VoiceRecorder } from '$lib/media/recorder';
import { computePeaks, PEAKS_PER_SECOND } from '$lib/media/waveform';
import { mixdown } from '$lib/audio/mixdown';
import { projectAudioClips } from '$lib/audio/clips';
import { MediaImportError, probeFile } from '$lib/media/probe';
import {
	clampTextTiming,
	MAX_PHOTO,
	moveScene,
	resizeText,
	removeScene,
	setLength,
	setSpeed,
	splitAt,
	trimEdge,
	type SourceBounds
} from '$lib/model/edits';
import { History } from '$lib/model/history';
import { placeScenes, sceneDuration, totalDuration } from '$lib/model/timeline';
import { TEXT_ENTER } from '$lib/model/textAnimation';
import { TRANSITION_SECONDS } from '$lib/model/composition';
import { formatFromClip, type ProjectFormat } from '$lib/model/format';
import { migrateProject, projectMediaIds } from '$lib/model/projects';
import { fingerprint } from '$lib/media/fingerprint';
import { makeProjectThumbnail, thumbnailKey } from './projectThumbnail';
import { DEFAULT_FRAME, type SceneFrame } from '$lib/model/framing';
import type { CardContent } from '$lib/model/card';
import type { TextColors, TextFont } from '$lib/model/textStyle';
import { FontLibrary } from './fonts.svelte';
import {
	clampCrop,
	cropRatioValue,
	cropToRatio,
	fullCrop,
	isFull,
	type Crop,
	type CropRatio,
	type Size
} from '$lib/model/crop';
import type {
	MoodId,
	Project,
	Scene,
	SoundItem,
	Speed,
	TextAnimation,
	TextItem,
	TextStyleId,
	TransitionKind
} from '$lib/model/types';
import { Player } from '$lib/playback/player';
import { Autosaver, emergencyCopy, type SaveStatus } from './autosave';
import { exportVideo, type ExportProgress, type ExportResult } from '$lib/export/exporter';
import { presetById, type PresetId } from '$lib/export/presets';
import { newCardScene, newId, newProject, sceneFromMedia } from './project';
import { nameFromFile } from '$lib/media/kinds';
import { defaultCard } from '$lib/model/card';
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
let hashesBackfilled = false;

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
	/** Crop mode: which scene, and the crop being edited (applied on Done). */
	cropping = $state<{ sceneId: string; draft: Crop; ratio: CropRatio } | null>(null);
	/** The text currently being typed into on the preview. */
	editingTextId = $state<string | null>(null);
	/** Waveform peaks by media id (not deeply reactive: arrays are replaced, never mutated). */
	waveforms = $state.raw<Record<string, { peaks: Float32Array; perSecond: number }>>({});
	/** Voiceover recording in progress: counting down, then recording from `start`. */
	recording = $state<{
		phase: 'countdown' | 'recording';
		count: number;
		start: number;
		elapsed: number;
	} | null>(null);

	readonly player = new Player();
	/** Fonts: built in, on this computer, uploaded, recent. */
	readonly fonts = new FontLibrary();
	private readonly history = new History<Project>();
	private readonly autosaver = new Autosaver((s) => (this.saveStatus = s));
	/** Snapshot taken when a drag gesture starts, recorded as one undo step when it ends. */
	private gestureBefore: Project | null = null;
	/** Resolves once the saved project has been restored (or there was none). */
	private loaded: Promise<void> | null = null;

	duration = $derived(totalDuration(this.project.scenes));
	placed = $derived(placeScenes(this.project.scenes));
	selectedScene = $derived(this.placed.find((p) => p.scene.id === this.selectedId) ?? null);
	selectedText = $derived(this.project.texts.find((t) => t.id === this.selectedId) ?? null);
	selectedSound = $derived(this.project.sounds.find((s) => s.id === this.selectedId) ?? null);
	/** Overlays with their times, lowest row first. */
	placedOverlays = $derived(placeOverlays(this.project.overlays, this.placed));
	selectedOverlay = $derived(this.placedOverlays.find((p) => p.overlay.id === this.selectedId) ?? null);
	/** A scene being removed that has overlays: the question "remove them too?" is showing. */
	removingScene = $state<{ id: string; count: number } | null>(null);
	/** The scene under the playhead (the last one at the very end). */
	sceneAtPlayhead = $derived(
		this.placed.find((p) => this.time >= p.start && this.time < p.end) ?? this.placed.at(-1) ?? null
	);
	/**
	 * The scene whose settings the right column shows: the selected one, or with nothing selected,
	 * the one under the playhead.
	 */
	inspectedScene = $derived(this.selectedId ? this.selectedScene : this.sceneAtPlayhead);

	/**
	 * @param projectId the project to open
	 * @param fresh a new video: start empty if nothing is stored under this id yet
	 */
	constructor(
		readonly projectId: string = newId(),
		private readonly fresh = false
	) {
		this.player.on({
			time: (t) => (this.time = t),
			playing: (p) => (this.playing = p)
		});
	}

	// ─── Loading and saving ──────────────────────────────────────────────────────────────────

	/**
	 * Open this store's project: a new empty one, or the saved one with this id (brought up to
	 * date by `migrateProject`). Resolves `false` if a saved project couldn't be found.
	 */
	load(): Promise<void> {
		this.loaded ??= this.restoreSaved();
		return this.loaded;
	}

	/** Whether the project is in storage yet (new, untouched projects aren't saved). */
	private stored = false;
	/** Set if the project to open doesn't exist (e.g. deleted in another tab). */
	notFound = $state(false);
	/** Set when this project is being replaced from a file: nothing more is saved from here. */
	private frozen = false;

	/** The file this project was last saved to or opened from, if any. */
	fileLink = $state<FileLink | null>(null);
	/** While saving to a file: 0–1. */
	fileSaving = $state<number | null>(null);
	private savingFile = false;

	/** Save status for the top bar, including the project file's. */
	get fileStatus(): 'saved' | 'changed' | null {
		if (!this.fileLink) return null;
		return this.project.updatedAt === this.fileLink.savedUpdatedAt ? 'saved' : 'changed';
	}

	private async restoreSaved(): Promise<void> {
		void this.fonts.init();
		void requestPersistentStorage();
		if (!hashesBackfilled) {
			// Files stored before deduplication get their fingerprint, in the background.
			hashesBackfilled = true;
			void backfillMediaHashes(fingerprint).catch((e) => console.warn('Fingerprinting failed', e));
		}
		try {
			let record = await getProject(this.projectId);
			// A copy written while the page was closing may be newer than the last database save.
			const copy = emergencyCopy.read(this.projectId);
			if (copy && (!record || (copy.savedAt ?? 0) > (record.savedAt ?? 0))) {
				record = copy;
				await saveProject(copy);
				emergencyCopy.clearIfSaved(this.projectId, copy.savedAt ?? 0);
			}
			if (!record) {
				// A new video starts empty (it's stored once something is added).
				if (this.fresh) this.project = { ...newProject(), id: this.projectId };
				else this.notFound = true;
				return;
			}
			this.stored = true;
			this.fileLink = (await getFileLink(this.projectId)) ?? null;
			// Never replace work the user has already started in this session.
			if (this.history.canUndo) return;
			const { view, savedAt: _savedAt, ...saved } = record;
			const project = migrateProject(saved);
			const ids = projectMediaIds(project);
			const infos = await getMediaInfos(ids);
			for (const info of infos) this.media[info.id] = info;
			// Scenes whose file has gone missing (e.g. storage was cleared) can't play; drop them.
			// Cards have no file, so they always stay.
			const hasFile = (s: Scene) => s.kind === 'card' || !!this.media[s.mediaId];
			const missing = project.scenes.filter((s) => !hasFile(s));
			if (missing.length) {
				project.scenes = project.scenes.filter(hasFile);
				toasts.show(
					`${missing.length === 1 ? 'One clip was' : `${missing.length} clips were`} missing from this device and has been left out.`,
					'error'
				);
			}
			project.library = project.library.filter((id) => this.media[id]);
			this.project = project;
			this.selectedId = view?.selectedId ?? null;
			this.syncPlayer();
			this.player.seek(view?.time ?? 0);
			void this.loadThumbnails(ids);
			void this.loadWaveforms(project.sounds.map((s) => s.mediaId));
		} catch (error) {
			console.error('Could not open the project', error);
			toasts.show('This project couldn’t be opened.', 'error');
			this.notFound = true;
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

	/**
	 * Save soon. Called after every change, and when the playhead or selection moves. A new
	 * project is only saved once something has actually been changed in it.
	 */
	scheduleSave(): void {
		if (!this.ready || this.notFound || this.frozen || (!this.stored && !this.history.canUndo)) return;
		this.stored = true;
		this.autosaver.schedule(this.record());
		this.updateThumbnail();
	}

	/** Save right away (page hidden or closing). */
	flushSave(): Promise<void> {
		if (!this.ready || this.notFound || this.frozen || !this.stored) return Promise.resolve();
		const record = this.record();
		emergencyCopy.write(record);
		this.autosaver.schedule(record);
		return this.autosaver.flush();
	}

	private thumbKey = '';
	private thumbTimer: ReturnType<typeof setTimeout> | undefined;

	/** Keep the home screen's picture of this project up to date (only when its first scene changes). */
	private updateThumbnail(): void {
		clearTimeout(this.thumbTimer);
		this.thumbTimer = setTimeout(() => void this.writeThumbnail(), 800);
	}

	private async writeThumbnail(): Promise<void> {
		this.thumbTimer = undefined;
		const project = this.snapshot();
		const key = thumbnailKey(project);
		if (key === this.thumbKey) return;
		this.thumbKey = key;
		const blob = await makeProjectThumbnail(project, this.media).catch((error) => {
			console.warn('Couldn’t make the project’s picture', error);
			this.thumbKey = '';
			return null;
		});
		if (blob) await putProjectThumbnail(project.id, blob, key);
	}

	/** Stop saving: this project is about to be replaced by the one in a file. */
	freeze(): void {
		this.frozen = true;
		clearTimeout(this.thumbTimer);
	}

	/**
	 * Save the project to a `.scenes` file: the same file as last time when possible, or (with
	 * `saveAs`, or the first time) a file the user picks. Editing carries on while it saves.
	 */
	async saveToFile(saveAs = false): Promise<void> {
		if (!this.ready || this.notFound || this.savingFile) return;
		this.savingFile = true;
		// A new video that's still empty is stored first, so there's something to save.
		this.stored = true;
		await this.flushSave();
		try {
			const saved = await saveProjectToFile(this.projectId, {
				saveAs,
				// Starts once the file is chosen (not while the save dialog is open).
				onProgress: (fraction) => (this.fileSaving = fraction)
			});
			if (!saved) return;
			this.fileLink = { projectId: this.projectId, name: saved.name, savedUpdatedAt: saved.savedUpdatedAt };
			if (saved.downloaded) toasts.show(`“${saved.name}” is in your downloads.`);
		} catch (error) {
			console.error('Could not save the project file', error);
			toasts.show('The project couldn’t be saved to a file. Please try again.', 'error');
		} finally {
			this.fileSaving = null;
			this.savingFile = false;
		}
	}

	/** Leaving this project (for the home screen or another one): store the latest changes now. */
	close(): Promise<void> {
		clearTimeout(this.thumbTimer);
		return this.flushSave();
	}

	private async loadThumbnails(ids: string[]): Promise<void> {
		for (const id of ids) {
			if (this.thumbnails[id]) continue;
			const blob = await getThumbnail(id);
			if (blob) this.thumbnails[id] = URL.createObjectURL(blob);
		}
	}

	private async loadWaveforms(ids: string[]): Promise<void> {
		for (const id of ids) {
			if (this.waveforms[id]) continue;
			let wave = await getWaveform(id);
			if (!wave) {
				// Not stored yet (or storage was cleared): compute it again from the file.
				try {
					const handle = await getHandle(id);
					if (!handle.audio) continue;
					const peaks = await computePeaks(
						handle.audio,
						handle.info.startTime,
						handle.info.duration
					);
					wave = { peaks, perSecond: PEAKS_PER_SECOND };
					await putWaveform(id, peaks, PEAKS_PER_SECOND);
				} catch {
					continue;
				}
			}
			this.waveforms = { ...this.waveforms, [id]: wave };
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

	/** During a gesture: change the project live (no undo step yet). */
	live(change: (project: Project) => void): void {
		change(this.project);
		this.syncPlayer();
	}

	endGesture(label: string, change: (project: Project) => Project = (p) => p): void {
		const before = this.gestureBefore ?? this.snapshot();
		this.gestureBefore = null;
		const after = change(structuredClone(this.snapshot()));
		const unchanged =
			JSON.stringify({ ...after, updatedAt: 0 }) === JSON.stringify({ ...before, updatedAt: 0 });
		if (unchanged) return;
		after.updatedAt = Date.now();
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
			this.project.sounds.some((s) => s.id === id) ||
			this.project.overlays.some((o) => o.id === id)
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
		this.player.setProject(this.snapshot(), {
			hasAudio: (id) => !!media[id]?.hasAudio,
			bounds: (scene) => this.bounds(scene),
			sourceSize: (id) => (media[id] ? { width: media[id].width, height: media[id].height } : null)
		});
	}

	togglePlay(): void {
		// Playback pauses while cropping (scrubbing still works).
		if (this.cropping) return;
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

	/** Deselect everything (the right column then shows the scene under the playhead). */
	deselect(): void {
		this.select(null);
	}

	select(id: string | null): void {
		if (id !== this.editingTextId) this.stopEditingText();
		this.selectedId = id;
		// Selecting something shows it: jump there unless the playhead is already inside it.
		const placed = this.placed.find((p) => p.scene.id === id);
		if (placed && !(this.time >= placed.start && this.time < placed.end)) this.seek(placed.start);
		const layer = this.placedOverlays.find((p) => p.overlay.id === id);
		if (layer && !(this.time >= layer.start && this.time < layer.end)) this.seek(layer.start);
		const voice = this.project.sounds.find((s) => s.id === id && s.kind === 'voice');
		if (voice && !(this.time >= voice.start && this.time < voice.start + voice.duration)) {
			this.seek(voice.start);
		}
		const text = this.project.texts.find((t) => t.id === id);
		if (text && !(this.time >= text.start && this.time < text.start + text.duration)) {
			// Land just after the entrance animation so the words are fully visible.
			this.seek(text.start + Math.min(TEXT_ENTER, text.duration / 2));
		}
		this.scheduleSave();
	}

	// ─── Scene edits ────────────────────────────────────────────────────────────────────────

	bounds(scene: Scene): SourceBounds {
		if (scene.kind !== 'video') return { start: 0, end: MAX_PHOTO };
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

	// ─── Crop ───────────────────────────────────────────────────────────────────────────────

	/** A scene's source picture size, in pixels. */
	sourceSize(scene: Pick<Scene, 'mediaId'>): Size | null {
		const info = this.media[scene.mediaId];
		return info ? { width: info.width, height: info.height } : null;
	}

	/**
	 * Start cropping a scene (default: the selected one, or the one under the playhead). Playback
	 * pauses, the preview shows the whole source clip, and the playhead moves into the scene.
	 */
	enterCrop(sceneId?: string): void {
		const id =
			sceneId ??
			this.selectedOverlay?.overlay.id ??
			this.selectedScene?.scene.id ??
			this.placed.find((p) => this.time >= p.start && this.time < p.end)?.scene.id;
		// A layer: its own picture is cropped the same way.
		const layer = this.placedOverlays.find((p) => p.overlay.id === id);
		if (layer) {
			const o = layer.overlay;
			const size = this.sourceSize(o);
			if (o.kind === 'card' || !size) return;
			this.stopEditingText();
			this.player.pause();
			this.selectedId = o.id;
			if (!(this.time >= layer.start && this.time < layer.end)) this.seek(layer.start);
			this.cropping = { sceneId: o.id, draft: o.crop ? { ...o.crop } : fullCrop(size), ratio: 'free' };
			this.player.setCropView(o.id);
			return;
		}
		const placed = this.placed.find((p) => p.scene.id === id);
		const size = placed && this.sourceSize(placed.scene);
		// Cards have nothing to crop.
		if (!placed || !size || placed.scene.kind === 'card') return;
		this.stopEditingText();
		this.player.pause();
		this.selectedId = placed.scene.id;
		if (!(this.time >= placed.start && this.time < placed.end)) this.seek(placed.start);
		this.cropping = {
			sceneId: placed.scene.id,
			draft: placed.scene.crop ? { ...placed.scene.crop } : fullCrop(size),
			ratio: 'free'
		};
		this.player.setCropView(placed.scene.id);
	}

	/** The source size of what's being cropped (a scene or a layer). */
	croppingSource = $derived.by(() => {
		const id = this.cropping?.sceneId;
		if (!id) return null;
		const item = this.project.scenes.find((s) => s.id === id) ?? this.project.overlays.find((o) => o.id === id);
		return item ? this.sourceSize(item) : null;
	});

	/** Change the crop being edited (not an undo step until Done). */
	setCropDraft(crop: Crop): void {
		if (!this.cropping) return;
		const size = this.croppingSource;
		if (!size) return;
		this.cropping = { ...this.cropping, draft: clampCrop(crop, size) };
	}

	/** Lock the crop box to a shape; picking one resizes the box to the largest of that shape. */
	setCropRatio(ratio: CropRatio): void {
		const c = this.cropping;
		if (!c) return;
		const size = this.croppingSource;
		if (!size) return;
		const value = cropRatioValue(ratio, size, this.project.format);
		this.cropping = { ...c, ratio, draft: value ? cropToRatio(c.draft, value, size) : c.draft };
	}

	/** Leave crop mode without changing anything. */
	cancelCrop(): void {
		this.cropping = null;
		this.player.setCropView(null);
	}

	/** Apply the crop being edited: one undo step. */
	applyCrop(): void {
		const c = this.cropping;
		if (!c) return;
		const layer = this.project.overlays.find((o) => o.id === c.sceneId);
		if (layer) {
			const size = this.croppingSource;
			this.cancelCrop();
			if (!size) return;
			const crop = isFull(c.draft, size) ? undefined : { ...c.draft };
			if (JSON.stringify(crop) === JSON.stringify(layer.crop)) return;
			// The box keeps its centre (and width, if it fits) and takes the cropped picture's shape.
			const picture = crop ? { width: crop.w, height: crop.h } : size;
			const box = fitShape(layer.box, picture, this.project.format);
			this.updateOverlay(crop ? 'Crop' : 'Remove crop', layer.id, (o) => ({ ...o, crop, box }));
			return;
		}
		const scene = this.project.scenes.find((s) => s.id === c.sceneId);
		const size = scene && this.sourceSize(scene);
		this.cancelCrop();
		if (!scene || !size) return;
		const crop = isFull(c.draft, size) ? undefined : { ...c.draft };
		if (JSON.stringify(crop) === JSON.stringify(scene.crop)) return;
		this.updateScene(crop ? 'Crop' : 'Remove crop', scene.id, (s) => ({ ...s, crop }));
	}

	/** Give every scene made from the same file this scene's crop. */
	applyCropToClip(sceneId: string): void {
		const scene = this.project.scenes.find((s) => s.id === sceneId);
		if (!scene) return;
		const crop = scene.crop ? { ...scene.crop } : undefined;
		this.edit('Crop for every scene from this clip', (p) => ({
			...p,
			scenes: p.scenes.map((s) => (s.mediaId === scene.mediaId ? { ...s, crop } : s))
		}));
	}

	/** How a scene's picture fits the video's shape. `key` merges quick repeats (sliders). */
	setSceneFrame(id: string, frame: SceneFrame, key?: string): void {
		this.updateScene('Framing', id, (s) => ({ ...s, frame: { ...frame } }), key);
	}

	/** Give every scene the same framing as this one. */
	applyFrameToAll(id: string): void {
		const frame = this.project.scenes.find((s) => s.id === id)?.frame ?? DEFAULT_FRAME;
		this.edit('Framing for every scene', (p) => ({
			...p,
			scenes: p.scenes.map((s) => ({ ...s, frame: { ...frame } }))
		}));
	}

	/** A scene's own look, or `null` to follow the whole video's look. */
	setSceneMood(id: string, mood: MoodId | null): void {
		this.updateScene('Look', id, (s) => ({ ...s, mood }));
	}

	/** The transition from a scene into the next one. */
	setTransition(id: string, kind: TransitionKind): void {
		this.updateScene('Transition', id, (s) => ({
			...s,
			transition: { kind, duration: TRANSITION_SECONDS[kind] }
		}));
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
		const before = this.placed;
		this.edit(
			'Split',
			(p) => ({
				...p,
				scenes: result.scenes,
				// Overlays stay where they are in time, linked to whichever half they start over.
				overlays: relinkByTime(p.overlays, before, placeScenes(result.scenes))
			}),
			{ select: result.secondId }
		);
	}

	// ─── Cards ──────────────────────────────────────────────────────────────────────────────

	/** Add a card after the selected scene (or at the end), or at `index`, and select it. */
	addCard(index?: number): void {
		const selected = this.project.scenes.findIndex((s) => s.id === this.selectedId);
		const at = index ?? (selected >= 0 ? selected + 1 : this.project.scenes.length);
		const card = newCardScene();
		this.edit(
			'Add card',
			(p) => {
				const scenes = p.scenes.slice();
				scenes.splice(Math.max(0, Math.min(at, scenes.length)), 0, card);
				return { ...p, scenes };
			},
			{ select: card.id }
		);
		const placed = this.placed.find((p) => p.scene.id === card.id);
		if (placed) this.seek(placed.start + Math.min(0.5, placed.duration / 2));
	}

	/** Change what a card shows. `key` merges quick repeats (typing, sliders). */
	setCard(id: string, card: CardContent, key?: string): void {
		// $state.snapshot, not structuredClone: the card may contain reactive proxies.
		const copy = $state.snapshot(card) as CardContent;
		this.updateScene('Card', id, (s) => ({ ...s, card: copy }), key);
	}

	/** A copy of a scene right after it. */
	duplicateScene(id: string): void {
		const index = this.project.scenes.findIndex((s) => s.id === id);
		if (index === -1) return;
		const copy = {
			...structuredClone($state.snapshot(this.project.scenes[index]) as Scene),
			id: newId()
		};
		this.edit(
			'Duplicate',
			(p) => {
				const scenes = p.scenes.slice();
				scenes.splice(index + 1, 0, copy);
				return { ...p, scenes };
			},
			{ select: copy.id }
		);
	}

	/** Add something from "Your media" as a new scene, at `index` (default: the end). */
	addSceneFromMedia(mediaId: string, index = this.project.scenes.length): void {
		const info = this.media[mediaId];
		if (!info || info.kind === 'audio') return;
		const scene = sceneFromMedia(info);
		this.edit(
			'Add scene',
			(p) => {
				const scenes = p.scenes.slice();
				scenes.splice(Math.max(0, Math.min(index, scenes.length)), 0, scene);
				return { ...p, scenes };
			},
			{ select: scene.id }
		);
		const placed = this.placed.find((p) => p.scene.id === scene.id);
		if (placed) this.seek(placed.start);
	}

	/**
	 * Remove a scene. If overlays are linked to it, asks first (`removingScene`) whether to remove
	 * them too or keep them where they are; answer with `overlays`.
	 */
	deleteScene(id: string, overlays?: 'remove' | 'keep'): void {
		const index = this.project.scenes.findIndex((s) => s.id === id);
		if (index === -1) return;
		const linked = overlaysOf(this.project.overlays, id);
		if (linked.length && !overlays) {
			this.removingScene = { id, count: linked.length };
			return;
		}
		this.removingScene = null;
		const after = removeScene(this.project.scenes, id);
		const nextSelected = after[Math.min(index, after.length - 1)]?.id ?? null;
		const before = this.placed;
		const ids = new Set(linked.map((o) => o.id));
		this.edit(
			'Delete scene',
			(p) => {
				const scenes = removeScene(p.scenes, id);
				const kept =
					overlays === 'remove'
						? p.overlays.filter((o) => !ids.has(o.id))
						: relinkByTime(p.overlays, before, placeScenes(scenes), ids);
				return { ...p, scenes, overlays: compactRows(kept) };
			},
			{ select: nextSelected }
		);
	}

	/** Delete whatever is selected. */
	deleteSelected(): void {
		const id = this.selectedId;
		if (!id) return;
		if (this.project.scenes.some((s) => s.id === id)) this.deleteScene(id);
		else if (this.project.texts.some((t) => t.id === id)) this.deleteText(id);
		else if (this.project.sounds.some((s) => s.id === id)) this.deleteSound(id);
		else if (this.project.overlays.some((o) => o.id === id)) this.deleteOverlay(id);
	}

	// ─── Layers (overlays) ──────────────────────────────────────────────────────────────────

	private updateOverlay(label: string, id: string, change: (o: Overlay) => Overlay, key?: string): void {
		this.edit(label, (p) => ({ ...p, overlays: p.overlays.map((o) => (o.id === id ? change(o) : o)) }), {
			key
		});
	}

	/** Whether a video layer may play from `start` for `duration` (at most 4 videos at once). */
	private videoRoom(o: Overlay, start: number, duration: number): boolean {
		if (o.kind !== 'video' || !tooManyVideos(this.placedOverlays, start, duration, o.id)) return true;
		toasts.show(
			`Up to ${MAX_VIDEO_OVERLAYS} videos can play on top of the scenes at the same moment, so this one can’t go there.`,
			'error'
		);
		return false;
	}

	/** Longest this overlay may show (a video can't outlast its clip). */
	overlayMaxDuration(o: Overlay): number {
		return maxOverlayDuration(o, this.media[o.mediaId]?.duration);
	}

	/** Move an overlay to `start` (linking it to the scene there), into `row` (or a new row above
	 * it, if it would overlap something there). */
	placeOverlay(id: string, start: number, row: number, label = 'Move layer'): void {
		const o = this.project.overlays.find((o) => o.id === id);
		if (!o) return;
		const latest = Math.max(0, this.duration - MIN_OVERLAY_SECONDS);
		const at = Math.min(Math.max(0, start), latest);
		if (!this.videoRoom(o, at, o.duration)) return;
		this.edit(label, (p) => {
			const moved = p.overlays.map((x) => (x.id === id ? moveOverlayTo(x, at, placeScenes(p.scenes)) : x));
			return { ...p, overlays: assignRow(moved, id, row, placeScenes(p.scenes)) };
		});
	}

	/** New timing for an overlay's start or end edge (`delta` in seconds). */
	resizeOverlay(o: Overlay, edge: 'start' | 'end', delta: number): { start: number; duration: number; sourceStart: number } {
		const start = this.placedOverlays.find((p) => p.overlay.id === o.id)?.start ?? 0;
		const max = this.overlayMaxDuration(o);
		if (edge === 'end') {
			const end = Math.min(this.duration, start + o.duration + delta);
			const duration = Math.min(max, Math.max(MIN_OVERLAY_SECONDS, end - start));
			return { start, duration, sourceStart: o.sourceStart };
		}
		// Moving the start: a video shows a later (or earlier) part of its clip.
		let d = Math.min(delta, o.duration - MIN_OVERLAY_SECONDS);
		d = Math.max(d, -start);
		if (o.kind === 'video') d = Math.max(d, -o.sourceStart);
		return { start: start + d, duration: o.duration - d, sourceStart: o.sourceStart + (o.kind === 'video' ? d : 0) };
	}

	/** Change an overlay's timing (start in timeline seconds). */
	setOverlayTiming(id: string, start: number, duration: number, sourceStart?: number, key?: string): void {
		const o = this.project.overlays.find((o) => o.id === id);
		if (!o) return;
		const latest = Math.max(0, this.duration - MIN_OVERLAY_SECONDS);
		const at = Math.min(Math.max(0, start), latest);
		const length = Math.min(this.overlayMaxDuration({ ...o, sourceStart: sourceStart ?? o.sourceStart }), Math.max(MIN_OVERLAY_SECONDS, duration));
		if (!this.videoRoom(o, at, length)) return;
		this.edit(
			'Layer timing',
			(p) => {
				const scenes = placeScenes(p.scenes);
				const overlays = p.overlays.map((x) =>
					x.id === id
						? { ...moveOverlayTo(x, at, scenes), duration: length, sourceStart: sourceStart ?? x.sourceStart }
						: x
				);
				// Longer or moved, it may now overlap something in its row.
				return { ...p, overlays: assignRow(overlays, id, o.row, scenes) };
			},
			{ key }
		);
	}

	/**
	 * Add an overlay at `start` in `row` (default: the top row), and select it. Returns its id, or
	 * null if it couldn't be added (too many videos at that moment).
	 */
	private insertOverlay(o: Omit<Overlay, 'sceneId' | 'offset' | 'row'>, start: number, row?: number): string | null {
		const at = Math.min(Math.max(0, start), Math.max(0, this.duration - MIN_OVERLAY_SECONDS));
		if (o.kind === 'video' && tooManyVideos(this.placedOverlays, at, o.duration)) {
			toasts.show(
				`Up to ${MAX_VIDEO_OVERLAYS} videos can play on top of the scenes at the same moment. Try another time, or use a photo.`,
				'error'
			);
			return null;
		}
		const target = row ?? rowCount(this.project.overlays) - 1;
		this.edit(
			'Add layer',
			(p) => {
				const scenes = placeScenes(p.scenes);
				const overlay: Overlay = { ...o, ...moveOverlayTo({ ...o, row: target } as Overlay, at, scenes), row: target };
				// A photo or video used as a layer is part of "Your media".
				const library = o.mediaId && !p.library.includes(o.mediaId) ? [...p.library, o.mediaId] : p.library;
				return { ...p, library, overlays: assignRow([...p.overlays, overlay], overlay.id, target, scenes) };
			},
			{ select: o.id }
		);
		const placed = this.placedOverlays.find((p) => p.overlay.id === o.id);
		if (placed && !(this.time >= placed.start && this.time < placed.end)) this.seek(placed.start);
		return o.id;
	}

	/** A photo or video from "Your media" as an overlay (5 s, or the clip's length if shorter). */
	addOverlayFromMedia(mediaId: string, start = this.time, row?: number): string | null {
		const info = this.media[mediaId];
		if (!info || info.kind === 'audio') return null;
		const kind = info.kind === 'video' ? 'video' : 'photo';
		const room = Math.max(MIN_OVERLAY_SECONDS, this.duration - Math.max(0, start));
		const length = Math.min(OVERLAY_SECONDS, room, kind === 'video' ? info.duration : Infinity);
		return this.insertOverlay(
			{
				id: newId(),
				kind,
				mediaId,
				name: nameFromFile(info.name),
				duration: Math.max(MIN_OVERLAY_SECONDS, length),
				sourceStart: kind === 'video' ? info.startTime : 0,
				box: defaultBox(info, this.project.format),
				style: { ...DEFAULT_OVERLAY_STYLE },
				enter: 'none',
				exit: 'none',
				sound: { on: false, volume: 1 }
			},
			start,
			row
		);
	}

	/** A card (colour and rectangle) as an overlay. */
	addCardOverlay(start = this.time, row?: number): string | null {
		const room = Math.max(MIN_OVERLAY_SECONDS, this.duration - Math.max(0, start));
		return this.insertOverlay(
			{
				id: newId(),
				kind: 'card',
				mediaId: '',
				name: 'Card',
				duration: Math.min(OVERLAY_SECONDS, room),
				sourceStart: 0,
				box: defaultBox(this.project.format, this.project.format),
				card: defaultCard(),
				style: { ...DEFAULT_OVERLAY_STYLE },
				enter: 'none',
				exit: 'none',
				sound: { on: false, volume: 1 }
			},
			start,
			row
		);
	}

	// ─── Moving between tracks ─────────────────────────────────────────────────────────────

	/**
	 * Turn a scene into a layer at `start` (in the timeline as it is now) in `row`: it gets the
	 * default layer size, and the remaining scenes close the gap. One undo step.
	 */
	sceneToOverlay(sceneId: string, start: number, row: number): string | null {
		const scene = this.project.scenes.find((s) => s.id === sceneId);
		const removed = this.placed.find((p) => p.scene.id === sceneId);
		if (!scene || !removed) return null;
		if (this.project.scenes.length === 1) {
			toasts.show('A layer needs a scene underneath it, so the only scene stays a scene.');
			return null;
		}
		const info = scene.kind === 'card' ? null : this.media[scene.mediaId];
		const picture =
			scene.kind === 'card' || !info
				? this.project.format
				: scene.crop
					? { width: scene.crop.w, height: scene.crop.h }
					: info;
		const length =
			scene.kind === 'video' ? scene.sourceEnd - scene.sourceStart : sceneDuration(scene);
		// Where it lands once the gap has closed: times after the scene move back by its length.
		const at = start >= removed.end ? start - removed.duration : start;
		const overlay: Overlay = {
			id: newId(),
			kind: scene.kind,
			mediaId: scene.mediaId,
			name: scene.name,
			sceneId: null,
			offset: 0,
			duration: Math.max(MIN_OVERLAY_SECONDS, length),
			sourceStart: scene.kind === 'video' ? scene.sourceStart : 0,
			row,
			box: defaultBox(picture, this.project.format),
			crop: scene.crop ? { ...scene.crop } : undefined,
			card: scene.card ? structuredClone($state.snapshot(scene.card) as CardContent) : undefined,
			style: { ...DEFAULT_OVERLAY_STYLE },
			enter: 'none',
			exit: 'none',
			sound: { on: false, volume: 1 }
		};
		const others = this.placedOverlays.filter(
			(p) => p.overlay.kind === 'video' && p.overlay.sceneId !== sceneId
		);
		if (overlay.kind === 'video' && tooManyVideos(others, at, overlay.duration)) {
			toasts.show(
				`Up to ${MAX_VIDEO_OVERLAYS} videos can play on top of the scenes at the same moment. Try another time.`,
				'error'
			);
			return null;
		}
		this.edit(
			'Scene to layer',
			(p) => {
				const before = placeScenes(p.scenes);
				const scenes = p.scenes.filter((s) => s.id !== sceneId);
				const after = placeScenes(scenes);
				// Layers that started over this scene stay where they are in time.
				const linked = new Set(overlaysOf(p.overlays, sceneId).map((o) => o.id));
				const kept = relinkByTime(p.overlays, before, after, linked);
				const latest = Math.max(0, totalDuration(scenes) - MIN_OVERLAY_SECONDS);
				const placed = { ...overlay, ...linkAt(Math.min(Math.max(0, at), latest), after) };
				return { ...p, scenes, overlays: assignRow([...kept, placed], placed.id, row, after) };
			},
			{ select: overlay.id }
		);
		return overlay.id;
	}

	/** Turn a layer into a full-frame scene at `index`. One undo step. */
	overlayToScene(overlayId: string, index: number): string | null {
		const o = this.project.overlays.find((x) => x.id === overlayId);
		if (!o) return null;
		const scene: Scene = {
			id: newId(),
			mediaId: o.mediaId,
			kind: o.kind,
			name: o.name,
			sourceStart: o.kind === 'video' ? o.sourceStart : 0,
			sourceEnd: o.kind === 'video' ? o.sourceStart + o.duration : o.duration,
			speed: 1,
			volume: 1,
			mood: null,
			transition: { kind: 'cut', duration: 0 },
			frame: { ...DEFAULT_FRAME },
			...(o.crop ? { crop: { ...o.crop } } : {}),
			...(o.card ? { card: structuredClone($state.snapshot(o.card) as CardContent) } : {})
		};
		this.edit(
			'Layer to scene',
			(p) => {
				const scenes = p.scenes.slice();
				scenes.splice(Math.max(0, Math.min(index, scenes.length)), 0, scene);
				return { ...p, scenes, overlays: compactRows(p.overlays.filter((x) => x.id !== overlayId)) };
			},
			{ select: scene.id }
		);
		const placed = this.placed.find((p) => p.scene.id === scene.id);
		if (placed) this.seek(placed.start);
		return scene.id;
	}

	/** Where a layer sits and how big it is (fractions of the frame). `key` merges drags. */
	setOverlayBox(id: string, box: OverlayBox, key?: string): void {
		const copy = { ...box };
		this.updateOverlay('Move layer', id, (o) => ({ ...o, box: copy }), key);
	}

	setOverlayStyle(id: string, style: OverlayStyle, key?: string): void {
		const copy = { ...style };
		this.updateOverlay('Layer style', id, (o) => ({ ...o, style: copy }), key);
	}

	setOverlayAnimation(id: string, which: 'enter' | 'exit', animation: TextAnimation): void {
		this.updateOverlay('Layer animation', id, (o) => ({ ...o, [which]: animation }));
	}

	setOverlaySound(id: string, sound: { on: boolean; volume: number }, key?: string): void {
		const copy = { ...sound };
		this.updateOverlay('Layer sound', id, (o) => ({ ...o, sound: copy }), key);
	}

	setOverlayCard(id: string, card: CardContent, key?: string): void {
		// $state.snapshot, not structuredClone: the card may contain reactive proxies.
		const copy = $state.snapshot(card) as CardContent;
		this.updateOverlay('Card', id, (o) => ({ ...o, card: copy }), key);
	}

	/** Remove a layer's crop (its box takes the whole picture's shape, keeping its width). */
	removeOverlayCrop(id: string): void {
		const o = this.project.overlays.find((x) => x.id === id);
		const size = o && this.sourceSize(o);
		if (!o?.crop || !size) return;
		const box = fitShape(o.box, size, this.project.format);
		this.updateOverlay('Remove crop', id, (x) => ({ ...x, crop: undefined, box }));
	}

	/** Move a layer up a row (drawn over more), or down (drawn under more). */
	moveOverlayRow(id: string, direction: 1 | -1): void {
		const o = this.project.overlays.find((x) => x.id === id);
		if (!o) return;
		this.edit(direction > 0 ? 'Bring forward' : 'Send back', (p) => {
			const scenes = placeScenes(p.scenes);
			// Up: into the row above (or a new row above it if something's in the way there).
			if (direction > 0) return { ...p, overlays: assignRow(p.overlays, id, o.row + 1, scenes) };
			// Down: into the row below (or a new row just under it if something's in the way).
			return { ...p, overlays: sendBack(p.overlays, id, scenes) };
		});
	}

	deleteOverlay(id: string): void {
		this.edit('Remove layer', (p) => ({ ...p, overlays: compactRows(p.overlays.filter((o) => o.id !== id)) }), {
			select: this.selectedId === id ? null : this.selectedId
		});
	}

	// ─── Sound ──────────────────────────────────────────────────────────────────────────────

	/** Store an audio file, its waveform, and return its info. */
	private async storeAudio(file: File): Promise<MediaInfo> {
		// The same file again is stored only once.
		const hash = await fingerprint(file);
		const existing = await findMediaByHash(hash);
		if (existing?.kind === 'audio') {
			this.media[existing.id] = existing;
			void this.loadWaveforms([existing.id]);
			return existing;
		}
		const { info: probed } = await probeFile(file);
		if (probed.kind !== 'audio') {
			throw new MediaImportError(`“${file.name}” isn’t a sound file. Try an MP3, M4A or WAV.`);
		}
		const info: MediaInfo = { ...probed, id: newId(), hash, createdAt: Date.now() };
		await putMedia({ ...info, blob: file });
		registerBlob(info, file);
		this.media[info.id] = info;
		void this.loadWaveforms([info.id]);
		return info;
	}

	/** Use a sound file as background music for the whole video (replacing any previous music). */
	async addMusic(file: File): Promise<void> {
		void requestPersistentStorage();
		await this.load();
		this.importing++;
		try {
			const info = await this.storeAudio(file);
			// The first song starts with the video; more songs start at the playhead. Each goes in
			// the first row where it fits (a second row if it overlaps).
			const start = this.project.sounds.length ? Math.min(this.time, Math.max(0, this.duration - MIN_SOUND)) : 0;
			const duration = info.duration - info.startTime;
			const sound: SoundItem = {
				id: newId(),
				mediaId: info.id,
				name: file.name.replace(/\.[^.]+$/, '') || 'Music',
				start,
				sourceStart: info.startTime,
				duration,
				volume: 0.6,
				kind: 'music',
				fadeIn: MUSIC_FADE_IN,
				fadeOut: MUSIC_FADE_OUT,
				row: freeRow(this.project.sounds, start, duration)
			};
			this.edit('Add music', (p) => ({ ...p, sounds: [...p.sounds, sound] }), { select: sound.id });
		} catch (error) {
			toasts.show(
				error instanceof MediaImportError
					? error.message
					: `“${file.name}” couldn’t be used as music.`,
				'error'
			);
			if (!(error instanceof MediaImportError)) console.error(error);
		} finally {
			this.importing--;
		}
	}

	private updateSound(
		label: string,
		id: string,
		fn: (s: SoundItem) => SoundItem,
		key?: string
	): void {
		if (!this.project.sounds.some((s) => s.id === id)) return;
		this.edit(label, (p) => ({ ...p, sounds: p.sounds.map((s) => (s.id === id ? fn(s) : s)) }), {
			key
		});
	}

	setSoundVolume(id: string, volume: number): void {
		this.updateSound('Volume', id, (s) => ({ ...s, volume }), `sound-volume:${id}`);
	}

	/** Fade in and out lengths (0–5 s each). `key` merges drags. */
	setSoundFades(id: string, fadeIn: number, fadeOut: number, key?: string): void {
		const clamp = (v: number) => Math.round(Math.min(MAX_FADE, Math.max(0, v)) * 100) / 100;
		this.updateSound('Fade', id, (s) => ({ ...s, fadeIn: clamp(fadeIn), fadeOut: clamp(fadeOut) }), key);
	}

	/** The part of its file a sound clip may use. */
	soundBounds(sound: SoundItem): { start: number; end: number } {
		const info = this.media[sound.mediaId];
		return info
			? { start: info.startTime, end: info.duration }
			: { start: sound.sourceStart, end: sound.sourceStart + sound.duration };
	}

	/** A sound clip with one edge trimmed by `delta` seconds (not applied; see setSoundTiming). */
	trimmedSound(sound: SoundItem, edge: 'start' | 'end', delta: number): SoundItem {
		return trimSound(sound, edge, delta, this.soundBounds(sound), soundEnd(sound, this.duration));
	}

	/**
	 * Place a sound clip: its timing (start, part of the file) and row. If it overlaps a clip in
	 * that row, it gets a new row below. One undo step (`key` merges quick repeats).
	 */
	setSoundTiming(
		id: string,
		timing: Pick<SoundItem, 'start' | 'sourceStart' | 'duration'>,
		row?: number,
		label = 'Sound timing',
		key?: string
	): void {
		const sound = this.project.sounds.find((x) => x.id === id);
		if (!sound) return;
		const latest = Math.max(0, this.duration - MIN_SOUND);
		const next = { ...timing, start: Math.min(Math.max(0, timing.start), latest) };
		this.edit(
			label,
			(p) => {
				const sounds = p.sounds.map((x) => (x.id === id ? { ...x, ...next } : x));
				return { ...p, sounds: assignSoundRow(sounds, id, row ?? sound.row) };
			},
			{ key }
		);
	}

	/** Split the selected (or given) sound clip at the playhead. */
	splitSoundAtPlayhead(id = this.selectedSound?.id): void {
		const sound = this.project.sounds.find((x) => x.id === id);
		if (!sound) return;
		const parts = splitSound($state.snapshot(sound) as SoundItem, this.player.time, newId);
		if (!parts) {
			toasts.show('Move the playhead into the sound to split it there.');
			return;
		}
		this.edit(
			'Split sound',
			(p) => ({ ...p, sounds: p.sounds.flatMap((x) => (x.id === sound.id ? parts : [x])) }),
			{ select: parts[1].id }
		);
	}

	deleteSound(id: string): void {
		this.edit(
			'Remove sound',
			(p) => ({ ...p, sounds: compactSoundRows(p.sounds.filter((s) => s.id !== id)) }),
			{ select: this.selectedId === id ? null : this.selectedId }
		);
	}

	/** Render the mixed soundtrack for a stretch of time (used by export and tests). */
	mixdown(from: number, to: number, sampleRate = 48000): Promise<AudioBuffer> {
		const media = this.media;
		return mixdown(
			projectAudioClips(this.snapshot(), (id) => !!media[id]?.hasAudio),
			from,
			to,
			sampleRate
		);
	}

	// ─── Save video ─────────────────────────────────────────────────────────────────────────

	/** Render and encode the video. The dialog shows progress and can cancel with `signal`. */
	async saveVideo(
		presetId: PresetId,
		onProgress: (p: ExportProgress) => void,
		signal: AbortSignal
	): Promise<ExportResult> {
		this.player.pause();
		const media = this.media;
		return exportVideo({
			project: this.snapshot(),
			preset: presetById(presetId),
			bounds: (scene) => this.bounds(scene),
			sourceSize: (id) => (media[id] ? { width: media[id].width, height: media[id].height } : null),
			hasAudio: (id) => !!media[id]?.hasAudio,
			onProgress,
			signal
		});
	}

	// ─── Voiceover ──────────────────────────────────────────────────────────────────────────

	private recorder: VoiceRecorder | null = null;
	private recordTimer: ReturnType<typeof setInterval> | undefined;
	private voiceCount = 0;

	/** Count down, then record the microphone while the video plays (muted) from the playhead. */
	async startVoiceover(): Promise<void> {
		if (this.recording) return;
		if (!this.project.scenes.length) {
			toasts.show('Add a photo or video first, then record your voice over it.');
			return;
		}
		this.player.unlockAudio();
		this.player.pause();
		const recorder = new VoiceRecorder();
		try {
			await recorder.open();
		} catch (error) {
			toasts.show(
				error instanceof MicrophoneError ? error.message : 'The microphone couldn’t be started.',
				'error'
			);
			return;
		}
		this.recorder = recorder;
		if (this.player.time >= this.duration - 0.5) this.seek(0);
		const start = this.player.time;
		this.recording = { phase: 'countdown', count: 3, start, elapsed: 0 };
		for (let n = 3; n > 0; n--) {
			if (this.recorder !== recorder) return;
			this.recording = { phase: 'countdown', count: n, start, elapsed: 0 };
			await new Promise((r) => setTimeout(r, 700));
		}
		if (this.recorder !== recorder) return;
		recorder.start();
		// Play the video so you can talk over it, but silently so the mic doesn't pick it up.
		this.player.setMuted(true);
		void this.player.play();
		this.recording = { phase: 'recording', count: 0, start, elapsed: 0 };
		this.recordTimer = setInterval(() => {
			if (!this.recording) return;
			this.recording = { ...this.recording, elapsed: recorder.elapsed };
			// The video ended: stop recording too.
			if (!this.player.playing) void this.stopVoiceover();
		}, 100);
	}

	/** Stop recording and add the voiceover where it started. */
	async stopVoiceover(): Promise<void> {
		const recorder = this.recorder;
		const state = this.recording;
		if (!recorder || !state) return;
		this.recorder = null;
		clearInterval(this.recordTimer);
		this.recording = null;
		this.player.pause();
		this.player.setMuted(false);
		if (state.phase === 'countdown') {
			recorder.close();
			return;
		}
		const result = await recorder.stop();
		if (!result || result.seconds < 0.3) {
			toasts.show('That recording was too short to keep.');
			return;
		}
		const name = `Voiceover ${++this.voiceCount}`;
		try {
			const file = new File([result.blob], `${name}.webm`, { type: result.blob.type });
			const info = await this.storeAudio(file);
			const sound: SoundItem = {
				id: newId(),
				mediaId: info.id,
				name,
				start: state.start,
				sourceStart: info.startTime,
				duration: Math.max(0.3, info.duration - info.startTime),
				volume: 1,
				kind: 'voice',
				fadeIn: 0,
				fadeOut: 0,
				row: freeRow(this.project.sounds, state.start, Math.max(0.3, info.duration - info.startTime))
			};
			this.edit('Record voiceover', (p) => ({ ...p, sounds: [...p.sounds, sound] }), {
				select: sound.id
			});
			this.seek(state.start);
		} catch (error) {
			console.error(error);
			toasts.show('The recording couldn’t be saved. Please try again.', 'error');
		}
	}

	cancelVoiceover(): void {
		const recorder = this.recorder;
		if (!recorder) return;
		this.recorder = null;
		clearInterval(this.recordTimer);
		this.recording = null;
		this.player.pause();
		this.player.setMuted(false);
		recorder.close();
	}

	// ─── Words ──────────────────────────────────────────────────────────────────────────────

	/** Add a title (big, centred) or a caption (near the bottom) at the playhead, ready to type. */
	addText(kind: 'title' | 'caption'): void {
		if (!this.project.scenes.length) {
			toasts.show('Add a photo or video first, then put words on it.');
			return;
		}
		const item: TextItem = clampTextTiming(
			{
				id: newId(),
				text: kind === 'title' ? 'Your title' : 'Your caption',
				start: this.player.time >= this.duration - 0.5 ? 0 : this.player.time,
				duration: 3,
				x: 0.5,
				y: kind === 'title' ? 0.5 : 0.84,
				style: kind === 'title' ? 'title' : 'boxed',
				animation: 'fade'
			},
			this.duration
		);
		this.edit(
			kind === 'title' ? 'Add title' : 'Add caption',
			(p) => ({ ...p, texts: [...p.texts, item] }),
			{
				select: item.id
			}
		);
		this.seek(item.start + Math.min(TEXT_ENTER, item.duration / 2));
		this.startEditingText(item.id);
	}

	private updateText(label: string, id: string, fn: (t: TextItem) => TextItem, key?: string): void {
		if (!this.project.texts.some((t) => t.id === id)) return;
		this.edit(label, (p) => ({ ...p, texts: p.texts.map((t) => (t.id === id ? fn(t) : t)) }), {
			key
		});
	}

	/** Change the words. Empty text removes the item. */
	setTextWords(id: string, text: string, key?: string): void {
		const current = this.project.texts.find((t) => t.id === id);
		if (!current) return;
		const clean = text
			.replace(/\r/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trimEnd();
		if (!clean.trim()) {
			if (!key) this.deleteText(id);
			return;
		}
		if (clean !== current.text)
			this.updateText('Edit words', id, (t) => ({ ...t, text: clean }), key);
	}

	/** A style is a starting point: picking one applies its own colours (font and size stay). */
	setTextStyle(id: string, style: TextStyleId): void {
		this.updateText('Text style', id, (t) => ({ ...t, style, colors: undefined }));
	}

	/** Override some of the style's colours (`undefined` = back to the style's own). */
	setTextColors(id: string, colors: TextColors | undefined, key?: string): void {
		// $state.snapshot, not structuredClone: the colours may contain reactive proxies.
		const copy = colors ? ($state.snapshot(colors) as TextColors) : undefined;
		this.updateText('Text colour', id, (t) => ({ ...t, colors: copy }), key);
	}

	/** Font size as a fraction of the frame's short side (`undefined` = the style's own). */
	setTextSize(id: string, size: number | undefined, key?: string): void {
		this.updateText('Text size', id, (t) => ({ ...t, size }), key);
	}

	setTextFont(id: string, font: TextFont | undefined): void {
		this.updateText('Font', id, (t) => ({ ...t, font: font ? { ...font } : undefined }));
		if (font) this.fonts.addRecent(font);
	}

	setTextAnimation(id: string, animation: TextAnimation): void {
		this.updateText('Animation', id, (t) => ({ ...t, animation }));
	}

	setTextPosition(id: string, x: number, y: number): void {
		this.updateText('Move words', id, (t) => ({ ...t, x, y }), `pos:${id}`);
	}

	setTextTiming(id: string, start: number, duration: number): void {
		const d = this.duration;
		this.updateText(
			'Timing',
			id,
			(t) => clampTextTiming({ ...t, start, duration }, d),
			`timing:${id}`
		);
	}

	/** Move one edge of a text's timing (used by the Words lane). */
	resizeTextTiming(item: TextItem, edge: 'start' | 'end', delta: number): TextItem {
		return resizeText(item, edge, delta, this.duration);
	}

	deleteText(id: string): void {
		if (this.editingTextId === id) this.stopEditingText();
		this.edit('Remove words', (p) => ({ ...p, texts: p.texts.filter((t) => t.id !== id) }), {
			select: this.selectedId === id ? null : this.selectedId
		});
	}

	startEditingText(id: string): void {
		this.editingTextId = id;
		this.player.hideText(id);
	}

	stopEditingText(): void {
		if (!this.editingTextId) return;
		this.editingTextId = null;
		this.player.hideText(null);
	}

	/** Change the project's shape, size or frame rate. */
	setFormat(format: ProjectFormat): void {
		const current = this.project.format;
		const same =
			format.preset === current.preset &&
			format.width === current.width &&
			format.height === current.height &&
			format.fps === current.fps;
		if (same && this.project.formatSet) return;
		this.edit('Video format', (p) => ({ ...p, format: { ...format }, formatSet: true }));
	}

	setTitle(title: string): void {
		const clean = title.trim().slice(0, 80) || 'Untitled video';
		if (clean !== this.project.title) this.edit('Rename', (p) => ({ ...p, title: clean }));
	}

	// ─── Import ─────────────────────────────────────────────────────────────────────────────

	/** Add photos and videos as scenes at the end, in the order given. */
	/**
	 * Store a photo or video file (once, however often it's imported) and load its info and
	 * thumbnail. Returns null (after saying why) for sound files and files that can't be read.
	 */
	private async storeVisual(file: File): Promise<MediaInfo | null> {
		try {
			// The same file again (in this or another project) is stored only once.
			const hash = await fingerprint(file);
			let info = await findMediaByHash(hash);
			if (info && info.kind === 'audio') {
				toasts.show(`“${file.name}” is a sound file. Add it from Sound instead.`, 'error');
				return null;
			}
			if (info) {
				void this.loadThumbnails([info.id]);
			} else {
				const { info: probed, thumbnail } = await probeFile(file);
				if (probed.kind === 'audio') {
					toasts.show(`“${file.name}” is a sound file. Add it from Sound instead.`, 'error');
					return null;
				}
				info = { ...probed, id: newId(), hash, createdAt: Date.now() };
				await putMedia({ ...info, blob: file });
				registerBlob(info, file);
				if (thumbnail) {
					await putThumbnail(info.id, thumbnail);
					this.thumbnails[info.id] = URL.createObjectURL(thumbnail);
				}
			}
			this.media[info.id] = info;
			return info;
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
			return null;
		}
	}

	/**
	 * Photos and videos from the computer as overlays at `start` (each also joins "Your media").
	 * Without any scenes yet there's nothing to put them on, so they become scenes.
	 */
	async importAsOverlays(files: File[], start: number, row?: number): Promise<void> {
		if (files.length === 0) return;
		await this.load();
		if (this.project.scenes.length === 0) return this.importFiles(files);
		this.importing += files.length;
		try {
			for (const file of files) {
				const info = await this.storeVisual(file);
				this.importing--;
				if (info) this.addOverlayFromMedia(info.id, start, row);
			}
		} finally {
			this.importing = Math.max(0, this.importing);
		}
	}

	/** Photos and videos from the computer as scenes, at `index` (default: the end). */
	async importFiles(files: File[], index?: number): Promise<void> {
		if (files.length === 0) return;
		void requestPersistentStorage();
		// Let the last project finish restoring first, so the new scenes join it.
		await this.load();
		this.importing += files.length;
		let added = 0;
		// Scenes appear one by one as files are read, but the whole import is one undo step.
		const before = this.snapshot();
		for (const file of files) {
			try {
				const info = await this.storeVisual(file);
				if (!info) continue;
				const scene = sceneFromMedia(info);
				// A new project takes its format from the first clip.
				if (!this.project.formatSet && this.project.scenes.length === 0) {
					this.project.format = formatFromClip(info.width, info.height, info.fps);
					this.project.formatSet = true;
				}
				if (index === undefined) this.project.scenes.push(scene);
				else this.project.scenes.splice(Math.min(index + added, this.project.scenes.length), 0, scene);
				if (!this.project.library.includes(info.id)) this.project.library.push(info.id);
				this.selectedId = scene.id;
				this.syncPlayer();
				added++;
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
		if (added > 0 && before.scenes.length === 0) {
			toasts.show(
				'Nice! Drag the cards to change the order. Press ? to see all shortcuts.',
				'info',
				6000
			);
		} else if (added > 1) {
			toasts.show(`Added ${added} scenes`);
		}
	}
}
