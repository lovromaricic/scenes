import { describe, expect, it } from 'vitest';
import { guessKind, nameFromFile, unsupportedMessage } from './kinds';

describe('guessKind', () => {
	it('uses the MIME type', () => {
		expect(guessKind({ name: 'a', type: 'video/mp4' })).toBe('video');
		expect(guessKind({ name: 'a', type: 'image/png' })).toBe('photo');
		expect(guessKind({ name: 'a', type: 'audio/mpeg' })).toBe('audio');
	});
	it('falls back to the extension', () => {
		expect(guessKind({ name: 'Clip.MOV', type: '' })).toBe('video');
		expect(guessKind({ name: 'photo.jpeg', type: '' })).toBe('photo');
		expect(guessKind({ name: 'song.m4a', type: '' })).toBe('audio');
	});
	it('prefers the MIME type over the extension', () => {
		expect(guessKind({ name: 'Voiceover 1.webm', type: 'audio/webm;codecs=opus' })).toBe('audio');
	});
	it('rejects unknown and HEIC files', () => {
		expect(guessKind({ name: 'notes.txt', type: 'text/plain' })).toBe('unknown');
		expect(guessKind({ name: 'IMG_1.HEIC', type: 'image/heic' })).toBe('unknown');
	});
});

describe('nameFromFile', () => {
	it('makes a friendly name', () => {
		expect(nameFromFile('beach_day-01.mp4')).toBe('Beach day 01');
		expect(nameFromFile('.mp4')).toBe('Clip');
		expect(nameFromFile('a'.repeat(40) + '.mov')).toHaveLength(28);
	});
});

describe('unsupportedMessage', () => {
	it('names the file in plain words', () => {
		expect(unsupportedMessage('notes.txt', 'type')).toContain('notes.txt');
		expect(unsupportedMessage('a.heic', 'heic')).toContain('JPG');
	});
});
