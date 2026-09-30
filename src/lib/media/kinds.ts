import type { MediaKind } from './db';

/** File types Scenes accepts, used for the file picker and for sniffing dropped files. */
export const ACCEPT_VISUAL =
	'video/*,image/*,.mp4,.mov,.m4v,.webm,.mkv,.jpg,.jpeg,.png,.webp,.gif,.avif';
export const ACCEPT_AUDIO = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac';

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'ts'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'];
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac'];
const UNSUPPORTED_IMAGE_EXT = ['heic', 'heif', 'tif', 'tiff', 'raw', 'cr2', 'nef', 'dng', 'psd'];

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Best guess at what a file is from its MIME type and extension. */
export function guessKind(file: { name: string; type: string }): MediaKind | 'unknown' {
	const ext = extensionOf(file.name);
	if (UNSUPPORTED_IMAGE_EXT.includes(ext)) return 'unknown';
	// The MIME type wins when there is one: e.g. an audio-only .webm recording is audio/webm.
	if (file.type.startsWith('video/')) return 'video';
	if (file.type.startsWith('image/')) return 'photo';
	if (file.type.startsWith('audio/')) return 'audio';
	if (VIDEO_EXT.includes(ext)) return 'video';
	if (IMAGE_EXT.includes(ext)) return 'photo';
	if (AUDIO_EXT.includes(ext)) return 'audio';
	return 'unknown';
}

/** A friendly scene name from a file name: no extension, separators turned into spaces. */
export function nameFromFile(fileName: string): string {
	const base =
		fileName
			.replace(/\.[^.]+$/, '')
			.replace(/[_-]+/g, ' ')
			.trim() || 'Clip';
	const pretty = base.charAt(0).toUpperCase() + base.slice(1);
	return pretty.length > 28 ? `${pretty.slice(0, 27).trimEnd()}…` : pretty;
}

/**
 * Explains why a file couldn't be added, in plain words.
 * `detail` is an optional short technical hint (never shown on its own).
 */
export function unsupportedMessage(
	fileName: string,
	reason: 'type' | 'codec' | 'broken' | 'heic' | 'empty'
): string {
	switch (reason) {
		case 'heic':
			return `“${fileName}” is a HEIC photo, which browsers can’t open yet. Export it as JPG and try again.`;
		case 'codec':
			return `“${fileName}” uses a video format this browser can’t play. Try an MP4 or WebM version.`;
		case 'broken':
			return `“${fileName}” couldn’t be read. The file may be damaged or incomplete.`;
		case 'empty':
			return `“${fileName}” has no picture in it, so it can’t be a scene.`;
		default:
			return `“${fileName}” isn’t a photo or video Scenes can use.`;
	}
}
