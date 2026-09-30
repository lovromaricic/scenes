import { describe, expect, it } from 'vitest';
import {
	estimateBytes,
	exportFileName,
	formatBytes,
	formatTimeLeft,
	outputSize,
	presetById,
	videoBitrate
} from './presets';

const hd = { width: 1920, height: 1080, fps: 30 };

describe('outputSize', () => {
	it('uses the project size', () => {
		expect(outputSize(hd, presetById('best'))).toEqual({ width: 1920, height: 1080 });
		expect(outputSize({ width: 1080, height: 1920 }, presetById('balanced'))).toEqual({
			width: 1080,
			height: 1920
		});
	});
	it('scales Small file down to 720 on the short side, never up', () => {
		expect(outputSize(hd, presetById('small'))).toEqual({ width: 1280, height: 720 });
		expect(outputSize({ width: 1080, height: 1350 }, presetById('small'))).toEqual({
			width: 720,
			height: 900
		});
		expect(outputSize({ width: 640, height: 480 }, presetById('small'))).toEqual({
			width: 640,
			height: 480
		});
	});
});

describe('bitrates and sizes', () => {
	it('gives sensible bitrates', () => {
		const best = videoBitrate(presetById('best'), 1920, 1080);
		const balanced = videoBitrate(presetById('balanced'), 1920, 1080);
		const small = videoBitrate(presetById('small'), 1280, 720);
		expect(best).toBeGreaterThan(10_000_000);
		expect(best).toBeLessThan(14_000_000);
		expect(balanced).toBeLessThan(best);
		expect(small).toBeLessThan(balanced);
	});
	it('uses more bits for higher frame rates, but less than proportionally', () => {
		const at30 = videoBitrate(presetById('best'), 1920, 1080, 30);
		const at60 = videoBitrate(presetById('best'), 1920, 1080, 60);
		expect(at60).toBeGreaterThan(at30);
		expect(at60).toBeLessThan(at30 * 2);
	});
	it('estimates the file size', () => {
		const bytes = estimateBytes(presetById('best'), hd, 30);
		expect(bytes / 1e6).toBeGreaterThan(35);
		expect(bytes / 1e6).toBeLessThan(55);
		expect(estimateBytes(presetById('small'), hd, 30)).toBeLessThan(bytes / 3);
	});
	it('formats sizes', () => {
		expect(formatBytes(500_000)).toBe('under 1 MB');
		expect(formatBytes(4_560_000)).toBe('4.6 MB');
		expect(formatBytes(45_600_000)).toBe('46 MB');
		expect(formatBytes(2_300_000_000)).toBe('2.3 GB');
	});
});

describe('formatTimeLeft', () => {
	it('waits for enough progress before guessing', () => {
		expect(formatTimeLeft(0.01, 5)).toMatch(/Working out/);
	});
	it('rounds to friendly amounts', () => {
		expect(formatTimeLeft(0.5, 20)).toBe('About 20 seconds left');
		expect(formatTimeLeft(0.9, 30)).toBe('Almost done');
		expect(formatTimeLeft(0.36, 2.5)).toBe('A few seconds left');
		expect(formatTimeLeft(0.25, 60)).toBe('About 3 minutes left');
		expect(formatTimeLeft(0.5, 50)).toBe('About 50 seconds left');
		expect(formatTimeLeft(0.5, 70)).toBe('About a minute left');
	});
});

describe('exportFileName', () => {
	it('uses the title without unsafe characters', () => {
		expect(exportFileName('Summer in Split', 'mp4')).toBe('Summer in Split.mp4');
		expect(exportFileName('a/b:c?', 'webm')).toBe('a b c.webm');
		expect(exportFileName('   ', 'mp4')).toBe('Untitled video.mp4');
	});
});
