import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { getProject } from '$lib/media/db';
import { FILE_EXTENSION, ProjectFileError } from './format';
import { pickProjectFile } from './save';
import { storeOpenedFile, type OpenMode } from './store';
import { readProjectFile } from './zip';

type Choice = 'replace' | 'copy' | 'cancel';

/**
 * Opening a project file, from the home screen or the editor (Open button, Ctrl/Cmd+O, or a
 * dropped file): check it, ask what to do if the project is already in the app, store it with
 * progress, then open it. The dialogs for this are in ProjectFileDialogs, shown on every page.
 */
class ProjectOpener {
	/** While storing: the file's name and 0–1. */
	progress = $state<{ name: string; fraction: number } | null>(null);
	/** The project is already in the app: replace it, or keep both? */
	conflict = $state<{ title: string; answer: (choice: Choice) => void } | null>(null);
	/** Why the last file couldn't be opened. */
	error = $state<{ name: string; message: string } | null>(null);

	/** Called before a project in the app is replaced, e.g. so an open editor stops saving it. */
	beforeReplace: ((projectId: string) => void) | null = null;

	get busy() {
		return !!this.progress || !!this.conflict;
	}

	async pickAndOpen(): Promise<void> {
		if (this.busy) return;
		let picked: Awaited<ReturnType<typeof pickProjectFile>>;
		try {
			picked = await pickProjectFile();
		} catch {
			picked = null;
		}
		if (picked) await this.open(picked.file, picked.handle);
	}

	/**
	 * Open a project file as a new project of the user's, always (the file itself is never
	 * linked or changed): the demo on the home screen.
	 */
	async openCopy(file: File, options: { title?: string; thumbnail?: Blob } = {}): Promise<void> {
		if (this.busy) return;
		this.error = null;
		this.progress = { name: file.name, fraction: 0 };
		let opened: Awaited<ReturnType<typeof readProjectFile>> | null = null;
		try {
			opened = await readProjectFile(file);
			const stored = await storeOpenedFile(opened, {
				mode: 'copy',
				fileName: file.name,
				...options,
				onProgress: (fraction) => {
					if (this.progress) this.progress.fraction = fraction;
				}
			});
			await goto(resolve('/edit/[id]', { id: stored }));
		} catch (error) {
			console.error('Could not open the project file', error);
			this.error = {
				name: file.name,
				message:
					error instanceof ProjectFileError
						? error.message
						: 'Something went wrong while opening this file. Please try again.'
			};
		} finally {
			this.progress = null;
			await opened?.close().catch(() => {});
		}
	}

	async open(file: File, handle?: FileSystemFileHandle): Promise<void> {
		if (this.busy) return;
		this.error = null;
		this.progress = { name: file.name, fraction: 0 };
		let opened: Awaited<ReturnType<typeof readProjectFile>> | null = null;
		try {
			opened = await readProjectFile(file);
			const id = opened.data.project.id;
			let mode: OpenMode = 'new';
			if (await getProject(id)) {
				const choice = await new Promise<Choice>((answer) => {
					this.conflict = { title: opened!.data.project.title, answer };
				});
				this.conflict = null;
				if (choice === 'cancel') return;
				mode = choice;
				if (mode === 'replace') this.beforeReplace?.(id);
			}
			const stored = await storeOpenedFile(opened, {
				mode,
				fileName: file.name,
				handle,
				onProgress: (fraction) => {
					if (this.progress) this.progress.fraction = fraction;
				}
			});
			// A fresh editor for it (even if the same project was open).
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- the path is resolve()d; only a query is added
			await goto(`${resolve('/edit/[id]', { id: stored })}?opened=${Date.now()}`);
		} catch (error) {
			console.error('Could not open the project file', error);
			this.error = {
				name: file.name,
				message:
					error instanceof ProjectFileError
						? error.message
						: 'Something went wrong while opening this file. Please try again.'
			};
		} finally {
			this.conflict = null;
			this.progress = null;
			await opened?.close().catch(() => {});
		}
	}
}

export const projectOpener = new ProjectOpener();

/** Project files among dropped or chosen files. */
export const isProjectFile = (file: File) => file.name.toLowerCase().endsWith(FILE_EXTENSION);

/**
 * Handles for dropped files, where the browser offers them (Chrome, Edge), so saving can go back
 * to the same file. Must be called during the drop event.
 */
export function droppedHandles(event: DragEvent): Promise<(FileSystemFileHandle | null)[]> {
	const items = Array.from(event.dataTransfer?.items ?? []).filter((i) => i.kind === 'file');
	return Promise.all(
		items.map((item) => {
			const get = (item as unknown as { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
				.getAsFileSystemHandle;
			if (!get) return Promise.resolve(null);
			return get
				.call(item)
				.then((h) => (h && h.kind === 'file' ? (h as FileSystemFileHandle) : null))
				.catch(() => null);
		})
	);
}
