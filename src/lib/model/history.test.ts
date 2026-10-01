import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
	it('undoes and redoes steps in order', () => {
		const h = new History<number>();
		h.record('one', 0, 1);
		h.record('two', 1, 2);
		expect(h.undo()).toEqual({ state: 1, label: 'two' });
		expect(h.undo()).toEqual({ state: 0, label: 'one' });
		expect(h.undo()).toBeNull();
		expect(h.redo()).toEqual({ state: 1, label: 'one' });
		expect(h.redo()).toEqual({ state: 2, label: 'two' });
		expect(h.redo()).toBeNull();
	});

	it('clears the redo stack after a new edit', () => {
		const h = new History<number>();
		h.record('one', 0, 1);
		h.undo();
		h.record('other', 0, 5);
		expect(h.canRedo).toBe(false);
		expect(h.undoLabel).toBe('other');
	});

	it('merges quick repeated edits with the same key', () => {
		const h = new History<number>(100, 1000);
		h.record('length', 0, 1, 'len:a', 0);
		h.record('length', 1, 2, 'len:a', 500);
		h.record('length', 2, 3, 'len:a', 900);
		expect(h.undo()).toEqual({ state: 0, label: 'length' });
		expect(h.canUndo).toBe(false);
	});

	it('does not merge after a pause, with a different key, or after undo/redo', () => {
		const h = new History<number>(100, 1000);
		h.record('length', 0, 1, 'k', 0);
		h.record('length', 1, 2, 'k', 5000);
		h.record('speed', 2, 3, 'other', 5100);
		h.undo();
		h.redo();
		h.record('speed', 3, 4, 'other', 5200);
		const states = [h.undo()?.state, h.undo()?.state, h.undo()?.state, h.undo()?.state];
		expect(states).toEqual([3, 2, 1, 0]);
	});

	it('forgets the oldest steps past the limit', () => {
		const h = new History<number>(2);
		h.record('a', 0, 1);
		h.record('b', 1, 2);
		h.record('c', 2, 3);
		h.undo();
		h.undo();
		expect(h.canUndo).toBe(false);
	});
});

describe('ending a run of merged edits', () => {
	it('seal: the next edit with the same key is a new step, even right away', () => {
		const h = new History<string>();
		h.record('Type', 'a', 'ab', 'words:1', 0);
		h.record('Type', 'ab', 'abc', 'words:1', 100);
		h.seal('words:1');
		h.record('Type', 'abc', 'abcd', 'words:1', 200);
		expect(h.undo()?.state).toBe('abc');
		expect(h.undo()?.state).toBe('a');
		// Another key isn't affected.
		h.record('Size', 's1', 's2', 'size', 300);
		h.seal('words:1');
		h.record('Size', 's2', 's3', 'size', 400);
		expect(h.undo()?.state).toBe('s1');
	});
});
