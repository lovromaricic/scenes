import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from './messages.svelte';

afterEach(() => {
	messages.clear();
	vi.useRealTimers();
});

describe('one helper for every message', () => {
	it('about an item: a bubble (one at a time), gone after about 4 s', () => {
		vi.useFakeTimers();
		messages.show('First', { item: 'a' });
		messages.show('Second', { item: 'b' });
		expect(messages.bubble).toMatchObject({ message: 'Second', itemId: 'b' });
		expect(messages.toasts).toHaveLength(0);
		vi.advanceTimersByTime(3900);
		expect(messages.bubble).not.toBeNull();
		vi.advanceTimersByTime(200);
		expect(messages.bubble).toBeNull();
	});

	it('an older bubble’s timer doesn’t close a newer one', () => {
		vi.useFakeTimers();
		messages.show('Old', { item: 'a' });
		vi.advanceTimersByTime(3000);
		messages.show('New', { item: 'a' });
		vi.advanceTimersByTime(1500);
		expect(messages.bubble?.message).toBe('New');
	});

	it('anything else: a toast; information goes after about 5 s, errors stay until closed', () => {
		vi.useFakeTimers();
		messages.show('Saved.');
		messages.show('That file can’t be used.', { tone: 'error' });
		expect(messages.toasts.map((t) => t.message)).toEqual(['Saved.', 'That file can’t be used.']);
		expect(messages.bubble).toBeNull();
		vi.advanceTimersByTime(5100);
		expect(messages.toasts.map((t) => t.message)).toEqual(['That file can’t be used.']);
		vi.advanceTimersByTime(60_000);
		expect(messages.toasts).toHaveLength(1);
		messages.dismiss(messages.toasts[0].id);
		expect(messages.toasts).toHaveLength(0);
	});
});
