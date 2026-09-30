/**
 * Undo/redo history of whole-document snapshots. Projects are small (no media inside), so
 * storing snapshots is simple, fast and can't get out of step with the edit functions.
 */

export interface HistoryEntry<T> {
	label: string;
	before: T;
	after: T;
	/** Edits with the same key within `coalesceMs` merge into one step (e.g. holding a stepper). */
	key?: string;
	at: number;
}

export class History<T> {
	private past: HistoryEntry<T>[] = [];
	private future: HistoryEntry<T>[] = [];

	constructor(
		private readonly limit = 200,
		private readonly coalesceMs = 1000
	) {}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}

	/** Label of the step that undo would revert. */
	get undoLabel(): string | null {
		return this.past.at(-1)?.label ?? null;
	}

	get redoLabel(): string | null {
		return this.future.at(-1)?.label ?? null;
	}

	record(label: string, before: T, after: T, key?: string, now = Date.now()): void {
		const last = this.past.at(-1);
		if (key && last?.key === key && now - last.at < this.coalesceMs) {
			last.after = after;
			last.at = now;
		} else {
			this.past.push({ label, before, after, key, at: now });
			if (this.past.length > this.limit) this.past.shift();
		}
		this.future = [];
	}

	/** Returns the state to restore, or null if there is nothing to undo. */
	undo(): { state: T; label: string } | null {
		const entry = this.past.pop();
		if (!entry) return null;
		this.future.push(entry);
		return { state: entry.before, label: entry.label };
	}

	redo(): { state: T; label: string } | null {
		const entry = this.future.pop();
		if (!entry) return null;
		this.past.push({ ...entry, key: undefined });
		return { state: entry.after, label: entry.label };
	}

	clear(): void {
		this.past = [];
		this.future = [];
	}
}
