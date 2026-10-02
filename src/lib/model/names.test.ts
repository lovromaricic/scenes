import { describe, expect, it } from 'vitest';
import { defaultName, displayName, labelFor } from './items';
import { migrateProject } from './projects';

describe('names', () => {
	const clip = { name: 'beach.mp4' };
	const words = { text: 'Hello there' };

	it('shows the default until renamed: the file name, "Card", or the words', () => {
		expect(displayName(clip)).toBe('beach.mp4');
		expect(displayName({ name: 'Card' })).toBe('Card');
		expect(displayName(words)).toBe('Hello there');
		expect(defaultName(words)).toBe('Hello there');
		expect(displayName({ ...clip, label: 'Intro' })).toBe('Intro');
		expect(displayName({ ...words, label: 'Opening line' })).toBe('Opening line');
	});

	it('an empty name, or the default, brings the default back', () => {
		expect(labelFor(clip, '  Intro  ')).toBe('Intro');
		expect(labelFor(clip, '')).toBeUndefined();
		expect(labelFor(clip, '   ')).toBeUndefined();
		expect(labelFor(clip, 'beach.mp4')).toBeUndefined();
		expect(labelFor(words, 'Hello there')).toBeUndefined();
	});

	it('names are kept when a project is opened again', () => {
		const project = migrateProject({
			id: 'p',
			title: 'Trip',
			scenes: [
				{
					id: 's',
					mediaId: 'm',
					kind: 'video',
					name: 'beach.mp4',
					label: 'Intro',
					sourceStart: 0,
					sourceEnd: 2,
					speed: 1,
					volume: 1,
					mood: null,
					transition: { kind: 'cut', duration: 0 }
				}
			]
		} as never);
		expect(project.scenes[0].label).toBe('Intro');
		expect(project.scenes[0].name).toBe('beach.mp4');
	});
});
