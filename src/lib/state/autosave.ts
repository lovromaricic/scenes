import { saveProject, type ProjectRecord } from '$lib/media/db';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const EMERGENCY_PREFIX = 'scenes:unsaved-project:';

/**
 * A synchronous copy of the project in localStorage, written when the page is being hidden or
 * closed. IndexedDB writes are asynchronous and may not finish before the page unloads; this
 * copy always does. It is small (no media) and is removed once IndexedDB has caught up.
 */
export const emergencyCopy = {
	write(record: ProjectRecord): void {
		try {
			localStorage.setItem(EMERGENCY_PREFIX + record.id, JSON.stringify(record));
		} catch {
			// Storage full or blocked: IndexedDB is still the main copy.
		}
	},
	read(projectId: string): ProjectRecord | null {
		try {
			const raw = localStorage.getItem(EMERGENCY_PREFIX + projectId);
			return raw ? (JSON.parse(raw) as ProjectRecord) : null;
		} catch {
			return null;
		}
	},
	remove(projectId: string): void {
		try {
			localStorage.removeItem(EMERGENCY_PREFIX + projectId);
		} catch {
			// Ignore.
		}
	},
	/** Projects that have a copy waiting (after a crash or a closed tab). */
	ids(): string[] {
		try {
			return Object.keys(localStorage)
				.filter((k) => k.startsWith(EMERGENCY_PREFIX))
				.map((k) => k.slice(EMERGENCY_PREFIX.length));
		} catch {
			return [];
		}
	},
	/** Remove the copy if IndexedDB now has something at least as new. */
	clearIfSaved(projectId: string, savedAt: number): void {
		try {
			const copy = emergencyCopy.read(projectId);
			if (copy && (copy.savedAt ?? 0) <= savedAt) localStorage.removeItem(EMERGENCY_PREFIX + projectId);
		} catch {
			// Ignore.
		}
	}
};

/**
 * Saves the project to IndexedDB shortly after changes stop (`delayMs` after the last one, so a
 * burst of typing is one save), but never more than `maxWaitMs` after the first unsaved change
 * (so a long burst still gets saved), and immediately when the page is hidden or closed. Saves
 * never overlap; the newest snapshot always wins.
 */
export class Autosaver {
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** When the oldest unsaved change was made. */
	private firstAt: number | null = null;
	private pending: ProjectRecord | null = null;
	private inFlight: Promise<void> | null = null;

	constructor(
		private readonly onStatus: (status: SaveStatus) => void,
		private readonly delayMs = 500,
		private readonly save: (record: ProjectRecord) => Promise<void> = saveProject,
		private readonly maxWaitMs = 2000
	) {}

	schedule(record: ProjectRecord): void {
		this.pending = record;
		const now = Date.now();
		this.firstAt ??= now;
		clearTimeout(this.timer);
		const wait = Math.max(0, Math.min(this.delayMs, this.firstAt + this.maxWaitMs - now));
		this.timer = setTimeout(() => void this.flush(), wait);
	}

	/**
	 * Drop whatever is waiting to be saved: nothing more is written. Resolves once a save that
	 * had already started has finished (so nothing lands after whatever comes next).
	 */
	async cancel(): Promise<void> {
		clearTimeout(this.timer);
		this.timer = undefined;
		this.firstAt = null;
		this.pending = null;
		await this.inFlight;
	}

	/** Save now if anything is waiting. Resolves when everything scheduled so far is stored. */
	async flush(): Promise<void> {
		clearTimeout(this.timer);
		this.timer = undefined;
		this.firstAt = null;
		if (this.inFlight) await this.inFlight;
		const record = this.pending;
		if (!record) return;
		this.pending = null;
		this.onStatus('saving');
		this.inFlight = this.save(record)
			.then(() => {
				emergencyCopy.clearIfSaved(record.id, record.savedAt ?? 0);
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
