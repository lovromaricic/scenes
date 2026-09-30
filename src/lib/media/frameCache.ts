/**
 * A time-sorted cache of decoded frames for one source. Pure logic, no decoding, so it can be tested.
 * Frames are anything with a timestamp and duration (in source seconds).
 */

export interface TimedFrame<T> {
	timestamp: number;
	duration: number;
	image: T;
}

export interface Lookup<T> {
	frame: TimedFrame<T>;
	/** True when the frame actually covers the requested time (not just the nearest one we have). */
	exact: boolean;
}

const EPS = 1e-4;

export class FrameCache<T> {
	private frames: TimedFrame<T>[] = [];

	constructor(private readonly onEvict: (frame: TimedFrame<T>) => void = () => {}) {}

	get size(): number {
		return this.frames.length;
	}

	get first(): TimedFrame<T> | undefined {
		return this.frames[0];
	}

	get last(): TimedFrame<T> | undefined {
		return this.frames[this.frames.length - 1];
	}

	/** Index of the last frame starting at or before `t`, or -1. */
	private indexAtOrBefore(t: number): number {
		let lo = 0;
		let hi = this.frames.length - 1;
		let found = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (this.frames[mid].timestamp <= t + EPS) {
				found = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		return found;
	}

	insert(frame: TimedFrame<T>): void {
		const i = this.indexAtOrBefore(frame.timestamp);
		if (i >= 0 && Math.abs(this.frames[i].timestamp - frame.timestamp) < EPS) {
			this.onEvict(this.frames[i]);
			this.frames[i] = frame;
			return;
		}
		this.frames.splice(i + 1, 0, frame);
	}

	/**
	 * The frame showing at time `t`. When nothing covers `t`, returns the closest frame we have
	 * (marked not exact) so the preview can show something immediately while decoding catches up.
	 */
	lookup(t: number): Lookup<T> | null {
		if (this.frames.length === 0) return null;
		const i = this.indexAtOrBefore(t);
		if (i >= 0) {
			const f = this.frames[i];
			if (t < f.timestamp + f.duration + EPS) return { frame: f, exact: true };
			const next = this.frames[i + 1];
			if (!next) return { frame: f, exact: false };
			return {
				frame: t - (f.timestamp + f.duration) <= next.timestamp - t ? f : next,
				exact: false
			};
		}
		return { frame: this.frames[0], exact: false };
	}

	/** Whether frames cover the whole span [from, to) without gaps larger than `gap`. */
	covers(from: number, to: number, gap = 0.1): boolean {
		const i = this.indexAtOrBefore(from);
		if (i < 0) return false;
		let reach = this.frames[i].timestamp + this.frames[i].duration;
		if (reach + gap < from) return false;
		for (let j = i + 1; j < this.frames.length && reach < to; j++) {
			if (this.frames[j].timestamp > reach + gap) return false;
			reach = Math.max(reach, this.frames[j].timestamp + this.frames[j].duration);
		}
		return reach + EPS >= to;
	}

	/** Drop frames entirely outside [from, to]. */
	evictOutside(from: number, to: number): void {
		const keep: TimedFrame<T>[] = [];
		for (const f of this.frames) {
			if (f.timestamp + f.duration < from || f.timestamp > to) this.onEvict(f);
			else keep.push(f);
		}
		this.frames = keep;
	}

	/** Keep at most `max` frames, dropping those furthest from `t`. */
	trimAround(t: number, max: number): void {
		while (this.frames.length > max) {
			const firstDist = Math.abs(t - this.frames[0].timestamp);
			const lastDist = Math.abs(this.last!.timestamp - t);
			this.onEvict(firstDist > lastDist ? this.frames.shift()! : this.frames.pop()!);
		}
	}

	clear(): void {
		for (const f of this.frames) this.onEvict(f);
		this.frames = [];
	}
}
