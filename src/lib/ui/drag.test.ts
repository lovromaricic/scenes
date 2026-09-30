import { describe, expect, it, vi } from 'vitest';
import { DragScope, startDrag } from './drag';

/** A pointer event good enough for the helper (jsdom has no PointerEvent). */
function pointer(type: string, init: { pointerId?: number; buttons?: number; x?: number } = {}) {
	const e = new MouseEvent(type, { bubbles: true, clientX: init.x ?? 0, buttons: init.buttons ?? 0 });
	Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
	return e as unknown as PointerEvent;
}

function setup() {
	const el = document.createElement('div');
	document.body.append(el);
	el.setPointerCapture = vi.fn();
	el.releasePointerCapture = vi.fn();
	el.hasPointerCapture = vi.fn(() => true);
	const move = vi.fn();
	const end = vi.fn();
	const down = pointer('pointerdown', { buttons: 1 });
	startDrag(down, { move, end }, el);
	return { el, move, end };
}

describe('startDrag', () => {
	it('follows moves and ends on release anywhere in the window', () => {
		const { el, move, end } = setup();
		expect(el.setPointerCapture).toHaveBeenCalledWith(1);
		window.dispatchEvent(pointer('pointermove', { buttons: 1, x: 5 }));
		expect(move).toHaveBeenCalledTimes(1);
		document.body.dispatchEvent(pointer('pointerup'));
		expect(end).toHaveBeenCalledWith(expect.anything(), false);
		// Nothing more after it ended.
		window.dispatchEvent(pointer('pointermove', { buttons: 1 }));
		expect(move).toHaveBeenCalledTimes(1);
		expect(end).toHaveBeenCalledTimes(1);
	});

	it('ends on a move with no button held (the release was lost)', () => {
		const { move, end } = setup();
		window.dispatchEvent(pointer('pointermove', { buttons: 0 }));
		expect(move).not.toHaveBeenCalled();
		expect(end).toHaveBeenCalledTimes(1);
	});

	it('ends on cancel, lost capture and the window losing focus', () => {
		let s = setup();
		window.dispatchEvent(pointer('pointercancel'));
		expect(s.end).toHaveBeenCalledWith(expect.anything(), true);
		s = setup();
		s.el.dispatchEvent(pointer('lostpointercapture'));
		expect(s.end).toHaveBeenCalledTimes(1);
		s = setup();
		window.dispatchEvent(new Event('blur'));
		expect(s.end).toHaveBeenCalledTimes(1);
	});

	it('ignores other pointers', () => {
		const { move, end } = setup();
		window.dispatchEvent(pointer('pointermove', { pointerId: 2, buttons: 1 }));
		window.dispatchEvent(pointer('pointerup', { pointerId: 2 }));
		expect(move).not.toHaveBeenCalled();
		expect(end).not.toHaveBeenCalled();
	});

	it('a scope ends its drags when disposed', () => {
		const scope = new DragScope();
		const end = vi.fn();
		const el = document.createElement('div');
		scope.start(pointer('pointerdown', { buttons: 1 }), { move: () => {}, end }, el);
		expect(scope.active).toBe(true);
		scope.dispose();
		expect(end).toHaveBeenCalledTimes(1);
		expect(scope.active).toBe(false);
	});
});
