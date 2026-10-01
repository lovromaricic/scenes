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
	soundEnd,
	splitSound,
	trimSound
} from '$lib/model/sound';
import {
	MAX_VIDEO_OVERLAYS,
	MIN_OVERLAY_SECONDS,
	OVERLAY_SECONDS,
	DEFAULT_OVERLAY_STYLE,
	defaultBox,
	tooManyVideos,
	mostVideosAtOnce,
	fitShape,
	maxOverlayDuration,
	placeOverlays,
	type Overlay,
	type OverlayBox,
	type OverlayStyle
} from '$lib/model/overlay';
import {
	addTrack,
	allItems,
	deleteTrack,
	duplicateTrack,
	getItem,
	itemKind,
	moveItems,
	removeItems,
	moveTrack,
	renameTrack,
	setTrackFlags,
	settle,
	updateItem,
	type AnyItem
} from '$lib/model/items';
import { reconcileTimeline } from '$lib/model/ripple';
import {
	DEFAULT_EASING,
	EASINGS,
	itemValuesAt,
	keyframeAt,
	overlayBaseValues,
	SAME_TIME,
	sceneContentTime,
	sceneFrameAt,
	sceneKeyframeTimelineTime,
	shiftKeyframes,
	sortKeyframes,
	splitKeyframeList,
	textBaseValues,
	upsertKeyframe,
	type Easing,
	type EasingPreset,
	type FrameValues,
	type ItemValues,
	type Keyframe
} from '$lib/model/keyframes';
import { mediaNoun } from '$lib/model/labels';
import { VOLUME_EASINGS, volumeAt, volumePoint, type VolumeValues } from '$lib/model/volume';
import { TEXT_TRACK_NAME, accepts, fits, freeTrack, type ItemKind, type Track } from '$lib/model/tracks';
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
import {
	exportAudio,
	exportFrame,
	exportVideo,
	type AudioFormat,
	type ExportProgress,
	type ExportRange,
	type ExportResult,
	type FrameFormat
} from '$lib/export/exporter';
import { presetById, type PresetId } from '$lib/export/presets';
import { newCardScene, newId, newProject, sceneFromMedia } from './project';
import { nameFromFile } from '$lib/media/kinds';
import { defaultCard } from '$lib/model/card';
import { toasts } from './toasts.svelte';

/**
 * An overlay or words with new timing. Trimmed from the left (the end stays put), its keyframes
 * move the other way, so the motion stays where it was on the timeline. Moved, they go with it.
 */
function retimed<
	T extends { start: number; duration: number; keyframes?: Keyframe<ItemValues>[]; volumePoints?: Keyframe<VolumeValues>[] }
>(item: T, next: Partial<T> & { start: number; duration: number }): T {
	const out = { ...item, ...next };
	const endBefore = item.start + item.duration;
	const endAfter = next.start + next.duration;
	if (Math.abs(endBefore - endAfter) < 1e-6 && Math.abs(next.start - item.start) > 1e-9) {
		// Keyframes and volume points both stay where they were on the timeline.
		if (item.keyframes?.length) out.keyframes = shiftKeyframes(item.keyframes, item.start - next.start);
		if (item.volumePoints?.length) out.volumePoints = shiftKeyframes(item.volumePoints, item.start - next.start);
	}
	return out;
}

/**
 * Keyframe values for another kind of item: overlays and words share everything; with a scene's
 * framing they share position (the framing's offset from the centre) and size (scale ↔ zoom).
 * What isn't shared comes from `own`, the target's values at that moment.
 */
function convertValues(
	v: ItemValues | FrameValues,
	from: 'item' | 'frame',
	to: 'item' | 'frame',
	own: ItemValues | FrameValues
): ItemValues | FrameValues {
	if (from === to) return { ...v };
	if (to === 'frame') {
		const i = v as ItemValues;
		return { ...(own as FrameValues), x: i.x - 0.5, y: i.y - 0.5, zoom: i.scaleX };
	}
	const f = v as FrameValues;
	return { ...(own as ItemValues), x: f.x + 0.5, y: f.y + 0.5, scaleX: f.zoom, scaleY: f.zoom };
}

/** A keyframe on an item (overlay, words or scene). */
export interface KeyframeRef {
	itemId: string;
	id: string;
	/** Motion keyframes (default) or volume points. */
	channel?: KeyframeChannel;
}

/** What a list of keyframes animates: an item's motion (or framing), or its sound's volume. */
export type KeyframeChannel = 'motion' | 'volume';
type AnyValues = ItemValues | FrameValues | VolumeValues;

/** An item's keyframes and how their times map to the timeline (see `keyframeTrack`). */
export interface KeyframeTrack {
	kind: 'overlay' | 'text' | 'scene' | 'sound';
	channel: KeyframeChannel;
	list: Keyframe<AnyValues>[];
	toTimeline: (time: number) => number;
	fromTimeline: (t: number) => number;
	/** Where the item shows on the timeline. */
	start: number;
	end: number;
}

const EASING_KEY = 'scenes.defaultEasing';
function readDefaultEasing(): EasingPreset {
	try {
		const v = localStorage.getItem(EASING_KEY);
		return v && v in EASINGS ? (v as EasingPreset) : DEFAULT_EASING;
	} catch {
		return DEFAULT_EASING;
	}
}

const RIPPLE_KEY = 'scenes.ripple';
function readRipple(): boolean {
	try {
		return localStorage.getItem(RIPPLE_KEY) === '1';
	} catch {
		return false;
	}
}

