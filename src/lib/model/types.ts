/**
 * The editing model: plain data describing a project. No DOM, no Svelte, no media handles,
 * so it can be serialised to IndexedDB and tested without a browser.
 * All times are in seconds.
 */

import type { ProjectFormat } from './format';
import type { SceneFrame } from './framing';

/** Shapes offered by the design-page demo switch. Projects use `ProjectFormat`. */
export type AspectRatio = '16:9' | '9:16' | '1:1';

export type MoodId = 'natural' | 'golden' | 'faded' | 'cool' | 'punchy' | 'mono';

export type TransitionKind = 'cut' | 'crossfade' | 'fade-black' | 'slide' | 'zoom';

export type TextStyleId = 'clean' | 'boxed' | 'serif' | 'outline' | 'highlight' | 'title';

export type TextAnimation = 'none' | 'fade' | 'slide-up' | 'pop';

export type Speed = 0.5 | 1 | 2;

export interface Transition {
	kind: TransitionKind;
	/** Seconds of overlap between the two scenes. Ignored for cuts. */
	duration: number;
}

export interface Scene {
	id: string;
	/** Key of the source file in the media store. */
	mediaId: string;
	kind: 'video' | 'photo';
	name: string;
	/** Part of the source used, in source seconds. For photos, sourceStart is 0. */
	sourceStart: number;
	sourceEnd: number;
	speed: Speed;
	/** Volume of the clip's own sound, 0–1. */
	volume: number;
	/** Colour mood for this scene; `null` follows the whole-video mood. */
	mood: MoodId | null;
	/** Transition into the next scene. */
	transition: Transition;
	/** How the picture fits the video's shape (missing = Fill). */
	frame?: SceneFrame;
}

export interface TextItem {
	id: string;
	text: string;
	start: number;
	duration: number;
	/** Centre of the text, as a fraction of the frame (0–1). */
	x: number;
	y: number;
	style: TextStyleId;
	animation: TextAnimation;
}

export interface SoundItem {
	id: string;
	mediaId: string;
	name: string;
	/** Where it starts on the video timeline. */
	start: number;
	/** Offset into the source file. */
	sourceStart: number;
	duration: number;
	volume: number;
	kind: 'music' | 'voice';
	/** Fade in and out automatically (music only). */
	fade: boolean;
}

export interface Project {
	id: string;
	title: string;
	format: ProjectFormat;
	/** False until the first clip sets the format or the user picks one. */
	formatSet: boolean;
	mood: MoodId;
	scenes: Scene[];
	texts: TextItem[];
	sounds: SoundItem[];
	/** Every photo and video imported into this project, in import order ("Your media"). */
	library: string[];
	createdAt: number;
	updatedAt: number;
}
