import { getContext, setContext } from 'svelte';

/**
 * What part of the stage around the preview (the pasteboard) is in view, shared with the things
 * drawn over the preview: objects may sit far outside the frame, and their boxes and handles are
 * cut off at the stage's edges, so they never cover (or catch clicks on) the panels around it.
 */
export class StageView {
	/** The visible area, in preview pixels from the frame's top-left (null: not measured yet). */
	visible = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

	/** CSS clip-path for an element covering the preview: cut off at the stage's edges. */
	get clipPath(): string {
		const v = this.visible;
		if (!v) return 'none';
		return `inset(${v.y0}px calc(100% - ${v.x1}px) calc(100% - ${v.y1}px) ${v.x0}px)`;
	}

	/**
	 * Where to anchor a selected object's toolbar: its box, moved just enough to stay in view
	 * (its centre within the stage across, and touching it up and down), so the toolbar is always
	 * there to reach, wherever the object is.
	 */
	pin(left: number, top: number, width: number, height: number): { left: number; top: number } {
		const v = this.visible;
		if (!v) return { left, top };
		const cx = Math.min(v.x1 - 24, Math.max(v.x0 + 24, left + width / 2));
		return { left: cx - width / 2, top: Math.min(v.y1, Math.max(v.y0 - height, top)) };
	}

	/** Whether there's less than `room` pixels of the stage above `top` (preview pixels). */
	cramped(top: number, room = 92): boolean {
		return top < room || top - (this.visible?.y0 ?? 0) < room;
	}

	/** Whether a box (preview pixels, from the frame's top-left) is at least partly in view. */
	shows(left: number, top: number, width: number, height: number): boolean {
		const v = this.visible;
		if (!v) return true;
		return left < v.x1 && left + width > v.x0 && top < v.y1 && top + height > v.y0;
	}
}

const KEY = Symbol('stage-view');

export function setStageView(view: StageView): void {
	setContext(KEY, view);
}

/** The stage's view (a fresh one, showing everything, outside a stage). */
export function useStageView(): StageView {
	return getContext<StageView | undefined>(KEY) ?? new StageView();
}
