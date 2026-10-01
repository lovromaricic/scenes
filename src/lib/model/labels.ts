/**
 * Words for what a scene or layer shows, so labels match its media everywhere: "video" for one
 * made from a video clip, "picture" for one made from a photo or image (and for cards).
 * Wording about the frame of the whole video ("Same shape as the video") doesn't use this.
 */

export type MediaNoun = 'video' | 'picture';

export function mediaNoun(item: { kind: 'video' | 'photo' | 'card' }): MediaNoun {
	return item.kind === 'video' ? 'video' : 'picture';
}

/** The same, starting with a capital: "Video", "Picture". */
export function MediaNoun(item: { kind: 'video' | 'photo' | 'card' }): 'Video' | 'Picture' {
	return mediaNoun(item) === 'video' ? 'Video' : 'Picture';
}
