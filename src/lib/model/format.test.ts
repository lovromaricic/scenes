import { describe, expect, it } from 'vitest';
import {
	clampCustom,
	formatFromClip,
	formatLabel,
	legacyFormat,
	matchPreset,
	nearestFrameRate,
	resolutionOf,
	sizeFor
} from './format';

describe('sizeFor', () => {
	it('uses the short side for every shape', () => {
		expect(sizeFor('landscape', 1080)).toEqual({ width: 1920, height: 1080 });
		expect(sizeFor('vertical', 1080)).toEqual({ width: 1080, height: 1920 });
		expect(sizeFor('square', 720)).toEqual({ width: 720, height: 720 });
		expect(sizeFor('portrait', 1080)).toEqual({ width: 1080, height: 1350 });
		expect(sizeFor('classic', 1080)).toEqual({ width: 1440, height: 1080 });
		expect(sizeFor('cinematic', 1080)).toEqual({ width: 2520, height: 1080 });
		expect(sizeFor('landscape', 2160)).toEqual({ width: 3840, height: 2160 });
	});
	it('keeps the long side within 4096 while keeping the shape', () => {
		const s = sizeFor('cinematic', 2160);
		expect(s.width).toBe(4096);
		expect(s.width / s.height).toBeCloseTo(21 / 9, 2);
	});
});

describe('clampCustom', () => {
	it('rounds to even numbers and keeps limits', () => {
		expect(clampCustom(1001, 777)).toEqual({ width: 1002, height: 778 });
		expect(clampCustom(100, 9000)).toEqual({ width: 240, height: 4096 });
		expect(clampCustom(NaN, 500)).toEqual({ width: 240, height: 500 });
	});
});

describe('formatFromClip', () => {
	it('matches a phone video to Vertical 1080p', () => {
		expect(formatFromClip(1080, 1920, 29.97)).toEqual({
			preset: 'vertical',
			width: 1080,
			height: 1920,
			fps: 30
		});
	});
	it('keeps 4K for 4K clips and uses 720p for small ones', () => {
		expect(formatFromClip(3840, 2160, 24)).toMatchObject({
			preset: 'landscape',
			width: 3840,
			fps: 24
		});
		expect(formatFromClip(640, 360, 30)).toMatchObject({
			preset: 'landscape',
			width: 1280,
			height: 720
		});
	});
	it('uses a custom size for unusual shapes', () => {
		expect(formatFromClip(1000, 1000 / 1.5, 25)).toEqual({
			preset: 'custom',
			width: 1080,
			height: 720,
			fps: 25
		});
	});
});

describe('helpers', () => {
	it('snaps frame rates', () => {
		expect(nearestFrameRate(23.976)).toBe(24);
		expect(nearestFrameRate(59.94)).toBe(60);
		expect(nearestFrameRate(0)).toBe(30);
	});
	it('matches presets by shape', () => {
		expect(matchPreset(1080, 1350)).toBe('portrait');
		expect(matchPreset(1000, 700)).toBeNull();
	});
	it('knows the resolution of a preset format', () => {
		expect(resolutionOf({ preset: 'landscape', width: 1920, height: 1080, fps: 30 })).toBe(1080);
		expect(resolutionOf({ preset: 'custom', width: 1920, height: 1080, fps: 30 })).toBeNull();
	});
	it('labels and migrates', () => {
		expect(formatLabel({ preset: 'landscape', width: 1920, height: 1080, fps: 30 })).toBe(
			'1920 × 1080 · 30 fps'
		);
		expect(legacyFormat('9:16')).toMatchObject({ preset: 'vertical', width: 1080, height: 1920 });
	});
});
