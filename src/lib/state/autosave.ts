import { saveProject, type ProjectRecord } from '$lib/media/db';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const EMERGENCY_KEY = 'scenes:unsaved-project';

/**
 * A synchronous copy of the project in localStorage, written when the page is being hidden or
 * closed. IndexedDB writes are asynchronous and may not finish before the page unloads; this
 * copy always does. It is small (no media) and is removed once IndexedDB has caught up.
 */
export const emergencyCopy = {
	write(record: ProjectRecord): void {
		try {
			localStorage.setItem(EMERGENCY_KEY, JSON.stringify(record));
		} catch {
			// Storage full or blocked: IndexedDB is still the main copy.
		}
	},
	read(): ProjectRecord | null {
		try {
			const raw = localStorage.getItem(EMERGENCY_KEY);
			return raw ? (JSON.parse(raw) as ProjectRecord) : null;
		} catch {
			return null;
		}
	},
	/** Remove the copy if IndexedDB now has something at least as new. */
	clearIfSaved(savedAt: number): void {
		try {
			const copy = emergencyCopy.read();
			if (copy && (copy.savedAt ?? 0) <= savedAt) localStorage.removeItem(EMERGENCY_KEY);
		} catch {
			// Ignore.
		}
	}
};

/**
 * Saves the project to IndexedDB shortly after every change (within `delayMs`, even during a burst of
 * edits), and immediately when the page is hidden or closed. Saves never overlap; the newest
 * snapshot always wins.
 */
export class Autosaver {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private pending: ProjectRecord | null = null;
	private inFlight: Promise<void> | null = null;

	constructor(
		private readonly onStatus: (status: SaveStatus) => void,
		private readonly delayMs = 300,
		private readonly save: (record: ProjectRecord) => Promise<void> = saveProject
	) {}

	schedule(record: ProjectRecord): void {
		this.pending = record;
		// Save at most `delayMs` after the first unsaved change, even while changes keep coming.
		this.timer ??= setTimeout(() => void this.flush(), this.delayMs);
	}

	/** Save now if anything is waiting. Resolves when everything scheduled so far is stored. */
	async flush(): Promise<void> {
		clearTimeout(this.timer);
		this.timer = undefined;
		if (this.inFlight) await this.inFlight;
		const record = this.pending;
		if (!record) return;
		this.pending = null;
		this.onStatus('saving');
		this.inFlight = this.save(record)
			.then(() => {
				emergencyCopy.clearIfSaved(record.savedAt ?? 0);
				this.onStatus(this.pending ? 'saving' : 'saved');
			})
			.catch((error) => {
				console.error('Autosave failed', error);
				this.pending ??= record;
				this.onStatus('error');
			})
			.finally(() => (this.inFlight = null));
		await this.inFlight;
	}
}
