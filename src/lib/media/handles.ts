import {
	ALL_FORMATS,
	BlobSource,
	Input,
	type InputAudioTrack,
	type InputVideoTrack
} from 'mediabunny';
import { getMedia, type MediaInfo } from './db';

/**
 * Opened media files, shared by the frame providers, the audio engine and the exporter.
 * Each file is read straight from its IndexedDB Blob; nothing is copied into memory up front.
 */

export interface MediaHandle {
	info: MediaInfo;
	blob: Blob;
	input: Input | null;
	video: InputVideoTrack | null;
	audio: InputAudioTrack | null;
}

const handles = new Map<string, Promise<MediaHandle>>();

/** Register a blob we already hold (right after import) so it isn't read back from the database. */
export function registerBlob(info: MediaInfo, blob: Blob): void {
	if (!handles.has(info.id)) handles.set(info.id, open(info, blob));
}

export function getHandle(id: string): Promise<MediaHandle> {
	let handle = handles.get(id);
	if (!handle) {
		handle = (async () => {
			const record = await getMedia(id);
			if (!record) throw new Error(`Missing media ${id}`);
			const { blob, ...info } = record;
			return open(info, blob);
		})();
		handle.catch(() => handles.delete(id));
		handles.set(id, handle);
	}
	return handle;
}

async function open(info: MediaInfo, blob: Blob): Promise<MediaHandle> {
	if (info.kind === 'photo') return { info, blob, input: null, video: null, audio: null };
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	const video = info.kind === 'video' ? await input.getPrimaryVideoTrack() : null;
	const audioTrack = info.hasAudio ? await input.getPrimaryAudioTrack() : null;
	return { info, blob, input, video, audio: audioTrack };
}

export function forgetHandle(id: string): void {
	const handle = handles.get(id);
	handles.delete(id);
	handle?.then((h) => h.input?.dispose()).catch(() => {});
}
