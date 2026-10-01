import { describe, expect, it, vi } from 'vitest';
import { Autosaver } from './autosave';
import { newProject } from './project';
import { getProject, saveProject } from '$lib/media/db';

describe('Autosaver', () => {
	it('saves once, shortly after changes stop, with only the latest', async () => {
		vi.useFakeTimers();
		const save = vi.fn(async () => {});
		const statuses: string[] = [];
		const saver = new Autosaver((s) => statuses.push(s), 500, save);
		const p = newProject();
		saver.schedule({ ...p, title: 'one' });
		await vi.advanceTimersByTimeAsync(300);
		saver.schedule({ ...p, title: 'two' });
		await vi.advanceTimersByTimeAsync(400);
		expect(save).not.toHaveBeenCalled(); // still within 500 ms of the last change
		await vi.advanceTimersByTimeAsync(150);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'two' }));
		expect(statuses).toEqual(['saving', 'saved']);
		vi.useRealTimers();
	});

	it('still saves during a long burst of changes (at most 2 s after the first)', async () => {
		vi.useFakeTimers();
		const save = vi.fn(async () => {});
		const saver = new Autosaver(() => {}, 500, save, 2000);
		// Typing every 100 ms for 5 s.
		for (let i = 0; i < 50; i++) {
			saver.schedule({ ...newProject(), title: `t${i}` });
			await vi.advanceTimersByTimeAsync(100);
		}
		expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(save.mock.calls.length).toBeLessThanOrEqual(3);
		vi.useRealTimers();
	});

	it('flushes immediately on demand and reports errors', async () => {
		const statuses: string[] = [];
		const saver = new Autosaver(
			(s) => statuses.push(s),
			10_000,
			async () => {
				throw new Error('disk full');
			}
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		saver.schedule(newProject());
		await saver.flush();
		expect(statuses.at(-1)).toBe('error');
	});

	it('round-trips a project through IndexedDB', async () => {
		const p = { ...newProject(), title: 'Holiday', updatedAt: Date.now() + 1000 };
		await saveProject({ ...p, view: { time: 4.5, selectedId: null } });
		const loaded = await getProject(p.id);
		expect(loaded).toMatchObject({ id: p.id, title: 'Holiday', view: { time: 4.5 } });
	});
});
