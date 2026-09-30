import {
	putMedia,
	putThumbnail,
	getThumbnail,
	requestPersistentStorage,
	type MediaInfo
} from '$lib/media/db';
import { registerBlob } from '$lib/media/handles';
import { MediaImportError, probeFile } from '$lib/media/probe';
import { placeScenes, totalDuration } from '$lib/model/timeline';
import type { Project } from '$lib/model/types';
import { Player } from '$lib/playback/player';
import { newId, newProject, sceneFromMedia } from './project';
import { toasts } from './toasts.svelte';

/**
 * The editor's reactive state: the project being edited, what is selected, and a live view of
 * the player's time. Components read from here; the player runs outside Svelte and reports back.
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

	readonly player = new Player();

	duration = $derived(totalDuration(this.project.scenes));
	placed = $derived(placeScenes(this.project.scenes));

	constructor() {
		this.player.on({
			time: (t) => (this.time = t),
			playing: (p) => (this.playing = p)
		});
	}

	/** Push the current project to the player. Call after every change. */
	syncPlayer(): void {
		const media = this.media;
		this.player.setProject($state.snapshot(this.project) as Project, (id) => !!media[id]?.hasAudio);
	}

	togglePlay(): void {
		this.player.unlockAudio();
		this.player.toggle();
	}

	seek(t: number): void {
		this.player.seek(t);
	}

	select(id: string | null): void {
		this.selectedId = id;
	}

	/** Add photos and videos as scenes at the end, in the order given. */
	async importFiles(files: File[]): Promise<void> {
		if (files.length === 0) return;
		void requestPersistentStorage();
		this.importing += files.length;
		let added = 0;
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
				this.project.updatedAt = Date.now();
				this.selectedId = scene.id;
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
			this.syncPlayer();
		}
		if (added > 1) toasts.show(`Added ${added} scenes`);
	}

	/** Load thumbnails for media that are already stored (after a reload). */
	async loadThumbnails(ids: string[]): Promise<void> {
		for (const id of ids) {
			if (this.thumbnails[id]) continue;
			const blob = await getThumbnail(id);
			if (blob) this.thumbnails[id] = URL.createObjectURL(blob);
		}
	}
}
