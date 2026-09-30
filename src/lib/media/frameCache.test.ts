import { describe, expect, it, vi } from 'vitest';
import { FrameCache } from './frameCache';

function filled(from: number, to: number, fps = 10) {
	const evicted: number[] = [];
	const cache = new FrameCache<number>((f) => evicted.push(f.timestamp));
	for (let t = from; t < to - 1e-9; t += 1 / fps) {
		const ts = Math.round(t * 1000) / 1000;
		cache.insert({ timestamp: ts, duration: 1 / fps, image: ts });
	}
	return { cache, evicted };
}

describe('FrameCache', () => {
	it('finds the frame covering a time', () => {
		const { cache } = filled(0, 1);
		expect(cache.lookup(0.35)).toEqual({
			frame: expect.objectContaining({ timestamp: 0.3 }),
			exact: true
		});
		expect(cache.lookup(0)?.frame.timestamp).toBe(0);
	});

	it('returns the nearest frame, not exact, when outside the cached range', () => {
		const { cache } = filled(2, 3);
		expect(cache.lookup(1)).toMatchObject({ frame: { timestamp: 2 }, exact: false });
		expect(cache.lookup(5)).toMatchObject({ frame: { timestamp: 2.9 }, exact: false });
		expect(new FrameCache().lookup(1)).toBeNull();
	});

	it('keeps frames sorted when inserted out of order and replaces duplicates', () => {
		const onEvict = vi.fn();
		const cache = new FrameCache<string>(onEvict);
		cache.insert({ timestamp: 1, duration: 0.5, image: 'b' });
		cache.insert({ timestamp: 0, duration: 0.5, image: 'a' });
		cache.insert({ timestamp: 1, duration: 0.5, image: 'b2' });
		expect(cache.first?.image).toBe('a');
		expect(cache.last?.image).toBe('b2');
		expect(onEvict).toHaveBeenCalledTimes(1);
	});

	it('knows when a span is covered', () => {
		const { cache } = filled(0, 2);
		expect(cache.covers(0.5, 1.5)).toBe(true);
		expect(cache.covers(1.5, 2.5)).toBe(false);
		expect(cache.covers(-1, 0.5)).toBe(false);
	});

	it('evicts outside a window and trims to a maximum around the playhead', () => {
		const { cache, evicted } = filled(0, 3);
		cache.evictOutside(1, 2);
		expect(cache.first!.timestamp).toBeGreaterThanOrEqual(0.9);
		expect(cache.last!.timestamp).toBeLessThanOrEqual(2);
		cache.trimAround(1.2, 4);
		expect(cache.size).toBe(4);
		expect(evicted.length).toBeGreaterThan(0);
		expect(cache.lookup(1.2)?.exact).toBe(true);
	});
});
