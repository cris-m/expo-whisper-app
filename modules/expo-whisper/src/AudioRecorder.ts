export class AudioRecorder {
	private isRecording = false;
	private contextId: number | null = null;
	private nativeModule: any;
	private maxDurationSeconds: number = 30;

	constructor(maxDurationSeconds: number = 30) {
		const { requireNativeModule } = require('expo-modules-core');
		this.nativeModule = requireNativeModule('ExpoWhisper');
		this.maxDurationSeconds = maxDurationSeconds;
	}

	setContextId(id: number): void {
		this.contextId = id;
	}

	async start(): Promise<void> {
		if (this.isRecording) throw new Error('Already recording');

		try {
			await this.nativeModule.startBufferRecording(this.contextId, this.maxDurationSeconds);
			this.isRecording = true;

		} catch (error) {
			console.error('[AudioRecorder] Start failed:', error);
			throw error;
		}
	}

	async stop(): Promise<Uint8Array> {
		if (!this.isRecording) throw new Error('Not recording');

		try {
			const base64Data = await this.nativeModule.stopBufferRecording(this.contextId);

			// Decode base64 to Uint8Array using native atob in React Native
			const binaryString = global.atob(base64Data);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}

			this.isRecording = false;
			return bytes;

		} catch (error) {
			console.error('[AudioRecorder] Stop failed:', error);
			this.isRecording = false;
			throw error;
		}
	}

	isCurrentlyRecording(): boolean {
		return this.isRecording;
	}
}