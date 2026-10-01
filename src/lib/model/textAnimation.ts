import type { TextItem } from './types';

/** Length of the entrance animation, and of the soft fade out at the end (seconds). */
export const TEXT_ENTER = 0.5;
export const TEXT_EXIT = 0.25;

export interface TextFrameState {
	visible: boolean;
	opacity: number;
	/** Vertical offset as a fraction of the frame's short side (positive = lower). */
	dy: number;
	scale: number;
}

const HIDDEN: TextFrameState = { visible: false, opacity: 0, dy: 0, scale: 1 };

/** Whether the text is on screen at time `t`. */
export function isTextVisible(item: Pick<TextItem, 'start' | 'duration'>, t: number): boolean {
	return t >= item.start && t < item.start + item.duration;
}

/** How a text item looks at timeline time `t`: its entrance animation, then a short fade out. */
export function textFrameState(item: TextItem, t: number): TextFrameState {
	if (!isTextVisible(item, t)) return HIDDEN;
	const local = t - item.start;
	const remaining = item.duration - local;
	const enter = Math.min(TEXT_ENTER, item.duration / 2);
	const exit = Math.min(TEXT_EXIT, item.duration / 4);
	const p = enter > 0 ? Math.min(1, local / enter) : 1;
	const out = item.animation === 'none' || exit <= 0 || item.exitFade === false ? 1 : Math.min(1, remaining / exit);

	switch (item.animation) {
		case 'fade':
			return { visible: true, opacity: easeOutCubic(p) * out, dy: 0, scale: 1 };
		case 'slide-up':
			return {
				visible: true,
				opacity: easeOutCubic(p) * out,
				dy: 0.06 * (1 - easeOutCubic(p)),
				scale: 1
			};
		case 'pop':
			return {
				visible: true,
				opacity: Math.min(1, p * 2.5) * out,
				dy: 0,
				scale: 0.6 + 0.4 * easeOutBack(p)
			};
		default:
			return { visible: true, opacity: 1, dy: 0, scale: 1 };
	}
}

export function easeOutCubic(x: number): number {
	return 1 - Math.pow(1 - x, 3);
}

export function easeOutBack(x: number): number {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
