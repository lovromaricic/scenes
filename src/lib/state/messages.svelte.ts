/**
 * Every message to the user goes through here (`messages.show`), which picks where it appears:
 *
 * - About an item in the storyboard (`item` given): a small bubble next to that item, pointing
 *   at it (see ItemBubble). One at a time; it goes after about 4 seconds, on any click, a new
 *   drag or Esc.
 * - Anything else (saved, exported, a file that can't be used…): a toast at the bottom centre of
 *   the window, never over the video. It goes after about 5 seconds; errors stay until closed.
 *
 * Messages are short and plain, and say what can be done instead when that helps.
 */

export type Tone = 'info' | 'error';

export interface Toast {
	id: number;
	message: string;
	tone: Tone;
}

export interface Bubble {
	id: number;
	message: string;
	tone: Tone;
	/** The storyboard item (scene, layer, words or sound) it's about. */
	itemId: string;
}

export interface ShowOptions {
	tone?: Tone;
	/** The item it's about: shown next to it in the storyboard. */
	item?: string | null;
	/** How long it stays (default: 4 s for a bubble, 5 s for a toast; errors stay until closed). */
	ms?: number;
}

export const BUBBLE_MS = 4000;
export const TOAST_MS = 5000;

let nextId = 1;

class Messages {
	toasts = $state<Toast[]>([]);
	bubble = $state<Bubble | null>(null);
	private bubbleTimer: ReturnType<typeof setTimeout> | undefined;

	show(message: string, options: ShowOptions = {}): void {
		const tone = options.tone ?? 'info';
		const id = nextId++;
		if (options.item) {
			// A new bubble replaces the one showing.
			clearTimeout(this.bubbleTimer);
			this.bubble = { id, message, tone, itemId: options.item };
			this.bubbleTimer = setTimeout(() => this.dismissBubble(id), options.ms ?? BUBBLE_MS);
			return;
		}
		this.toasts.push({ id, message, tone });
		const ms = options.ms ?? (tone === 'error' ? null : TOAST_MS);
		if (ms !== null) setTimeout(() => this.dismiss(id), ms);
	}

	/** Close the bubble (only that one, if `id` is given: a newer one stays). */
	dismissBubble(id?: number): void {
		if (!this.bubble || (id !== undefined && this.bubble.id !== id)) return;
		clearTimeout(this.bubbleTimer);
		this.bubble = null;
	}

	dismiss(id: number): void {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	clear(): void {
		this.toasts = [];
		this.dismissBubble();
	}
}

export const messages = new Messages();
