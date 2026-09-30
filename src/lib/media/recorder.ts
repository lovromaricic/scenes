/**
 * Records the microphone with MediaRecorder. The result is a normal audio file (WebM/Opus in
 * Chrome) that is stored and played like any imported sound.
 */

export class MicrophoneError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MicrophoneError';
	}
}

function pickMimeType(): string {
	const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
	return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export class VoiceRecorder {
	private stream: MediaStream | null = null;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private startedAt = 0;

	/** Ask for the microphone. Throws MicrophoneError with a friendly message. */
	async open(): Promise<void> {
		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
			throw new MicrophoneError('This browser can’t record sound.');
		}
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
			});
		} catch (error) {
			const name = error instanceof DOMException ? error.name : '';
			throw new MicrophoneError(
				name === 'NotAllowedError' || name === 'SecurityError'
					? 'Scenes needs permission to use your microphone. Allow it in the address bar and try again.'
					: name === 'NotFoundError'
						? 'No microphone was found. Plug one in and try again.'
						: 'The microphone couldn’t be started.'
			);
		}
	}

	start(): void {
		if (!this.stream) throw new MicrophoneError('The microphone isn’t ready.');
		const mimeType = pickMimeType();
		this.chunks = [];
		this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
		this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
		this.recorder.start(250);
		this.startedAt = performance.now();
	}

	/** Seconds since recording started. */
	get elapsed(): number {
		return this.recorder ? (performance.now() - this.startedAt) / 1000 : 0;
	}

	/** Stop and return the recording (null if nothing was recorded). Always releases the mic. */
	async stop(): Promise<{ blob: Blob; seconds: number } | null> {
		const recorder = this.recorder;
		const seconds = this.elapsed;
		this.recorder = null;
		let blob: Blob | null = null;
		if (recorder && recorder.state !== 'inactive') {
			await new Promise<void>((resolve) => {
				recorder.onstop = () => resolve();
				recorder.stop();
			});
			blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
		}
		this.close();
		return blob && blob.size > 0 ? { blob, seconds } : null;
	}

	close(): void {
		for (const track of this.stream?.getTracks() ?? []) track.stop();
		this.stream = null;
	}
}
