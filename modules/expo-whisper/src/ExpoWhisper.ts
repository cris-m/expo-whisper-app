import { requireNativeModule, NativeModulesProxy, EventSubscription } from 'expo-modules-core';
import type {
	WhisperContextOptions,
	TranscribeFileOptions,
	TranscribeResult,
	NativeWhisperContext,
	ChunkedRealtimeOptions,
	ChunkedRealtimeEvent,
	LanguageDetectionResult,
} from './ExpoWhisper.types';
import { RealtimeTranscriber } from './RealtimeTranscriber';

let ExpoWhisperModule: any = null;

function getModule() {
	if (!ExpoWhisperModule) {
		try {
			ExpoWhisperModule = NativeModulesProxy.ExpoWhisper;
			if (ExpoWhisperModule) return ExpoWhisperModule;
		} catch (e) {}
		
		try {
			ExpoWhisperModule = requireNativeModule('ExpoWhisper');
			if (ExpoWhisperModule) return ExpoWhisperModule;
		} catch (e) {}
		
		throw new Error('ExpoWhisper native module not found');
	}
	return ExpoWhisperModule;
}

const EVENT_ON_PROGRESS = 'onTranscribeProgress';
const EVENT_ON_NEW_SEGMENTS = 'onTranscribeNewSegments';

export class WhisperContext {
	readonly id: number;
	readonly gpu: boolean;
	readonly reasonNoGPU: string;
	readonly modelPath: string;

	constructor(nativeContext: NativeWhisperContext, modelPath: string) {
		this.id = nativeContext.contextId;
		this.gpu = nativeContext.gpu;
		this.reasonNoGPU = nativeContext.reasonNoGPU;
		this.modelPath = modelPath;
	}

	/**
	 * Get the model file path
	 */
	getModelPath(): string {
		return this.modelPath;
	}

	/**
	 * Transcribe an existing FILE
	 */
	transcribe(
		filePath: string,
		options: TranscribeFileOptions = {}
	): { stop: () => Promise<void>; promise: Promise<TranscribeResult> } {
		const jobId = Math.floor(Math.random() * 10000);
		const { onProgress, onNewSegments } = options;

		let progressSub: EventSubscription | null = null;
		let segmentsSub: EventSubscription | null = null;

		const cleanup = () => {
			progressSub?.remove();
			segmentsSub?.remove();
		};

		if (onProgress) {
			progressSub = getModule().addListener(EVENT_ON_PROGRESS, (event: any) => {
				if (event.contextId === this.id && event.jobId === jobId) {
					onProgress(event.progress);
				}
			});
		}

		if (onNewSegments) {
			segmentsSub = getModule().addListener(EVENT_ON_NEW_SEGMENTS, (event: any) => {
				if (event.contextId === this.id && event.jobId === jobId) {
					onNewSegments(event.result);
				}
			});
		}

		const promise = (async () => {
			try {
				const result = await getModule().transcribeFile(
					this.id,
					jobId,
					filePath,
					{
						...options,
						onProgress: !!onProgress,
						onNewSegments: !!onNewSegments,
					}
				);
				cleanup();
				return result;
			} catch (error) {
				cleanup();
				throw error;
			}
		})();

		return {
			stop: async () => {
				await getModule().abortTranscribe(this.id, jobId);
				cleanup();
			},
			promise,
		};
	}

	/**
	 * Transcribe raw BUFFER data
	 */
	transcribeBuffer(
		audioData: Uint8Array,
		options: TranscribeFileOptions = {}
	): { promise: Promise<TranscribeResult> } {
		const jobId = Math.floor(Math.random() * 10000);

		// Convert to base64
		const binaryString = Array.from(audioData, byte => String.fromCharCode(byte)).join('');
		const base64Data = btoa(binaryString);

		const promise = (async () => {
			const result = await getModule().transcribeBuffer(
				this.id,
				jobId,
				base64Data,
				options
			);
			return result;
		})();

		return { promise };
	}

	/**
	 * Start chunked REALTIME transcription (PURE BUFFER)
	 */
	async transcribeChunked(
		options: ChunkedRealtimeOptions = {}
	): Promise<{
		stop: () => Promise<void>;
		subscribe: (callback: (event: ChunkedRealtimeEvent) => void) => Promise<void>;
	}> {
		const transcriber = new RealtimeTranscriber(this, options);

		return {
			stop: () => transcriber.stop(),
			subscribe: async (callback: (event: ChunkedRealtimeEvent) => void) => {
				await transcriber.start(callback);
			},
		};
	}

	/**
	 * Detect language from FILE
	 */
	async detectLanguage(filePath: string): Promise<LanguageDetectionResult> {
		return getModule().detectLanguage(this.id, filePath);
	}

	/**
	 * Release context
	 */
	async release(): Promise<void> {
		return getModule().releaseContext(this.id);
	}
}

export async function initWhisper(options: WhisperContextOptions): Promise<WhisperContext> {
	const nativeContext = await getModule().initContext({
		filePath: options.filePath,
		useGpu: options.useGpu ?? true,
		useCoreMLIos: options.useCoreMLIos ?? true,
		useFlashAttn: options.useFlashAttn ?? false,
	});
	return new WhisperContext(nativeContext, options.filePath);
}

export async function releaseAllWhisper(): Promise<void> {
	return getModule().releaseAllContexts();
}

export function getLibVersion(): string {
	return getModule().getLibVersion();
}

/**
 * Request microphone permission
 */
export async function requestMicrophonePermissions(): Promise<boolean> {
	return getModule().requestMicrophonePermission();
}

/**
 * Get microphone permission status
 */
export async function getMicrophonePermissionStatus(): Promise<boolean> {
	return getModule().getMicrophonePermissionStatus();
}