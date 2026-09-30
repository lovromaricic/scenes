import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { MediaInfo, MediaKind } from './db';
import { extensionOf, guessKind, unsupportedMessage } from './kinds';

/** A file Scenes can't use, with a message that is safe to show to the user. */
export class MediaImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MediaImportError';
	}
}

export interface ProbeResult {
	info: Omit<MediaInfo, 'id' | 'createdAt'>;
	thumbnail: Blob | null;
}

const THUMB_WIDTH = 320;

/** Reads a file's type, length and size, and makes a thumbnail. Throws MediaImportError. */
export async function probeFile(file: File): Promise<ProbeResult> {
	const kind = guessKind(file);
	const ext = extensionOf(file.name);
	if (kind === 'unknown') {
		throw new MediaImportError(
			unsupportedMessage(file.name, ext === 'heic' || ext === 'heif' ? 'heic' : 'type')
		);
	}
	if (file.size === 0) throw new MediaImportError(unsupportedMessage(file.name, 'broken'));
	if (kind === 'photo') return probePhoto(file);
	return probeAv(file, kind);
}

async function probePhoto(file: File): Promise<ProbeResult> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		throw new MediaImportError(unsupportedMessage(file.name, 'broken'));
	}
	const { width, height } = bitmap;
	const thumbnail = await canvasToBlob(drawScaled(bitmap, THUMB_WIDTH));
	bitmap.close();
	return {
		info: {
			name: file.name,
			kind: 'photo',
			mime: file.type || 'image/*',
			size: file.size,
			duration: 0,
			startTime: 0,
			width,
			height,
			hasAudio: false
		},
		thumbnail
	};
}

async function probeAv(file: File, kind: MediaKind): Promise<ProbeResult> {
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	try {
		let video;
		let audio;
		try {
			if (!(await input.canRead())) throw new Error('unreadable');
			video = await input.getPrimaryVideoTrack();
			audio = await input.getPrimaryAudioTrack();
		} catch {
			throw new MediaImportError(
				unsupportedMessage(file.name, kind === 'audio' ? 'type' : 'broken')
			);
		}

		const hasAudio = !!audio && (await audio.canDecode());

		if (kind === 'audio' || !video) {
			if (kind === 'video' && !video) {
				// A "video" file with only sound: treat it as audio only if asked for audio.
				throw new MediaImportError(unsupportedMessage(file.name, 'empty'));
			}
			if (!audio || !hasAudio) throw new MediaImportError(unsupportedMessage(file.name, 'codec'));
			const startTime = await audio.getFirstTimestamp();
			const duration = await input.computeDuration([audio]);
			return {
				info: {
					name: file.name,
					kind: 'audio',
					mime: file.type || (await input.getMimeType()),
					size: file.size,
					duration,
					startTime,
					width: 0,
					height: 0,
					hasAudio: true
				},
				thumbnail: null
			};
		}

		if (!(await video.canDecode())) {
			throw new MediaImportError(unsupportedMessage(file.name, 'codec'));
		}
		const startTime = await video.getFirstTimestamp();
		const duration = await input.computeDuration([video]);
		if (!(duration > startTime)) throw new MediaImportError(unsupportedMessage(file.name, 'empty'));

		const sink = new CanvasSink(video, { width: THUMB_WIDTH });
		const at = startTime + Math.min(1, (duration - startTime) * 0.1);
		const wrapped = (await sink.getCanvas(at)) ?? (await sink.getCanvas(startTime));
		const thumbnail = wrapped ? await canvasToBlob(wrapped.canvas) : null;

		return {
			info: {
				name: file.name,
				kind: 'video',
				mime: file.type || (await input.getMimeType()),
				size: file.size,
				duration,
				startTime,
				width: await video.getDisplayWidth(),
				height: await video.getDisplayHeight(),
				hasAudio
			},
			thumbnail
		};
	} finally {
		input.dispose();
	}
}

function drawScaled(source: CanvasImageSource & { width: number; height: number }, width: number) {
	const scale = Math.min(1, width / source.width);
	const canvas = new OffscreenCanvas(
		Math.max(1, Math.round(source.width * scale)),
		Math.max(1, Math.round(source.height * scale))
	);
	canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
	return canvas;
}

async function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
	if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
}