/** A copied item and which list it belongs to. */
interface Clipped {
	type: ItemKind;
	item: AnyItem;
}

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
	/**
	 * Items on tracks selected together (Shift-click or a selection box). Always includes the
	 * selected item, if it's on a track; scenes are selected on their own.
	 */
	extraSelected = $state<string[]>([]);
	/** Every selected item: the selected one and any others selected with it. */
	selectedIds = $derived(
		this.selectedId && !this.extraSelected.includes(this.selectedId)
			? [this.selectedId, ...this.extraSelected]
			: this.extraSelected
	);
	/**
	 * Ripple: when scenes change, items on the other tracks move with them (off by default).
	 * Remembered on this device.
	 */
	ripple = $state(readRipple());
	setRipple(on: boolean): void {
		this.ripple = on;
		try {
			localStorage.setItem(RIPPLE_KEY, on ? '1' : '0');
		} catch {
			// Storage blocked: it just isn't remembered.
		}
	}
	/**
	 * The track pasted items go to: the track of the last selected item, or of an empty spot
	 * clicked on a lane.
	 */
	activeTrackId = $state<string | null>(null);
	/** Items copied or cut (Ctrl/Cmd+C / X), kept in the page only. */
	private clipboard: { items: Clipped[] } | null = null;
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
	placedOverlays = $derived(placeOverlays(this.project.overlays, this.project.tracks.map((t) => t.id)));
	selectedOverlay = $derived(this.placedOverlays.find((p) => p.overlay.id === this.selectedId) ?? null);

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
		const after = { ...this.reconcile(before, change(structuredClone(before))), updatedAt: Date.now() };
		if (!this.videosFit(before, after)) return;
		this.history.record(label, before, after, options.key);
		this.project = after;
		if (options.select !== undefined) this.selectedId = options.select;
		this.afterChange();
	}

	/**
	 * Whether a change keeps within MAX_VIDEO_OVERLAYS videos playing on top at once (hidden
	 * tracks count too, so showing one again never goes over). A change that would go over is
	 * refused with a message; one that doesn't make things worse is allowed.
	 */
	private videosFit(before: Project, after: Project): boolean {
		if (after.overlays === before.overlays) return true;
		const most = mostVideosAtOnce(placeOverlays(after.overlays));
		if (most <= MAX_VIDEO_OVERLAYS || most <= mostVideosAtOnce(placeOverlays(before.overlays))) return true;
		toasts.show(
			`Up to ${MAX_VIDEO_OVERLAYS} videos can play on top of the scenes at the same moment, so that can’t be done here.`,
			'error'
		);
		return false;
	}

	/**
	 * After a change to the scenes, adjust the items on the other tracks: with ripple on they move
	 * with the scenes; either way, items ending at the video's end stay there (see ripple.ts).
	 * Anything that then overlaps goes on a new track just above.
	 */
	private reconcile(before: Project, after: Project): Project {
		let next = reconcileTimeline(before, after, this.ripple, (item, list) => {
			if (list === 'overlays') return this.overlayMaxDuration(item as Overlay);
			if (list === 'sounds') {
				const s = item as SoundItem;
				return this.soundBounds(s).end - s.sourceStart;
			}
			return Infinity;
		});
		if (next === after) return after;
		for (const i of allItems(next)) {
			const was = getItem(after, i.id);
			if (was && (was.start !== i.start || was.duration !== i.duration)) next = settle(next, i.id, newId);
		}
		return next;
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
		const after = this.reconcile(before, change(structuredClone(this.snapshot())));
		if (!this.videosFit(before, after)) {
			this.project = before;
			this.afterChange();
			return;
		}
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
		// Collapsed tracks are a view setting: undo and redo keep them as they are now.
		const collapsed = new Map(this.project.tracks.map((t) => [t.id, !!t.collapsed]));
		const next = structuredClone(state);
		next.tracks = next.tracks.map((t) =>
			collapsed.has(t.id) && collapsed.get(t.id) !== !!t.collapsed ? { ...t, collapsed: collapsed.get(t.id) } : t
		);
		this.project = next;
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

	/** Add an item to the selection, or take it out (Shift-click on the storyboard). */
	toggleSelected(id: string): void {
		if (this.trackOfItem(id)?.locked) return;
		const current = this.selectedIds.filter((x) => itemKind(this.project, x));
		const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
		this.selectedId = next.at(-1) ?? null;
		this.extraSelected = next.slice(0, -1);
	}

	/** Select several items on tracks at once (a selection box). */
	selectItems(ids: string[]): void {
		const ok = ids.filter((id) => itemKind(this.project, id) && !this.trackOfItem(id)?.locked);
		this.selectedKeyframes = [];
		this.stopEditingText();
		this.selectedId = ok.at(-1) ?? null;
		this.extraSelected = ok.slice(0, -1);
		const onTrack = this.selectedId ? getItem(this.project, this.selectedId)?.trackId : undefined;
		if (onTrack) this.activeTrackId = onTrack;
	}

	/** Whether an item ends exactly at the end of the video (it then stays there, see ripple). */
	endsWithVideo(item: { start: number; duration: number }): boolean {
		return this.duration > 0 && Math.abs(item.start + item.duration - this.duration) < 1e-3;
	}

	select(id: string | null): void {
		this.extraSelected = [];
		// Selected keyframes belong to the selected item; selecting anything clears them (a click
		// on a keyframe selects its item first, then the keyframe).
		this.selectedKeyframes = [];
		// Items on locked tracks can't be selected.
		if (id && this.trackOfItem(id)?.locked) return;
		if (id !== this.editingTextId) this.stopEditingText();
		this.selectedId = id;
		const onTrack = id ? getItem(this.project, id)?.trackId : undefined;
		if (onTrack) this.activeTrackId = onTrack;
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
		this.edit(`Crop for every scene from this ${mediaNoun(scene)}`, (p) => ({
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
		this.updateScene('Video sound', id, (s) => ({ ...s, volume }), `volume:${id}`);
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

	/** Remove a scene (the ones after it close the gap). */
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
		if (!id) return;
		// Several items on tracks: removed together, as one step.
		if (this.selectedIds.length > 1) {
			const ids = new Set(this.selectedIds.filter((x) => itemKind(this.project, x) && !this.trackOfItem(x)?.locked));
			if (this.editingTextId && ids.has(this.editingTextId)) this.stopEditingText();
			this.edit(`Remove ${ids.size} items`, (p) => removeItems(p, ids), { select: null });
			this.extraSelected = [];
			return;
		}
		if (this.project.scenes.some((s) => s.id === id)) this.deleteScene(id);
		else if (this.project.texts.some((t) => t.id === id)) this.deleteText(id);
		else if (this.project.sounds.some((s) => s.id === id)) this.deleteSound(id);
		else if (this.project.overlays.some((o) => o.id === id)) this.deleteOverlay(id);
	}

	// ─── Copy, cut and paste ───────────────────────────────────────────────────────────────

	/** The selected items on tracks (not scenes), in time order. */
	private selectedTrackItems(): Clipped[] {
		return this.selectedIds
			.map((id) => {
				const item = getItem(this.project, id);
				const type = itemKind(this.project, id);
				return item && type ? { type, item: structuredClone($state.snapshot(item) as AnyItem) } : null;
			})
			.filter((x): x is Clipped => !!x)
			.sort((a, b) => a.item.start - b.item.start);
	}

	/** Copy the selected items on tracks. Returns whether there was anything to copy. */
	copySelection(): boolean {
		const items = this.selectedTrackItems();
		if (!items.length) return false;
		this.clipboard = { items };
		this.keyframeClipboard = null;
		return true;
	}

	/** Copy the selected items on tracks, then remove them. */
	cutSelection(): boolean {
		const items = this.selectedTrackItems().filter((c) => !this.track(c.item.trackId)?.locked);
		if (!items.length) return false;
		this.clipboard = { items };
		this.keyframeClipboard = null;
		const ids = new Set(items.map((c) => c.item.id));
		if (this.editingTextId && ids.has(this.editingTextId)) this.stopEditingText();
		this.edit(items.length > 1 ? `Cut ${items.length} items` : 'Cut', (p) => removeItems(p, ids), { select: null });
		this.extraSelected = [];
		return true;
	}

	get canPaste(): boolean {
		return !!this.clipboard?.items.length;
	}

	/**
	 * Paste copied items at the playhead (the earliest one there, the others keeping their spacing),
	 * on the active track when it takes them, otherwise on the track they came from (or the first
	 * one of their kind). Anything that would overlap goes on a new track just above. The pasted
	 * items are selected.
	 */
	paste(): boolean {
		if (this.keyframeClipboard) return this.pasteKeyframes();
		const items = this.clipboard?.items;
		if (!items?.length || !this.project.scenes.length) return false;
		const shift = this.time - items[0].item.start;
		const active = this.activeTrackId ? this.track(this.activeTrackId) : undefined;
		const copies = items.map((c) => ({
			type: c.type,
			item: { ...structuredClone(c.item), id: newId(), start: Math.max(0, c.item.start + shift) }
		}));
		const ids: string[] = [];
		let skippedVideo = false;
		this.edit(
			copies.length > 1 ? `Paste ${copies.length} items` : 'Paste',
			(p) => {
				let next = p;
				for (const { type, item } of copies) {
					const usable = (t: Track | undefined) => !!t && accepts(t, type) && !t.locked;
					let trackId = usable(active) ? active!.id : usable(this.track(item.trackId)) ? item.trackId : undefined;
					if (!trackId) {
						const kind = type === 'sound' ? 'audio' : 'overlay';
						const found = next.tracks.find((t) => t.kind === kind && !t.locked);
						if (found) trackId = found.id;
						else {
							trackId = newId();
							next = addTrack(next, kind, kind === 'overlay' ? 0 : next.tracks.length, trackId);
						}
					}
					if (type === 'overlay') {
						const o = item as Overlay;
						if (o.kind === 'video' && tooManyVideos(placeOverlays(next.overlays), o.start, o.duration)) {
							skippedVideo = true;
							continue;
						}
						next = { ...next, overlays: [...next.overlays, { ...o, trackId }] };
					} else if (type === 'text') next = { ...next, texts: [...next.texts, { ...(item as TextItem), trackId }] };
					else next = { ...next, sounds: [...next.sounds, { ...(item as SoundItem), trackId }] };
					next = settle(next, item.id, newId);
					ids.push(item.id);
				}
				return next;
			},
			{ select: null }
		);
		if (skippedVideo)
			toasts.show(
				`Up to ${MAX_VIDEO_OVERLAYS} videos can play on top of the scenes at the same moment, so a video wasn’t pasted.`,
				'error'
			);
		this.selectItems(ids);
		return ids.length > 0;
	}

	// ─── Tracks ─────────────────────────────────────────────────────────────────────────────

	track(id: string): Track | undefined {
		return this.project.tracks.find((t) => t.id === id);
	}

	/** The track an item is on. */
	trackOfItem(itemId: string): Track | undefined {
		const item = getItem(this.project, itemId);
		return item ? this.track(item.trackId) : undefined;
	}

	/** Add an overlay or audio track at `index` in the list (default: top, or bottom for audio). */
	addTrack(kind: 'overlay' | 'audio', index?: number, name?: string): string {
		const id = newId();
		const at = index ?? (kind === 'overlay' ? 0 : this.project.tracks.length);
		this.edit(kind === 'overlay' ? 'Add overlay track' : 'Add audio track', (p) => addTrack(p, kind, at, id, name));
		return id;
	}

	renameTrack(id: string, name: string): void {
		const track = this.track(id);
		if (!track || track.kind === 'main' || !name.trim() || name.trim() === track.name) return;
		this.edit('Rename track', (p) => renameTrack(p, id, name));
	}

	/** Hide or show a visual track, mute or unmute an audio track, or lock or unlock one. */
	setTrackFlag(id: string, flag: 'hidden' | 'muted' | 'locked', on: boolean): void {
		const track = this.track(id);
		if (!track || track.kind === 'main' || track[flag] === on) return;
		const label = { hidden: on ? 'Hide track' : 'Show track', muted: on ? 'Mute track' : 'Unmute track', locked: on ? 'Lock track' : 'Unlock track' }[flag];
		this.edit(label, (p) => setTrackFlags(p, id, { [flag]: on }));
		// Items on a locked track can't stay selected.
		if (on && flag === 'locked') {
			const keep = this.selectedIds.filter((x) => getItem(this.project, x)?.trackId !== id);
			if (keep.length !== this.selectedIds.length) {
				if (this.selectedId && keep.includes(this.selectedId)) this.extraSelected = keep.filter((x) => x !== this.selectedId);
				else this.selectItems(keep);
			}
		}
	}

	/**
	 * Collapse a track to a thin strip, or expand it. A view setting: saved with the project but
	 * not an undo step (and undo leaves it as it is).
	 */
	setTrackCollapsed(id: string, collapsed: boolean): void {
		const track = this.track(id);
		if (!track || track.kind === 'main' || !!track.collapsed === collapsed) return;
		this.project.tracks = this.project.tracks.map((t) => (t.id === id ? { ...t, collapsed } : t));
		this.project.updatedAt = Date.now();
		this.scheduleSave();
	}

	duplicateTrack(id: string): void {
		if (this.track(id)?.kind === 'main') return;
		this.edit('Duplicate track', (p) => duplicateTrack(p, id, newId));
	}

	/** Delete a track and everything on it (the Scenes track stays). */
	deleteTrack(id: string): void {
		if (!this.track(id) || this.track(id)!.kind === 'main') return;
		const gone = new Set(allItems(this.project).filter((i) => i.trackId === id).map((i) => i.id));
		this.edit('Delete track', (p) => deleteTrack(p, id));
		if (this.selectedIds.some((x) => gone.has(x))) this.selectItems(this.selectedIds.filter((x) => !gone.has(x)));
	}

	/** How many items a track holds. */
	itemsOnTrack(id: string): number {
		return allItems(this.project).filter((i) => i.trackId === id).length;
	}

	/** Move a track to `index` in the list (overlay tracks stay above Scenes, audio below). */
	moveTrack(id: string, index: number): void {
		const next = moveTrack(this.project, id, index);
		if (next.tracks.every((t, i) => t.id === this.project.tracks[i].id)) return;
		this.edit('Move track', (p) => moveTrack(p, id, index));
	}

	/**
	 * The first overlay track (from the top) where `span` is free, or a new one at the top. Used
	 * when something is dropped on the picture or added without a track.
	 */
	private overlayTrackFor(p: Project, span: { start: number; duration: number }): { project: Project; trackId: string } {
		const free = freeTrack(p.tracks, allItems(p), 'overlay', span);
		if (free) return { project: p, trackId: free.id };
		const trackId = newId();
		return { project: addTrack(p, 'overlay', 0, trackId), trackId };
	}

	private audioTrackFor(p: Project, span: { start: number; duration: number }): { project: Project; trackId: string } {
		const free = freeTrack(p.tracks, allItems(p), 'audio', span);
		if (free) return { project: p, trackId: free.id };
		const trackId = newId();
		return { project: addTrack(p, 'audio', p.tracks.length, trackId), trackId };
	}

	/**
	 * Move items by `delta` seconds, and (if given) onto another track, as one undo step. An item
	 * that would overlap goes on a new track just above.
	 */
	moveItems(ids: string[], delta: number, trackId?: string, label = 'Move'): void {
		const movable = ids.filter((id) => !this.trackOfItem(id)?.locked);
		if (!movable.length) return;
		this.edit(label, (p) => moveItems(p, movable, delta, newId, trackId));
	}

	/**
	 * Move an item onto a new track created at `index` in the list (dropped into the gap between
	 * two tracks, or above the top one), at `start`.
	 */
	moveItemToNewTrack(id: string, start: number, index: number): void {
		const kind = itemKind(this.project, id);
		const item = getItem(this.project, id);
		if (!kind || !item || this.trackOfItem(id)?.locked) return;
		const trackId = newId();
		this.edit('Move to a new track', (p) => {
			const withTrack = addTrack(p, kind === 'sound' ? 'audio' : 'overlay', index, trackId);
			return updateItem(withTrack, id, (i) => ({ ...i, start: Math.max(0, start), trackId }));
		});
	}

	// ─── Overlays ───────────────────────────────────────────────────────────────────────────

	private updateOverlay(label: string, id: string, change: (o: Overlay) => Overlay, key?: string): void {
		if (this.trackOfItem(id)?.locked) return;
		this.edit(label, (p) => ({ ...p, overlays: p.overlays.map((o) => (o.id === id ? change(o) : o)) }), {
			key
		});
	}

	/** Whether a video overlay may play from `start` for `duration` (at most 4 videos at once). */
	private videoRoom(o: Pick<Overlay, 'kind' | 'id'>, start: number, duration: number): boolean {
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

	/** Move an overlay to `start` on `trackId` (a new track above if it would overlap). */
	placeOverlay(id: string, start: number, trackId?: string, label = 'Move layer'): void {
		const o = this.project.overlays.find((o) => o.id === id);
		if (!o) return;
		const at = Math.max(0, start);
		if (!this.videoRoom(o, at, o.duration)) return;
		this.moveItems([id], at - o.start, trackId, label);
	}

	/** New timing for an overlay's start or end edge (`delta` in seconds). */
	resizeOverlay(o: Overlay, edge: 'start' | 'end', delta: number): { start: number; duration: number; sourceStart: number } {
		const start = o.start;
		const max = this.overlayMaxDuration(o);
		if (edge === 'end') {
			const duration = Math.min(max, Math.max(MIN_OVERLAY_SECONDS, o.duration + delta));
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
		if (!o || this.trackOfItem(id)?.locked) return;
		const at = Math.max(0, start);
		const length = Math.min(
			this.overlayMaxDuration({ ...o, sourceStart: sourceStart ?? o.sourceStart }),
			Math.max(MIN_OVERLAY_SECONDS, duration)
		);
		if (!this.videoRoom(o, at, length)) return;
		this.edit(
			'Layer timing',
			(p) => {
				const overlays = p.overlays.map((x) =>
					x.id === id
						? retimed(x, { start: at, duration: length, sourceStart: sourceStart ?? x.sourceStart })
						: x
				);
				// Longer or moved, it may now overlap something on its track.
				return settle({ ...p, overlays }, id, newId);
			},
			{ key }
		);
	}

	/**
	 * Add an overlay at `start` on `trackId` (default: the first overlay track that's free then, or
	 * a new one at the top), and select it. Returns its id, or null if it couldn't be added (too
	 * many videos at that moment).
	 */
	private insertOverlay(o: Omit<Overlay, 'trackId' | 'start'>, start: number, trackId?: string): string | null {
		const at = Math.max(0, start);
		if (o.kind === 'video' && tooManyVideos(this.placedOverlays, at, o.duration)) {
			toasts.show(
				`Up to ${MAX_VIDEO_OVERLAYS} videos can play on top of the scenes at the same moment. Try another time, or use a photo.`,
				'error'
			);
			return null;
		}
		const target = trackId ? this.track(trackId) : undefined;
		this.edit(
			'Add layer',
			(p) => {
				const span = { start: at, duration: o.duration };
				const place =
					target && target.kind === 'overlay' && !target.locked
						? { project: p, trackId: target.id }
						: this.overlayTrackFor(p, span);
				const overlay: Overlay = { ...o, start: at, trackId: place.trackId };
				// A photo or video used as a layer is part of "Your media".
				const library =
					o.mediaId && !p.library.includes(o.mediaId) ? [...p.library, o.mediaId] : p.library;
				const next = { ...place.project, library, overlays: [...place.project.overlays, overlay] };
				return settle(next, overlay.id, newId);
			},
			{ select: o.id }
		);
		if (!(this.time >= at && this.time < at + o.duration)) this.seek(at);
		return o.id;
	}

	/** A photo or video from "Your media" as an overlay (5 s, or the clip's length if shorter). */
	addOverlayFromMedia(mediaId: string, start = this.time, trackId?: string): string | null {
		const info = this.media[mediaId];
		if (!info || info.kind === 'audio') return null;
		const kind = info.kind === 'video' ? 'video' : 'photo';
		const length = Math.min(OVERLAY_SECONDS, kind === 'video' ? info.duration - info.startTime : Infinity);
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
			trackId
		);
	}

	/** A card (colour and rectangle) as an overlay. */
	addCardOverlay(start = this.time, trackId?: string): string | null {
		return this.insertOverlay(
			{
				id: newId(),
				kind: 'card',
				mediaId: '',
				name: 'Card',
				duration: OVERLAY_SECONDS,
				sourceStart: 0,
				box: defaultBox(this.project.format, this.project.format),
				card: defaultCard(),
				style: { ...DEFAULT_OVERLAY_STYLE },
				enter: 'none',
				exit: 'none',
				sound: { on: false, volume: 1 }
			},
			start,
			trackId
		);
	}

	// ─── Moving between the main track and overlay tracks ───────────────────────────────────

	/**
	 * Turn a scene into an overlay at `start` (in the timeline as it is now) on `trackId`: it gets
	 * the default overlay size, and the remaining scenes close the gap. One undo step.
	 */
	sceneToOverlay(sceneId: string, start: number, trackId?: string, newTrackAt?: number): string | null {
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
		const length = scene.kind === 'video' ? scene.sourceEnd - scene.sourceStart : sceneDuration(scene);
		// Where it lands once the gap has closed: times after the scene move back by its length.
		const at = Math.max(0, start >= removed.end ? start - removed.duration : start);
		const overlay: Omit<Overlay, 'trackId'> = {
			id: newId(),
			kind: scene.kind,
			mediaId: scene.mediaId,
			name: scene.name,
			start: at,
			duration: Math.max(MIN_OVERLAY_SECONDS, length),
			sourceStart: scene.kind === 'video' ? scene.sourceStart : 0,
			box: defaultBox(picture, this.project.format),
			crop: scene.crop ? { ...scene.crop } : undefined,
			card: scene.card ? structuredClone($state.snapshot(scene.card) as CardContent) : undefined,
			style: { ...DEFAULT_OVERLAY_STYLE },
			enter: 'none',
			exit: 'none',
			sound: { on: false, volume: 1 }
		};
		if (!this.videoRoom(overlay, at, overlay.duration)) return null;
		const target = trackId ? this.track(trackId) : undefined;
		this.edit(
			'Scene to layer',
			(p) => {
				const scenes = p.scenes.filter((s) => s.id !== sceneId);
				const span = { start: at, duration: overlay.duration };
				const fresh = newId();
				const place =
					newTrackAt !== undefined
						? { project: addTrack(p, 'overlay', newTrackAt, fresh), trackId: fresh }
						: target && target.kind === 'overlay' && !target.locked
							? { project: p, trackId: target.id }
							: this.overlayTrackFor(p, span);
				const next = {
					...place.project,
					scenes,
					overlays: [...place.project.overlays, { ...overlay, trackId: place.trackId }]
				};
				return settle(next, overlay.id, newId);
			},
			{ select: overlay.id }
		);
		return overlay.id;
	}

	/** Turn an overlay into a full-frame scene at `index`. One undo step. */
	overlayToScene(overlayId: string, index: number): string | null {
		const o = this.project.overlays.find((x) => x.id === overlayId);
		if (!o || this.trackOfItem(overlayId)?.locked) return null;
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
				return { ...p, scenes, overlays: p.overlays.filter((x) => x.id !== overlayId) };
			},
			{ select: scene.id }
		);
		const placed = this.placed.find((p) => p.scene.id === scene.id);
		if (placed) this.seek(placed.start);
		return scene.id;
	}

	// ─── Animatable values (keyframes) ───────────────────────────────────────────────────────

	/** Easing for new keyframes (changeable in the settings, remembered on this device). */
	defaultEasing = $state<EasingPreset>(readDefaultEasing());

	/** An overlay's or words' values at timeline time `t` (default: the playhead). */
	itemValues(id: string, t = this.time): ItemValues | null {
		const o = this.project.overlays.find((x) => x.id === id);
		if (o) return itemValuesAt(overlayBaseValues(o), o.keyframes, t - o.start);
		const w = this.project.texts.find((x) => x.id === id);
		if (w) return itemValuesAt(textBaseValues(w), w.keyframes, t - w.start);
		return null;
	}

	/**
	 * Change an overlay's or words' position, scale, rotation or opacity at the playhead. Without
	 * keyframes this changes the item itself; with keyframes it adds a keyframe at the playhead
	 * with the values there (or updates the one already there), so only that moment changes.
	 */
	setItemValues(id: string, change: Partial<ItemValues>, key?: string, label = 'Change'): void {
		if (this.trackOfItem(id)?.locked || !this.itemValues(id)) return;
		const kfId = newId();
		this.edit(label, (p) => this.withItemValues(p, id, change, kfId), { key });
	}

	/** The same during a drag (a gesture: one undo step when it ends). */
	liveItemValues(id: string, change: Partial<ItemValues>, kfId: string): void {
		this.live((p) => {
			const next = this.withItemValues(p, id, change, kfId);
			p.overlays = next.overlays;
			p.texts = next.texts;
		});
	}

	private withItemValues(p: Project, id: string, change: Partial<ItemValues>, kfId: string): Project {
		const easing = EASINGS[this.defaultEasing];
		const t = this.time;
		const apply = <T extends { start: number; keyframes?: Keyframe<ItemValues>[] }>(
			item: T,
			now: ItemValues,
			statics: (v: ItemValues) => Partial<T>
		): T => {
			const v = { ...now, ...change };
			if (item.keyframes?.length)
				return { ...item, keyframes: upsertKeyframe(item.keyframes, t - item.start, v, () => kfId, easing) };
			return { ...item, ...statics(v) };
		};
		return {
			...p,
			overlays: p.overlays.map((o) =>
				o.id === id
					? apply(o, itemValuesAt(overlayBaseValues(o), o.keyframes, t - o.start), (v) => ({
							box: { ...o.box, x: v.x - o.box.w / 2, y: v.y - o.box.h / 2 },
							scaleX: v.scaleX,
							scaleY: v.scaleY,
							rotation: v.rotation,
							style: { ...o.style, opacity: v.opacity }
						}))
					: o
			),
			texts: p.texts.map((w) =>
				w.id === id
					? apply(w, itemValuesAt(textBaseValues(w), w.keyframes, t - w.start), (v) => ({
							x: v.x,
							y: v.y,
							scaleX: v.scaleX,
							scaleY: v.scaleY,
							rotation: v.rotation,
							opacity: v.opacity
						}))
					: w
			)
		};
	}

	/** A scene's Custom framing at timeline time `t` (default: the playhead), with its keyframes. */
	frameValues(sceneId: string, t = this.time): FrameValues | null {
		const placed = this.placed.find((p) => p.scene.id === sceneId);
		const f = placed?.scene.frame;
		if (!placed || !f) return null;
		const at = sceneFrameAt(f, placed.scene.keyframes, sceneContentTime(placed, t)) ?? f;
		return { x: at.x, y: at.y, zoom: at.zoom };
	}

	/**
	 * Change a scene's Custom framing at the playhead: the framing itself without keyframes, or a
	 * keyframe at the playhead (at the scene's content time) with them.
	 */
	setFrameValues(sceneId: string, change: Partial<FrameValues>, key?: string): void {
		if (!this.frameValues(sceneId)) return;
		const kfId = newId();
		this.edit('Framing', (p) => this.withFrameValues(p, sceneId, change, kfId), { key });
	}

	/** The same during a drag (a gesture: one undo step when it ends). */
	liveFrameValues(sceneId: string, change: Partial<FrameValues>, kfId: string): void {
		this.live((p) => {
			p.scenes = this.withFrameValues(p, sceneId, change, kfId).scenes;
		});
	}

	private withFrameValues(p: Project, sceneId: string, change: Partial<FrameValues>, kfId: string): Project {
		const placed = placeScenes(p.scenes).find((x) => x.scene.id === sceneId);
		const f = placed?.scene.frame;
		if (!placed || !f || f.mode !== 'custom') return p;
		const t = Math.min(placed.end, Math.max(placed.start, this.time));
		const time = sceneContentTime(placed, t);
		const now = sceneFrameAt(f, placed.scene.keyframes, time) ?? f;
		const values = { x: now.x, y: now.y, zoom: now.zoom, ...change };
		return {
			...p,
			scenes: p.scenes.map((s) =>
				s.id !== sceneId
					? s
					: s.keyframes?.length
						? { ...s, keyframes: upsertKeyframe(s.keyframes, time, values, () => kfId, EASINGS[this.defaultEasing]) }
						: { ...s, frame: { ...(s.frame ?? DEFAULT_FRAME), ...values } }
			)
		};
	}

	/**
	 * An item's keyframes, whatever it is (overlay, words, or a scene with Custom framing), with
	 * conversions between keyframe times and the timeline, and the part of the timeline where the
	 * item shows (keyframes outside it are kept but hidden).
	 */
	keyframeTrack(id: string, channel: KeyframeChannel = 'motion'): KeyframeTrack | null {
		if (channel === 'volume') return this.volumeTrack(id);
		const o = this.project.overlays.find((x) => x.id === id) ?? this.project.texts.find((x) => x.id === id);
		if (o) {
			return {
				kind: this.project.overlays.some((x) => x.id === id) ? 'overlay' : 'text',
				channel,
				list: o.keyframes ?? [],
				toTimeline: (time) => o.start + time,
				fromTimeline: (t) => t - o.start,
				start: o.start,
				end: o.start + o.duration
			};
		}
		const placed = this.placed.find((p) => p.scene.id === id);
		if (placed && placed.scene.frame?.mode === 'custom') {
			return {
				kind: 'scene',
				channel,
				list: placed.scene.keyframes ?? [],
				toTimeline: (time) => sceneKeyframeTimelineTime(placed, time),
				fromTimeline: (t) => sceneContentTime(placed, t),
				start: placed.start,
				end: placed.end
			};
		}
		return null;
	}

	/**
	 * An item's volume points (sounds, video layers with their sound on, video scenes with sound),
	 * on the same times as its other keyframes.
	 */
	volumeTrack(id: string): KeyframeTrack | null {
		const sound = this.project.sounds.find((x) => x.id === id);
		const o = this.project.overlays.find((x) => x.id === id && x.kind === 'video');
		const item = sound ?? o;
		if (item) {
			return {
				kind: sound ? 'sound' : 'overlay',
				channel: 'volume',
				list: item.volumePoints ?? [],
				toTimeline: (time) => item.start + time,
				fromTimeline: (t) => t - item.start,
				start: item.start,
				end: item.start + item.duration
			};
		}
		const placed = this.placed.find((p) => p.scene.id === id && p.scene.kind === 'video');
		if (placed) {
			return {
				kind: 'scene',
				channel: 'volume',
				list: placed.scene.volumePoints ?? [],
				toTimeline: (time) => sceneKeyframeTimelineTime(placed, time),
				fromTimeline: (t) => sceneContentTime(placed, t),
				start: placed.start,
				end: placed.end
			};
		}
		return null;
	}

	/** Change an item's keyframes (overlay, words or scene) as one undo step. */
	updateKeyframes(
		id: string,
		label: string,
		change: (list: Keyframe<AnyValues>[]) => Keyframe<AnyValues>[],
		key?: string,
		channel: KeyframeChannel = 'motion'
	): void {
		if (this.trackOfItem(id)?.locked) return;
		const tidy = <K>(list: K[]): K[] | undefined => (list.length ? list : undefined);
		if (channel === 'volume') {
			const v = <T extends { id: string; volumePoints?: Keyframe<VolumeValues>[] }>(x: T): T =>
				x.id === id ? { ...x, volumePoints: tidy(change(x.volumePoints ?? []) as Keyframe<VolumeValues>[]) } : x;
			this.edit(label, (p) => ({ ...p, sounds: p.sounds.map(v), overlays: p.overlays.map(v), scenes: p.scenes.map(v) }), { key });
			return;
		}
		this.edit(
			label,
			(p) => ({
				...p,
				overlays: p.overlays.map((o) =>
					o.id === id ? { ...o, keyframes: tidy(change(o.keyframes ?? []) as Keyframe<ItemValues>[]) } : o
				),
				texts: p.texts.map((t) =>
					t.id === id ? { ...t, keyframes: tidy(change(t.keyframes ?? []) as Keyframe<ItemValues>[]) } : t
				),
				scenes: p.scenes.map((s) =>
					s.id === id ? { ...s, keyframes: tidy(change(s.keyframes ?? []) as Keyframe<FrameValues>[]) } : s
				)
			}),
			{ key }
		);
	}

	/** The keyframe at the playhead on an item, if there is one. */
	keyframeAtPlayhead(id: string): Keyframe<AnyValues> | undefined {
		const track = this.keyframeTrack(id);
		return track ? keyframeAt(track.list, track.fromTimeline(this.time)) : undefined;
	}

	/**
	 * The diamond: add a keyframe at the playhead holding the item's values there, or, if the
	 * playhead is on one, remove it.
	 */
	toggleKeyframe(id: string): void {
		const track = this.keyframeTrack(id);
		if (!track) return;
		const at = this.keyframeAtPlayhead(id);
		if (at) {
			this.removeKeyframes(id, [at.id]);
			return;
		}
		if (this.time < track.start - 1e-6 || this.time > track.end + 1e-6) {
			toasts.show('Move the playhead onto it to add a keyframe there.');
			return;
		}
		const values = track.kind === 'scene' ? this.frameValues(id) : this.itemValues(id);
		if (!values) return;
		const time = track.fromTimeline(this.time);
		const easing = EASINGS[this.defaultEasing];
		this.updateKeyframes(id, 'Add keyframe', (list) => upsertKeyframe(list, time, { ...values }, newId, easing));
	}

	/**
	 * Remove keyframes. Removing the last one leaves the item as it is at the playhead (like
	 * "Remove all keyframes").
	 */
	removeKeyframes(id: string, keyframeIds: string[], channel: KeyframeChannel = 'motion'): void {
		const track = this.keyframeTrack(id, channel);
		if (!track) return;
		const gone = new Set(keyframeIds);
		if (channel === 'volume') {
			this.updateKeyframes(id, keyframeIds.length > 1 ? 'Remove volume points' : 'Remove volume point', (list) => list.filter((k) => !gone.has(k.id)), undefined, 'volume');
			return;
		}
		if (track.list.every((k) => gone.has(k.id))) {
			this.removeAllKeyframes(id, keyframeIds.length > 1 ? 'Remove keyframes' : 'Remove keyframe');
			return;
		}
		this.updateKeyframes(id, keyframeIds.length > 1 ? 'Remove keyframes' : 'Remove keyframe', (list) =>
			list.filter((k) => !gone.has(k.id))
		);
	}

	/** Remove every keyframe; the item keeps the values it has at the playhead. */
	removeAllKeyframes(id: string, label = 'Remove all keyframes'): void {
		if (this.trackOfItem(id)?.locked) return;
		const item = this.itemValues(id);
		const frame = this.frameValues(id);
		this.edit(label, (p) => ({
			...p,
			overlays: p.overlays.map((o) =>
				o.id === id && item
					? {
							...o,
							keyframes: undefined,
							box: { ...o.box, x: item.x - o.box.w / 2, y: item.y - o.box.h / 2 },
							scaleX: item.scaleX,
							scaleY: item.scaleY,
							rotation: item.rotation,
							style: { ...o.style, opacity: item.opacity }
						}
					: o
			),
			texts: p.texts.map((t) =>
				t.id === id && item
					? {
							...t,
							keyframes: undefined,
							x: item.x,
							y: item.y,
							scaleX: item.scaleX,
							scaleY: item.scaleY,
							rotation: item.rotation,
							opacity: item.opacity
						}
					: t
			),
			scenes: p.scenes.map((s) =>
				s.id === id && frame ? { ...s, keyframes: undefined, frame: { ...(s.frame ?? DEFAULT_FRAME), ...frame } } : s
			)
		}));
	}

	/** Move the playhead to the previous or next keyframe of an item (only ones that show). */
	seekKeyframe(id: string, direction: -1 | 1): void {
		const track = this.keyframeTrack(id);
		if (!track) return;
		const times = track.list
			.map((k) => track.toTimeline(k.time))
			.filter((t) => t >= track.start - 1e-6 && t <= track.end + 1e-6)
			.sort((a, b) => a - b);
		const next =
			direction > 0
				? times.find((t) => t > this.time + SAME_TIME / 2)
				: [...times].reverse().find((t) => t < this.time - SAME_TIME / 2);
		if (next !== undefined) this.seek(Math.min(next, Math.max(0, this.duration - 1e-3)));
	}

	/** Move a whole animation: every keyframe's position by (dx, dy) (fractions of the frame). */
	moveAnimation(id: string, dx: number, dy: number, key?: string): void {
		this.updateKeyframes(
			id,
			'Move animation',
			(list) =>
				list.map((k) => {
					const v = k.values as ItemValues;
					return { ...k, values: { ...v, x: v.x + dx, y: v.y + dy } };
				}),
			key
		);
	}

	/** The same during a drag of the motion path, from the keyframes as they were (`from`). */
	liveMoveAnimation(id: string, from: Keyframe<ItemValues>[], dx: number, dy: number): void {
		const moved = from.map((k) => ({ ...k, values: { ...k.values, x: k.values.x + dx, y: k.values.y + dy } }));
		this.live((p) => {
			const o = p.overlays.find((x) => x.id === id) ?? p.texts.find((x) => x.id === id);
			if (o) o.keyframes = moved;
		});
	}

	// ─── Keyframe selection (on the timeline) ─────────────────────────────────────────────

	/** Keyframes selected on the timeline (rather than items). */
	selectedKeyframes = $state<KeyframeRef[]>([]);
	/** While dragging selected keyframes: how far (timeline seconds), for every marker to show. */
	keyframeDragDelta = $state<number | null>(null);

	isKeyframeSelected(itemId: string, id: string): boolean {
		return this.selectedKeyframes.some((r) => r.itemId === itemId && r.id === id);
	}

	/** Select keyframes (the items they're on stay selected too). `additive` adds to the selection. */
	selectKeyframes(refs: KeyframeRef[], additive = false): void {
		const next = additive ? [...this.selectedKeyframes] : [];
		for (const r of refs) if (!next.some((x) => x.itemId === r.itemId && x.id === r.id)) next.push(r);
		this.selectedKeyframes = next;
	}

	toggleKeyframeSelected(ref: KeyframeRef): void {
		this.selectedKeyframes = this.isKeyframeSelected(ref.itemId, ref.id)
			? this.selectedKeyframes.filter((r) => !(r.itemId === ref.itemId && r.id === ref.id))
			: [...this.selectedKeyframes, ref];
	}

	clearKeyframeSelection(): void {
		if (this.selectedKeyframes.length) this.selectedKeyframes = [];
	}

	/** The selected keyframes grouped by item. */
	private keyframeGroups(refs = this.selectedKeyframes): { itemId: string; channel: KeyframeChannel; ids: string[] }[] {
		const groups = new Map<string, { itemId: string; channel: KeyframeChannel; ids: string[] }>();
		for (const r of refs) {
			const channel = r.channel ?? 'motion';
			const k = `${r.itemId}|${channel}`;
			const g = groups.get(k) ?? { itemId: r.itemId, channel, ids: [] };
			g.ids.push(r.id);
			groups.set(k, g);
		}
		return [...groups.values()];
	}

	/** Delete the selected keyframes (one undo step per item). */
	deleteSelectedKeyframes(): void {
		const groups = this.keyframeGroups();
		this.selectedKeyframes = [];
		for (const g of groups) this.removeKeyframes(g.itemId, g.ids, g.channel);
	}

	/** Give every selected keyframe an easing. */
	setSelectedKeyframesEasing(easing: Easing, key?: string): void {
		for (const g of this.keyframeGroups()) this.setKeyframeEasing(g.itemId, g.ids, easing, key, g.channel);
	}

	/**
	 * Move the selected keyframes by `delta` timeline seconds (scenes' keyframes by the matching
	 * stretch of their clip). A keyframe landing on another one replaces it.
	 */
	moveSelectedKeyframes(delta: number): void {
		if (Math.abs(delta) < 1e-6) return;
		for (const { itemId, ids, channel } of this.keyframeGroups()) {
			const track = this.keyframeTrack(itemId, channel);
			if (!track) continue;
			const moving = new Set(ids);
			this.updateKeyframes(itemId, ids.length > 1 ? 'Move keyframes' : 'Move keyframe', (list) => {
				const moved = list
					.filter((k) => moving.has(k.id))
					.map((k) => ({ ...k, time: track.fromTimeline(track.toTimeline(k.time) + delta) }));
				const staying = list.filter(
					(k) => !moving.has(k.id) && !moved.some((m) => Math.abs(m.time - k.time) < SAME_TIME)
				);
				return sortKeyframes([...staying, ...moved]);
			}, undefined, channel);
		}
	}

	/** Timeline times of every keyframe that shows (for snapping), except `except`. */
	keyframeTimes(except: KeyframeRef[] = []): number[] {
		const out: number[] = [];
		const ids = [
			...this.project.overlays.map((o) => o.id),
			...this.project.texts.map((t) => t.id),
			...this.project.scenes.map((s) => s.id)
		];
		const tracks = [...ids, ...this.project.sounds.map((x) => x.id)].flatMap((id) =>
			(['motion', 'volume'] as const).map((c) => ({ id, track: this.keyframeTrack(id, c) }))
		);
		for (const { id, track } of tracks) {
			if (!track) continue;
			for (const k of track.list) {
				if (except.some((r) => r.itemId === id && r.id === k.id)) continue;
				const t = track.toTimeline(k.time);
				if (t >= track.start - 1e-6 && t <= track.end + 1e-6) out.push(t);
			}
		}
		return out;
	}

	// ─── Copy and paste keyframes ──────────────────────────────────────────────────────────

	/** Keyframes copied (Ctrl/Cmd+C with keyframes selected): when, relative to the first. */
	private keyframeClipboard: {
		kind: 'item' | 'frame' | 'volume';
		keyframes: { offset: number; values: AnyValues; easing: Easing }[];
	} | null = null;

	/** Copy the selected keyframes (of one item: the first one's, if several are selected). */
	copyKeyframes(): boolean {
		const first = this.selectedKeyframes[0];
		if (!first) return false;
		const channel = first.channel ?? 'motion';
		const track = this.keyframeTrack(first.itemId, channel);
		if (!track) return false;
		const ids = new Set(
			this.selectedKeyframes.filter((r) => r.itemId === first.itemId && (r.channel ?? 'motion') === channel).map((r) => r.id)
		);
		const chosen = sortKeyframes(track.list.filter((k) => ids.has(k.id)));
		if (!chosen.length) return false;
		const t0 = track.toTimeline(chosen[0].time);
		this.keyframeClipboard = {
			kind: channel === 'volume' ? 'volume' : track.kind === 'scene' ? 'frame' : 'item',
			keyframes: chosen.map((k) => ({
				offset: track.toTimeline(k.time) - t0,
				values: structuredClone($state.snapshot(k.values)) as AnyValues,
				easing: structuredClone($state.snapshot(k.easing)) as Easing
			}))
		};
		return true;
	}

	/**
	 * Paste copied keyframes onto the selected item: the first at the playhead, the others keeping
	 * their spacing. Onto a different kind of item (words ↔ a layer share everything; a layer or
	 * words ↔ a scene's framing share position and size), only what both have is copied; the rest
	 * keeps the item's own values at that moment. The pasted keyframes end up selected.
	 */
	pasteKeyframes(): boolean {
		const clip = this.keyframeClipboard;
		const id = this.selectedId;
		if (clip?.kind === 'volume') return this.pasteVolumePoints();
		const track = id ? this.keyframeTrack(id) : null;
		if (!clip || !id || !track) {
			if (clip) toasts.show('Select a layer, words, or a scene with Custom framing to paste the keyframes on.');
			return false;
		}
		const target = track.kind === 'scene' ? 'frame' : 'item';
		const pasted: { time: number; values: AnyValues; easing: Easing; id: string }[] = [];
		for (const k of clip.keyframes) {
			const t = this.time + k.offset;
			const own = target === 'frame' ? this.frameValues(id, t) : this.itemValues(id, t);
			if (!own) continue;
			pasted.push({
				time: track.fromTimeline(t),
				values: convertValues(k.values as ItemValues | FrameValues, clip.kind as 'item' | 'frame', target, own),
				easing: k.easing,
				id: newId()
			});
		}
		if (!pasted.length) return false;
		this.updateKeyframes(id, pasted.length > 1 ? 'Paste keyframes' : 'Paste keyframe', (list) => {
			const staying = list.filter((k) => !pasted.some((p) => Math.abs(p.time - k.time) < SAME_TIME));
			return sortKeyframes([...staying, ...pasted.map((p) => ({ id: p.id, time: p.time, values: p.values, easing: { ...p.easing } }))]);
		});
		this.selectKeyframes(pasted.map((p) => ({ itemId: id, id: p.id })));
		return true;
	}

	/**
	 * Split the selected layer or words at the playhead into two that look exactly as one did:
	 * the keyframes are split so both halves keep the same motion (see splitKeyframeList), the
	 * entrance stays on the first half and the exit on the second.
	 */
	splitItemAtPlayhead(id = this.selectedId): boolean {
		if (!id || this.trackOfItem(id)?.locked) return false;
		const t = this.time;
		const o = this.project.overlays.find((x) => x.id === id);
		const w = this.project.texts.find((x) => x.id === id);
		const item = o ?? w;
		if (!item) return false;
		const local = t - item.start;
		if (local < 0.1 || item.duration - local < 0.1) {
			toasts.show('Move the playhead into it to split it there.');
			return false;
		}
		const secondId = newId();
		if (o) {
			const [left, right] = splitKeyframeList(o.keyframes, local, overlayBaseValues(o), newId);
			const [vLeft, vRight] = splitKeyframeList(o.volumePoints, local, { gain: 1 }, newId);
			this.edit(
				'Split layer',
				(p) => ({
					...p,
					overlays: p.overlays.flatMap((x) =>
						x.id !== id
							? [x]
							: [
									{ ...x, duration: local, exit: 'none' as const, keyframes: left, volumePoints: vLeft },
									{
										...structuredClone($state.snapshot(x) as Overlay),
										id: secondId,
										start: t,
										duration: x.duration - local,
										sourceStart: x.sourceStart + (x.kind === 'video' ? local : 0),
										enter: 'none' as const,
										keyframes: right,
										volumePoints: vRight
									}
								]
					)
				}),
				{ select: secondId }
			);
		} else if (w) {
			const [left, right] = splitKeyframeList(w.keyframes, local, textBaseValues(w), newId);
			this.edit(
				'Split words',
				(p) => ({
					...p,
					texts: p.texts.flatMap((x) =>
						x.id !== id
							? [x]
							: [
									// No fade out at the split: the words carry on in the second half.
									{ ...x, duration: local, exitFade: false, keyframes: left },
									{ ...structuredClone($state.snapshot(x) as TextItem), id: secondId, start: t, duration: x.duration - local, animation: 'none' as const, keyframes: right }
								]
					)
				}),
				{ select: secondId }
			);
		}
		return true;
	}

	/** Paste copied volume points onto the selected sound (or video), first at the playhead. */
	private pasteVolumePoints(): boolean {
		const clip = this.keyframeClipboard;
		const id = this.selectedId;
		const track = id ? this.volumeTrack(id) : null;
		if (!clip || !id || !track) {
			toasts.show('Select a sound, or a video with sound, to paste the volume points on.');
			return false;
		}
		const pasted = clip.keyframes.map((k) => ({
			id: newId(),
			time: track.fromTimeline(this.time + k.offset),
			values: { ...(k.values as VolumeValues) },
			easing: { ...k.easing }
		}));
		this.updateKeyframes(
			id,
			pasted.length > 1 ? 'Paste volume points' : 'Paste volume point',
			(list) => sortKeyframes([...list.filter((k) => !pasted.some((p) => Math.abs(p.time - k.time) < SAME_TIME)), ...pasted]),
			undefined,
			'volume'
		);
		this.selectKeyframes(pasted.map((p) => ({ itemId: id, id: p.id, channel: 'volume' as const })));
		return true;
	}

	/** Add a volume point on an item at timeline time `t` with `gain`; returns its id. */
	addVolumePoint(id: string, t: number, gain: number): string | null {
		const track = this.volumeTrack(id);
		if (!track) return null;
		const pointId = newId();
		const time = track.fromTimeline(t);
		const preset = VOLUME_EASINGS.includes(this.defaultEasing) ? this.defaultEasing : 'linear';
		this.updateKeyframes(
			id,
			'Add volume point',
			(list) => sortKeyframes([...list.filter((k) => Math.abs(k.time - time) >= SAME_TIME), volumePoint(pointId, time, gain, preset)]),
			undefined,
			'volume'
		);
		return pointId;
	}

	/** Change a volume point's time and gain (as during a drag: `key` merges the steps). */
	setVolumePoint(id: string, pointId: string, t: number, gain: number, key?: string): void {
		const track = this.volumeTrack(id);
		if (!track) return;
		const time = track.fromTimeline(t);
		this.updateKeyframes(
			id,
			'Volume',
			(list) => sortKeyframes(list.map((k) => (k.id === pointId ? { ...k, time, values: { gain } } : k))),
			key,
			'volume'
		);
	}

	/** An item's volume (its points' gain) at timeline time `t`. */
	volumeAtTime(id: string, t: number): number {
		const track = this.volumeTrack(id);
		return track ? volumeAt(track.list as Keyframe<VolumeValues>[], track.fromTimeline(t)) : 1;
	}

	/** Give keyframes (the stretches that start at them) an easing. */
	setKeyframeEasing(id: string, keyframeIds: string[], easing: Easing, key?: string, channel: KeyframeChannel = 'motion'): void {
		const ids = new Set(keyframeIds);
		this.updateKeyframes(id, 'Easing', (list) => list.map((k) => (ids.has(k.id) ? { ...k, easing: { ...easing } } : k)), key, channel);
	}

	/** The easing new keyframes get (remembered on this device). */
	setDefaultEasing(preset: EasingPreset): void {
		this.defaultEasing = preset;
		try {
			localStorage.setItem(EASING_KEY, preset);
		} catch {
			// Storage blocked: it just isn't remembered.
		}
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

	/**
	 * Move an item to the next track up (drawn over more) or down (drawn under more), if that's a
	 * track of the same kind. If it overlaps something there, a new track is made between.
	 */
	moveItemTrack(id: string, direction: 1 | -1): void {
		const kind = itemKind(this.project, id);
		const track = this.trackOfItem(id);
		const item = getItem(this.project, id);
		if (!kind || !track || !item || track.locked) return;
		const tracks = this.project.tracks;
		const index = tracks.findIndex((t) => t.id === track.id);
		const next = tracks[index - direction];
		const sameKind = (t?: Track) => !!t && t.kind === track.kind;
		const span = { start: item.start, duration: item.duration };
		if (sameKind(next) && fits(allItems(this.project), next!.id, span)) {
			this.moveItems([id], 0, next!.id, direction > 0 ? 'Bring forward' : 'Send back');
			return;
		}
		// Something's in the way on that track: a new track beyond it, so it really ends up over
		// (or under) it. No track there at all: a new track right next to its own.
		const at = sameKind(next)
			? direction > 0
				? index - 1
				: index + 2
			: direction > 0
				? index
				: index + 1;
		this.moveItemToNewTrack(id, item.start, at);
	}

	deleteOverlay(id: string): void {
		if (this.trackOfItem(id)?.locked) return;
		this.edit('Remove layer', (p) => ({ ...p, overlays: p.overlays.filter((o) => o.id !== id) }), {
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
			// The first song starts with the video; more songs start at the playhead. Each goes on
			// the first audio track where it fits (a new track if none has room).
			const start = this.project.sounds.length ? Math.min(this.time, Math.max(0, this.duration - MIN_SOUND)) : 0;
			const duration = info.duration - info.startTime;
			const sound: Omit<SoundItem, 'trackId'> = {
				id: newId(),
				mediaId: info.id,
				name: file.name.replace(/\.[^.]+$/, '') || 'Music',
				start,
				sourceStart: info.startTime,
				duration,
				volume: 0.6,
				kind: 'music',
				fadeIn: MUSIC_FADE_IN,
				fadeOut: MUSIC_FADE_OUT
			};
			this.edit(
				'Add music',
				(p) => {
					const place = this.audioTrackFor(p, { start, duration });
					return { ...place.project, sounds: [...place.project.sounds, { ...sound, trackId: place.trackId }] };
				},
				{ select: sound.id }
			);
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
	 * Place a sound clip: its timing (start, part of the file) and, optionally, another audio
	 * track. If it overlaps a clip there, it goes on a new track just above. One undo step (`key`
	 * merges quick repeats).
	 */
	setSoundTiming(
		id: string,
		timing: Pick<SoundItem, 'start' | 'sourceStart' | 'duration'>,
		trackId?: string,
		label = 'Sound timing',
		key?: string
	): void {
		const sound = this.project.sounds.find((x) => x.id === id);
		if (!sound || this.trackOfItem(id)?.locked) return;
		const target = trackId ? this.track(trackId) : undefined;
		const onto = target?.kind === 'audio' && !target.locked ? target.id : sound.trackId;
		const next = {
			start: Math.max(0, timing.start),
			sourceStart: timing.sourceStart,
			duration: timing.duration,
			trackId: onto
		};
		this.edit(
			label,
			(p) => settle({ ...p, sounds: p.sounds.map((x) => (x.id === id ? retimed(x, next) : x)) }, id, newId),
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
		// The volume line stays exactly as it was across the split.
		const [left, right] = splitKeyframeList(sound.volumePoints, this.player.time - sound.start, { gain: 1 }, newId);
		parts[0] = { ...parts[0], volumePoints: left };
		parts[1] = { ...parts[1], volumePoints: right };
		this.edit(
			'Split sound',
			(p) => ({ ...p, sounds: p.sounds.flatMap((x) => (x.id === sound.id ? parts : [x])) }),
			{ select: parts[1].id }
		);
	}

	deleteSound(id: string): void {
		if (this.trackOfItem(id)?.locked) return;
		this.edit('Remove sound', (p) => ({ ...p, sounds: p.sounds.filter((s) => s.id !== id) }), {
			select: this.selectedId === id ? null : this.selectedId
		});
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

	// ─── Range (I / O) ──────────────────────────────────────────────────────────────────────

	/** Shortest range (seconds). */
	static readonly MIN_RANGE = 1 / 30;

	/** Set the range (kept within the video, start before end); null clears it. Saved and undoable. */
	setRange(range: { start: number; end: number } | null, key?: string, label = 'Range'): void {
		const d = this.duration;
		let next: { start: number; end: number } | null = null;
		if (range && d > 0) {
			const start = Math.max(0, Math.min(d - EditorStore.MIN_RANGE, range.start));
			const end = Math.max(start + EditorStore.MIN_RANGE, Math.min(d, range.end));
			next = { start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
		}
		if (JSON.stringify(next) === JSON.stringify(this.project.range ?? null)) return;
		this.edit(label, (p) => ({ ...p, range: next }), { key });
	}

	/** I: the range starts at the playhead (it ends where it did, or at the end of the video). */
	setRangeStart(): void {
		const r = this.project.range;
		const start = this.time;
		this.setRange({ start, end: r && r.end > start + EditorStore.MIN_RANGE ? r.end : this.duration }, undefined, 'Range start');
	}

	/** O: the range ends at the playhead (it starts where it did, or at the start of the video). */
	setRangeEnd(): void {
		const r = this.project.range;
		const end = this.time;
		this.setRange({ start: r && r.start < end - EditorStore.MIN_RANGE ? r.start : 0, end }, undefined, 'Range end');
	}

	clearRange(): void {
		this.setRange(null, undefined, 'Clear range');
	}

	/** The range from the start of the selected items (or scene) to the end of the last one. */
	setRangeToSelection(): boolean {
		const spans: { start: number; end: number }[] = [];
		for (const id of this.selectedIds) {
			const scene = this.placed.find((p) => p.scene.id === id);
			if (scene) spans.push({ start: scene.start, end: scene.end });
			const item = getItem(this.project, id);
			if (item) spans.push({ start: item.start, end: item.start + item.duration });
		}
		if (!spans.length) {
			toasts.show('Select a scene or items first, then set the range to them.');
			return false;
		}
		this.setRange(
			{ start: Math.min(...spans.map((x) => x.start)), end: Math.max(...spans.map((x) => x.end)) },
			undefined,
			'Range to selection'
		);
		return true;
	}

	// ─── Save video ─────────────────────────────────────────────────────────────────────────

	/** Render and encode the video. The dialog shows progress and can cancel with `signal`. */
	async saveVideo(
		presetId: PresetId,
		onProgress: (p: ExportProgress) => void,
		signal: AbortSignal,
		range?: ExportRange | null
	): Promise<ExportResult> {
		this.player.pause();
		const media = this.media;
		return exportVideo({
			project: this.snapshot(),
			range,
			preset: presetById(presetId),
			bounds: (scene) => this.bounds(scene),
			sourceSize: (id) => (media[id] ? { width: media[id].width, height: media[id].height } : null),
			hasAudio: (id) => !!media[id]?.hasAudio,
			onProgress,
			signal
		});
	}

	/** Just the sound (the same mix as the video), as WAV, M4A or MP3. */
	async saveAudio(
		format: AudioFormat,
		bitrate: number,
		onProgress: (p: ExportProgress) => void,
		signal: AbortSignal,
		range?: ExportRange | null
	): Promise<ExportResult> {
		this.player.pause();
		const media = this.media;
		return exportAudio({
			project: this.snapshot(),
			format,
			bitrate,
			range,
			hasAudio: (id) => !!media[id]?.hasAudio,
			onProgress,
			signal
		});
	}

	/** The frame at the playhead as a PNG or JPG, at the project's size (like the video export). */
	async saveFrame(format: FrameFormat, quality = 0.9, time = this.time): Promise<ExportResult> {
		this.player.pause();
		const media = this.media;
		return exportFrame({
			project: this.snapshot(),
			time,
			format,
			quality,
			bounds: (scene) => this.bounds(scene),
			sourceSize: (id) => (media[id] ? { width: media[id].width, height: media[id].height } : null)
		});
	}

	/** Save the frame at the playhead straight away (F, or the preview's menu) and download it. */
	async downloadFrame(format: FrameFormat = 'png', quality = 0.9): Promise<void> {
		try {
			const result = await this.saveFrame(format, quality);
			const url = URL.createObjectURL(result.file);
			const a = document.createElement('a');
			a.href = url;
			a.download = result.name;
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			toasts.show(`Saved ${result.name}`);
		} catch (error) {
			console.error(error);
			toasts.show(error instanceof Error ? error.message : 'Couldn’t save the frame.', 'error');
		}
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
			const sound: Omit<SoundItem, 'trackId'> = {
				id: newId(),
				mediaId: info.id,
				name,
				start: state.start,
				sourceStart: info.startTime,
				duration: Math.max(0.3, info.duration - info.startTime),
				volume: 1,
				kind: 'voice',
				fadeIn: 0,
				fadeOut: 0
			};
			this.edit(
				'Record voiceover',
				(p) => {
					const place = this.audioTrackFor(p, sound);
					return { ...place.project, sounds: [...place.project.sounds, { ...sound, trackId: place.trackId }] };
				},
				{ select: sound.id }
			);
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
		// The "Text" track, unless it's hidden or locked (then a new one, so the words can be seen
		// and typed).
		const trackId =
			this.project.tracks.find((t) => t.kind === 'overlay' && t.name === TEXT_TRACK_NAME && !t.hidden && !t.locked)
				?.id ?? newId();
		const item: TextItem = clampTextTiming(
			{
				id: newId(),
				trackId,
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
			(p) => {
				// On the "Text" track (made at the top if there isn't one); a new track just above it
				// if it would overlap other words there.
				const withTrack = p.tracks.some((t) => t.id === trackId)
					? p
					: addTrack(p, 'overlay', 0, trackId, TEXT_TRACK_NAME);
				return settle({ ...withTrack, texts: [...withTrack.texts, item] }, item.id, newId);
			},
			{
				select: item.id
			}
		);
		this.seek(item.start + Math.min(TEXT_ENTER, item.duration / 2));
		this.startEditingText(item.id);
	}

	private updateText(label: string, id: string, fn: (t: TextItem) => TextItem, key?: string): void {
		if (!this.project.texts.some((t) => t.id === id) || this.trackOfItem(id)?.locked) return;
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

	/** Move words (at the playhead, when they have keyframes). */
	setTextPosition(id: string, x: number, y: number): void {
		this.setItemValues(id, { x, y }, `pos:${id}`, 'Move words');
	}

	/** Whether an item's width and height scale together. */
	setScaleLinked(id: string, linked: boolean): void {
		if (this.project.overlays.some((o) => o.id === id))
			this.updateOverlay('Link scale', id, (o) => ({ ...o, scaleLinked: linked }));
		else this.updateText('Link scale', id, (t) => ({ ...t, scaleLinked: linked }));
	}

	setTextTiming(id: string, start: number, duration: number): void {
		if (this.trackOfItem(id)?.locked) return;
		const d = this.duration;
		this.edit(
			'Timing',
			(p) =>
				settle(
					{ ...p, texts: p.texts.map((t) => (t.id === id ? retimed(t, clampTextTiming({ ...t, start, duration }, d)) : t)) },
					id,
					newId
				),
			{ key: `timing:${id}` }
		);
	}

	/** Move one edge of a text's timing (used by the Words lane). */
	resizeTextTiming(item: TextItem, edge: 'start' | 'end', delta: number): TextItem {
		return resizeText(item, edge, delta, this.duration);
	}

	deleteText(id: string): void {
		if (this.trackOfItem(id)?.locked) return;
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
	async importAsOverlays(files: File[], start: number, trackId?: string): Promise<void> {
		if (files.length === 0) return;
		await this.load();
		if (this.project.scenes.length === 0) return this.importFiles(files);
		this.importing += files.length;
		try {
			for (const file of files) {
				const info = await this.storeVisual(file);
				this.importing--;
				if (info) this.addOverlayFromMedia(info.id, start, trackId);
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
			// Items on the other tracks follow (ripple, the end of the video) once it's all in.
			const after = { ...this.reconcile(before, this.snapshot()), updatedAt: Date.now() };
			this.history.record(added > 1 ? 'Add scenes' : 'Add scene', before, after);
			this.project = after;
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
