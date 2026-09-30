/**
 * One way to follow a pointer drag, used by every drag in the app (moving and resizing things on
 * the preview, crop handles, the storyboard, the Layers, Words and Sound lanes).
 *
 * A drag must always end, however the button is released:
 * - the pointer is captured by an element that stays in the page for the whole drag;
 * - moves and releases are heard on the window (so releasing outside the element, the preview
 *   or the browser window still counts);
 * - pointerup, pointercancel, lostpointercapture and the window losing focus all end it;
 * - as a safety net, a move with no button pressed (`buttons === 0`) ends it too: the release was
 *   lost somewhere (for example the window lost focus mid-drag), so the drag must not follow the
 *   mouse any more;
 * - all listeners are removed when it ends, or when its scope is disposed.
 */

export interface DragHandlers {
	/** Each pointer move while the button is held. */
	move(event: PointerEvent): void;
	/**
	 * The drag is over. `cancelled` is true for pointercancel (the browser took over, e.g. to
	 * scroll); the last move has already been applied either way.
	 */
	end(event: PointerEvent | null, cancelled: boolean): void;
}

export interface Drag {
	pointerId: number;
	/**
	 * Capture the pointer on `element` from now on (for drags that only capture once they really
	 * start moving, so a plain click still reaches what was clicked). Use an element that stays in
	 * the page, not one that may be moved or re-created while dragging.
	 */
	capture(element: Element): void;
	/** End the drag now (as if released). */
	stop(): void;
}

/**
 * Start following the pointer from a pointerdown. `capture` defaults to the element the handler
 * is on; it must stay in the page until the drag ends.
 */
export function startDrag(
	down: PointerEvent,
	handlers: DragHandlers,
	capture: Element | null = down.currentTarget as Element | null
): Drag {
	const pointerId = down.pointerId;
	let done = false;

	const take = (element: Element | null) => {
		if (!element) return;
		capture?.removeEventListener('lostpointercapture', onlost);
		capture = element;
		try {
			element.setPointerCapture(pointerId);
		} catch {
			// Not an active pointer (e.g. a synthetic event): the window listeners still work.
		}
		element.addEventListener('lostpointercapture', onlost);
	};

	const finish = (event: PointerEvent | null, cancelled: boolean) => {
		if (done) return;
		done = true;
		window.removeEventListener('pointermove', onmove, true);
		window.removeEventListener('pointerup', onup, true);
		window.removeEventListener('pointercancel', oncancel, true);
		window.removeEventListener('blur', onblur);
		capture?.removeEventListener('lostpointercapture', onlost);
		try {
			if (capture?.hasPointerCapture(pointerId)) capture.releasePointerCapture(pointerId);
		} catch {
			// Already released.
		}
		handlers.end(event, cancelled);
	};

	const onmove = (event: PointerEvent) => {
		if (event.pointerId !== pointerId) return;
		// No button held any more: the release never reached us. Stop following the mouse.
		if (event.buttons === 0) {
			finish(event, false);
			return;
		}
		handlers.move(event);
	};
	const onup = (event: PointerEvent) => {
		if (event.pointerId === pointerId) finish(event, false);
	};
	const oncancel = (event: PointerEvent) => {
		if (event.pointerId === pointerId) finish(event, true);
	};
	const onlost = (event: Event) => {
		if ((event as PointerEvent).pointerId === pointerId) finish(event as PointerEvent, false);
	};
	const onblur = () => finish(null, false);

	window.addEventListener('pointermove', onmove, true);
	window.addEventListener('pointerup', onup, true);
	window.addEventListener('pointercancel', oncancel, true);
	window.addEventListener('blur', onblur);
	const first = capture;
	capture = null;
	take(first);

	return { pointerId, capture: (element) => !done && take(element), stop: () => finish(null, false) };
}

/**
 * The drags a component has started, so they can all be ended when it goes away (call
 * `dispose` from the component's cleanup).
 */
export class DragScope {
	private drags = new Set<Drag>();

	start(down: PointerEvent, handlers: DragHandlers, capture?: Element | null): Drag {
		const drag = startDrag(
			down,
			{
				move: handlers.move,
				end: (event, cancelled) => {
					this.drags.delete(drag);
					handlers.end(event, cancelled);
				}
			},
			capture === undefined ? (down.currentTarget as Element | null) : capture
		);
		this.drags.add(drag);
		return drag;
	}

	get active(): boolean {
		return this.drags.size > 0;
	}

	dispose(): void {
		for (const drag of [...this.drags]) drag.stop();
		this.drags.clear();
	}
}

/** Stop the browser's own drag-and-drop of images and selections (it would swallow the release). */
export function preventNativeDrag(event: DragEvent): void {
	event.preventDefault();
}
