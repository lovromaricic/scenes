import {
	deleteUnusedMedia,
	getMediaInfos,
	getThumbnail,
	getWaveform,
	putWaveform,
	loadLatestProject,
	saveProject,
	putMedia,
	putThumbnail,
	requestPersistentStorage,
	type MediaInfo,
	type ProjectRecord
} from '$lib/media/db';
import { getHandle, registerBlob } from '$lib/media/handles';
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
import { placeScenes, totalDuration } from '$lib/model/timeline';
import { TEXT_ENTER } from '$lib/model/textAnimation';
import type {
	AspectRatio,
	MoodId,
	Project,
	Scene,
	SoundItem,
	Speed,
	TextAnimation,
	TextItem,
	TextStyleId
} from '$lib/model/types';
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

	constructor() {
		this.player.on({
			time: (t) => (this.time = t),
			playing: (p) => (this.playing = p)
		});
	}

	// ─── Loading and saving ──────────────────────────────────────────────────────────────────

	/** Restore the most recent project from this device. */
	load(): Promise<void> {
		this.loaded ??= this.restoreSaved();
		return this.loaded;
	}

	private async restoreSaved(): Promise<void> {
		try {
			let record = await loadLatestProject();
			// A copy written while the page was closing may be newer than the last database save.
			const copy = emergencyCopy.read();
			if (copy && (!record || (copy.savedAt ?? 0) > (record.savedAt ?? 0))) {
				record = copy;
				await saveProject(copy);
				emergencyCopy.clearIfSaved(copy.savedAt ?? 0);
			}
			// Never replace work the user has already started in this session.
			if (record && !this.history.canUndo) {
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
				void this.loadWaveforms(project.sounds.map((s) => s.mediaId));
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
		if (id !== this.editingTextId) this.stopEditingText();
		this.selectedId = id;
		// Selecting something shows it: jump there unless the playhead is already inside it.
		const placed = this.placed.find((p) => p.scene.id === id);
		if (placed && !(this.time >= placed.start && this.time < placed.end)) this.seek(placed.start);
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
		if (!id) return;
		if (this.project.scenes.some((s) => s.id === id)) this.deleteScene(id);
		else if (this.project.texts.some((t) => t.id === id)) this.deleteText(id);
		else if (this.project.sounds.some((s) => s.id === id)) this.deleteSound(id);
	}

	// ─── Sound ──────────────────────────────────────────────────────────────────────────────

	/** Store an audio file, its waveform, and return its info. */
	private async storeAudio(file: File): Promise<MediaInfo> {
		const { info: probed } = await probeFile(file);
		if (probed.kind !== 'audio') {
			throw new MediaImportError(`“${file.name}” isn’t a sound file. Try an MP3, M4A or WAV.`);
		}
		const info: MediaInfo = { ...probed, id: newId(), createdAt: Date.now() };
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
			const sound: SoundItem = {
				id: newId(),
				mediaId: info.id,
				name: file.name.replace(/\.[^.]+$/, '') || 'Music',
				start: 0,
				sourceStart: info.startTime,
				duration: info.duration - info.startTime,
				volume: 0.6,
				kind: 'music',
				fade: true
			};
			const replaced = this.project.sounds.some((s) => s.kind === 'music');
			this.edit(
				'Add music',
				(p) => ({ ...p, sounds: [...p.sounds.filter((s) => s.kind !== 'music'), sound] }),
				{ select: sound.id }
			);
			if (replaced) toasts.show('Replaced the music. Undo to get the old song back.');
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

	setSoundFade(id: string, fade: boolean): void {
		this.updateSound(fade ? 'Fade on' : 'Fade off', id, (s) => ({ ...s, fade }));
	}

	/** Start the song further in (skip an intro). `offset` is seconds into the file. */
	setMusicOffset(id: string, offset: number): void {
		const sound = this.project.sounds.find((s) => s.id === id);
		const info = sound && this.media[sound.mediaId];
		if (!sound || !info) return;
		const sourceStart = Math.min(
			Math.max(info.startTime, info.startTime + offset),
			info.duration - 1
		);
		this.updateSound(
			'Song start',
			id,
			(s) => ({ ...s, sourceStart, duration: info.duration - sourceStart }),
			`song-start:${id}`
		);
	}

	deleteSound(id: string): void {
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
				fade: false
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

	setTextStyle(id: string, style: TextStyleId): void {
		this.updateText('Text style', id, (t) => ({ ...t, style }));
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
		// Let the last project finish restoring first, so the new scenes join it.
		await this.load();
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
