import type { MediaInfo } from '$lib/media/db';
import type { Project, Scene } from '$lib/model/types';
import { DEFAULT_FORMAT } from '$lib/model/format';
import { DEFAULT_FRAME } from '$lib/model/framing';
import { CARD_SECONDS, defaultCard } from '$lib/model/card';
import { nameFromFile } from '$lib/media/kinds';

export const PHOTO_SECONDS = 3;

export function newId(): string {
	return crypto.randomUUID();
}

export function newProject(): Project {
	const now = Date.now();
	return {
		id: newId(),
		title: 'My video',
		format: { ...DEFAULT_FORMAT },
		formatSet: false,
		mood: 'natural',
		scenes: [],
		texts: [],
		sounds: [],
		library: [],
		createdAt: now,
		updatedAt: now
	};
}

/** A new scene for an imported photo or video, using the whole clip (photos get 3 seconds). */
export function sceneFromMedia(info: MediaInfo): Scene {
	const isPhoto = info.kind === 'photo';
	return {
		id: newId(),
		mediaId: info.id,
		kind: isPhoto ? 'photo' : 'video',
		name: nameFromFile(info.name),
		sourceStart: isPhoto ? 0 : info.startTime,
		sourceEnd: isPhoto ? PHOTO_SECONDS : info.duration,
		speed: 1,
		volume: 1,
		mood: null,
		transition: { kind: 'cut', duration: 0 },
		frame: { ...DEFAULT_FRAME }
	};
}

/** A new card scene: 3 seconds of a plain colour. */
export function newCardScene(): Scene {
	return {
		id: newId(),
		mediaId: '',
		kind: 'card',
		name: 'Card',
		sourceStart: 0,
		sourceEnd: CARD_SECONDS,
		speed: 1,
		volume: 1,
		mood: null,
		transition: { kind: 'cut', duration: 0 },
		frame: { ...DEFAULT_FRAME },
		card: defaultCard()
	};
}
