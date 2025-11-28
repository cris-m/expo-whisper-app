import { useState, useCallback, useRef, useEffect } from 'react';
import { initWhisper, WhisperContext, releaseAllWhisper } from './ExpoWhisper';
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

export interface UseWhisperState {
	/** Whether the context is currently loading */
	isLoading: boolean;
	/** Whether currently transcribing */
	isTranscribing: boolean;
	/** Whether currently recording (realtime) */
	isRecording: boolean;
	/** Whether the context is ready */
	isReady: boolean;
	/** Current transcription result */
	transcript: string;
	/** Transcription segments with timestamps */
	segments: TranscribeResult['segments'];
	/** Any error that occurred */
	error: Error | null;
	/** Whether GPU is being used */
	isUsingGpu: boolean;
	/** Path to the loaded model file */
	modelPath: string | null;
	/** Context ID for native module operations */
	id: number | null;
}

export interface UseWhisperActions {
	/** Initialize context with model */
	initialize: (options: WhisperContextOptions) => Promise<void>;
	/** Transcribe an audio file */
	transcribeFile: (
		filePath: string,
		options?: TranscribeFileOptions
	) => Promise<TranscribeResult>;
	/** Transcribe audio from buffer (memory) */
	transcribeBuffer: (
		audioData: Uint8Array | ArrayBuffer | Float32Array,
		options?: TranscribeFileOptions
	) => Promise<TranscribeResult>;
	/** Detect language from an audio file */
	detectLanguage: (filePath: string) => Promise<LanguageDetectionResult>;
	/** Start LIVE transcription (PURE BUFFER MODE) */
	startLiveTranscription: (
		options?: ChunkedRealtimeOptions,
		onChunkComplete?: (event: ChunkedRealtimeEvent) => void
	) => Promise<RealtimeTranscriber>;
	/** Stop current transcription/recording */
	stop: () => Promise<void>;
	/** Release context and free memory */
	release: () => Promise<void>;
	/** Clear transcript */
	clearTranscript: () => void;
}

export type UseWhisperReturn = UseWhisperState & UseWhisperActions;

/**
 * React hook for using Whisper speech recognition
 */
