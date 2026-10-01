/**
 * The editing model: plain data describing a project. No DOM, no Svelte, no media handles,
 * so it can be serialised to IndexedDB and tested without a browser.
 * All times are in seconds.
 */

import type { ProjectFormat } from './format';
import type { SceneFrame } from './framing';
import type { Crop } from './crop';
import type { CardContent } from './card';
import type { TextColors, TextFont, TextShadow } from './textStyle';
import type { Overlay } from './overlay';
import type { Track } from './tracks';
import type { FrameValues, ItemValues, Keyframe } from './keyframes';
import type { VolumeValues } from './volume';

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
	/** A video, a still photo, or a card (a colour screen with no file; mediaId is ''). */
	kind: 'video' | 'photo' | 'card';
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
	/** Part of the source kept, in source pixels, applied before framing (missing = whole clip). */
	crop?: Crop;
	/** Cards only: what's drawn. */
	card?: CardContent;
	/** Custom framing animation (see keyframes.ts); times are the clip's own (source) seconds. */
	keyframes?: Keyframe<FrameValues>[];
	/** Volume points for the clip's own sound; times are the clip's own (source) seconds. */
	volumePoints?: Keyframe<VolumeValues>[];
}

export interface TextItem {
	id: string;
	/** The overlay track it's on. */
	trackId: string;
	text: string;
	start: number;
	duration: number;
	/** Centre of the text, as a fraction of the frame (0–1). */
	x: number;
	y: number;
	style: TextStyleId;
	animation: TextAnimation;
	/** Overrides on top of the style (missing = the style's own). */
	font?: TextFont;
	/** Font size as a fraction of the frame's short side. */
	size?: number;
	colors?: TextColors;
	/** The shadow, when changed from the style's own (missing = the style's). */
	shadow?: TextShadow;
	/** Scale on top of the font size, around the centre (missing = 1). */
	scaleX?: number;
	scaleY?: number;
	scaleLinked?: boolean;
	/** Degrees, clockwise (missing = 0). */
	rotation?: number;
	/** 0–1 (missing = 1). */
	opacity?: number;
	/** False for the first half of split words: no fade out at the split (missing = fades). */
	exitFade?: boolean;
	/** Animation (see keyframes.ts); times are seconds from `start`. */
	keyframes?: Keyframe<ItemValues>[];
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
	/** Volume points (the rubber band); times are seconds from `start`. */
	volumePoints?: Keyframe<VolumeValues>[];
	/** Fade in and out lengths in seconds (0–5), at the clip's (trimmed) edges. */
	fadeIn: number;
	fadeOut: number;
	/** The audio track it's on. */
	trackId: string;
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
	/**
	 * Which styles' defaults the words were made with (2: Clean white without a shadow). Older
	 * projects are brought up to it so their words look as they did. See migrateProject.
	 */
	styleDefaults?: number;
	/**
	 * The storyboard's tracks, top to bottom: overlay tracks (highest first), the main track
	 * (the scenes), audio tracks. See tracks.ts.
	 */
	tracks: Track[];
	/** The part of the video set with I and O, for saving just that (missing = none). */
	range?: { start: number; end: number } | null;
	/** Videos, photos and cards on overlay tracks, drawn over the scenes. */
	overlays: Overlay[];
	/** Every photo and video imported into this project, in import order ("Your media"). */
	library: string[];
	createdAt: number;
	updatedAt: number;
}