export function useWhisper(): UseWhisperReturn {
	const contextRef = useRef<WhisperContext | null>(null);
	const stopFnRef = useRef<(() => Promise<void>) | null>(null);

	const [state, setState] = useState<UseWhisperState>({
		isLoading: false,
		isTranscribing: false,
		isRecording: false,
		isReady: false,
		transcript: '',
		segments: [],
		error: null,
		isUsingGpu: false,
		modelPath: null,
		id: null,
	});

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			contextRef.current?.release();
			contextRef.current = null;
		};
	}, []);

	const initialize = useCallback(async (options: WhisperContextOptions) => {
		setState((prev) => ({ ...prev, isLoading: true, error: null }));

		try {
			// Release previous context if exists
			if (contextRef.current) {
				await contextRef.current.release();
			}

			const context = await initWhisper(options);
			contextRef.current = context;

			setState((prev) => ({
				...prev,
				isLoading: false,
				isReady: true,
				isUsingGpu: context.gpu,
				modelPath: context.modelPath,
				id: context.id,
			}));
		} catch (error) {
			setState((prev) => ({
				...prev,
				isLoading: false,
				isReady: false,
				error: error as Error,
			}));
			throw error;
		}
	}, []);

	const transcribeFile = useCallback(
		async (
			filePath: string,
			options: TranscribeFileOptions = {}
		): Promise<TranscribeResult> => {
			if (!contextRef.current) {
				throw new Error('Whisper context not initialized');
			}

			setState((prev) => ({
				...prev,
				isTranscribing: true,
				error: null,
			}));

			try {
				const { stop, promise } = contextRef.current.transcribe(filePath, {
					...options,
					onProgress: (progress) => {
						options.onProgress?.(progress);
					},
					onNewSegments: (result) => {
						setState((prev) => ({
							...prev,
							transcript: result.result,
							segments: result.segments,
						}));
						options.onNewSegments?.(result);
					},
				});

				stopFnRef.current = stop;
				const result = await promise;

				setState((prev) => ({
					...prev,
					isTranscribing: false,
					transcript: result.result,
					segments: result.segments,
				}));

				stopFnRef.current = null;
				return result;
			} catch (error) {
				setState((prev) => ({
					...prev,
					isTranscribing: false,
					error: error as Error,
				}));
				throw error;
			}
		},
		[]
	);

	const transcribeBuffer = useCallback(
		async (
			audioData: Uint8Array | ArrayBuffer | Float32Array,
			options: TranscribeFileOptions = {}
		): Promise<TranscribeResult> => {
			if (!contextRef.current) {
				throw new Error('Whisper context not initialized');
			}

			setState((prev) => ({
				...prev,
				isTranscribing: true,
				error: null,
			}));

			try {
				// Convert to Uint8Array if needed
				let uint8Array: Uint8Array;
				if (audioData instanceof Uint8Array) {
					uint8Array = audioData;
				} else if (audioData instanceof ArrayBuffer) {
					uint8Array = new Uint8Array(audioData);
				} else if (audioData instanceof Float32Array) {
					uint8Array = new Uint8Array(audioData.buffer);
				} else {
					throw new Error('Invalid audio data type');
				}

				const { promise } = contextRef.current.transcribeBuffer(uint8Array, options);
				const result = await promise;

				setState((prev) => ({
					...prev,
					isTranscribing: false,
					transcript: result.result,
					segments: result.segments,
				}));

				return result;
			} catch (error) {
				setState((prev) => ({
					...prev,
					isTranscribing: false,
					error: error as Error,
				}));
				throw error;
			}
		},
		[]
	);

	const stop = useCallback(async () => {
		if (stopFnRef.current) {
			await stopFnRef.current();
			stopFnRef.current = null;
		}
		setState((prev) => ({
			...prev,
			isTranscribing: false,
			isRecording: false,
		}));
	}, []);

	const release = useCallback(async () => {
		await stop();
		if (contextRef.current) {
			await contextRef.current.release();
			contextRef.current = null;
		}
		setState((prev) => ({
			...prev,
			isReady: false,
			isUsingGpu: false,
			modelPath: null,
			id: null,
		}));
	}, [stop]);

	const clearTranscript = useCallback(() => {
		setState((prev) => ({
			...prev,
			transcript: '',
			segments: [],
		}));
	}, []);

	const detectLanguage = useCallback(
		async (filePath: string): Promise<LanguageDetectionResult> => {
			if (!contextRef.current) {
				throw new Error('Whisper context not initialized');
			}

			try {
				setState((prev) => ({ ...prev, isTranscribing: true, error: null }));
				const result = await contextRef.current.detectLanguage(filePath);
				setState((prev) => ({ ...prev, isTranscribing: false }));
				return result;
			} catch (error) {
				setState((prev) => ({
					...prev,
					isTranscribing: false,
					error: error as Error,
				}));
				throw error;
			}
		},
		[]
	);

	const startLiveTranscription = useCallback(
		async (
			options: ChunkedRealtimeOptions = {},
			onChunkComplete?: (event: ChunkedRealtimeEvent) => void
		): Promise<RealtimeTranscriber> => {
			if (!contextRef.current) {
				throw new Error('Whisper context not initialized');
			}

			setState(prev => ({
				...prev,
				isRecording: true,
				isTranscribing: true,
				error: null,
				transcript: '',
				segments: [],
			}));

			try {
				const transcriber = new RealtimeTranscriber(contextRef.current, options);

				stopFnRef.current = async () => {
					await transcriber.stop();
				};

				await transcriber.start((event: ChunkedRealtimeEvent) => {
				setState(prev => ({
						...prev,
						transcript: event.accumulatedTranscript,
						segments: event.allSegments,
					}));

					if (onChunkComplete) {
						try {
							onChunkComplete(event);
						} catch (error) {
						// Silently handle errors in user callback
					}
					}

					if (!event.isCapturing) {
						setState(prev => ({
							...prev,
							isRecording: false,
							isTranscribing: false,
						}));
						stopFnRef.current = null;
					}
				});

				return transcriber;
			} catch (error) {
				setState(prev => ({
					...prev,
					isRecording: false,
					isTranscribing: false,
					error: error as Error,
				}));
				throw error;
			}
		},
		[contextRef]
	);

	return {
		...state,
		initialize,
		transcribeFile,
		transcribeBuffer,
		detectLanguage,
		startLiveTranscription,
		stop,
		release,
		clearTranscript,
	};
}