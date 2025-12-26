/**
 * NativeModuleWrapper: Proper Expo Modules integration
 *
 * This file correctly uses requireNativeModule from expo-modules-core
 * to access the native ExpoWhisper module (iOS/Android)
 *
 * Pattern from: https://docs.expo.dev/modules/module-api/
 */

import { requireNativeModule, EventSubscription } from 'expo-modules-core';

/**
 * TypeScript interface for native module
 * Ensures type safety when calling native methods
 */
interface INativeWhisperModule {
	initContext(options: {
		filePath: string;
		useGpu?: boolean;
		useCoreMLIos?: boolean;
		useFlashAttn?: boolean;
		useNnapi?: boolean;
		useGpuDelegate?: boolean;
	}): Promise<{
		contextId: number;
		gpu: boolean;
		reasonNoGpu: string;
	}>;

	releaseContext(contextId: number): Promise<void>;
	releaseAllContexts(): Promise<void>;

	requestMicrophonePermission(): Promise<boolean>;
	getMicrophonePermissionStatus(): Promise<boolean>;

	transcribeFile(
		contextId: number,
		jobId: number,
		filePath: string,
		options: Record<string, any>
	): Promise<{
		text: string;
		duration: number;
		language: string;
		segments: Array<{
			text: string;
			start: number;
			end: number;
			confidence?: number;
		}>;
	}>;

	transcribeBuffer(
		contextId: number,
		jobId: number,
		audioData: string,
		options: Record<string, any>
	): Promise<{
		text: string;
		duration: number;
		language: string;
		segments: Array<{
			text: string;
			start: number;
			end: number;
			confidence?: number;
		}>;
	}>;

	startRealtimeTranscribe(
		contextId: number,
		jobId: number,
		options: Record<string, any>
	): Promise<void>;

	/**
	 * @deprecated NOT IMPLEMENTED in native module
	 * Calling this method will throw an error.
	 * Real-time transcription is PURELY event-driven:
	 * - Listen to 'onRealtimeTranscribe' for partial results
	 * - Listen to 'onRealtimeTranscribeEnd' for final results
	 * Do NOT call this method
	 */
	stopRealtimeTranscribe(
		contextId: number,
		options: Record<string, any>
	): Promise<{
		text: string;
		duration: number;
		language: string;
		segments: Array<{
			text: string;
			start: number;
			end: number;
			confidence?: number;
		}>;
	}>;

	abortTranscribe(contextId: number, jobId: number): Promise<void>;

	/**
	 * @deprecated NOT IMPLEMENTED in native module
	 * Calling this method will throw an error.
	 * Use the buffer recording API instead:
	 * startBufferRecording() → stopBufferRecording() → transcribeBuffer()
	 */
	startRecording(maxDurationSeconds?: number): Promise<{
		recording: boolean;
	}>;

	/**
	 * @deprecated NOT IMPLEMENTED in native module
	 * Calling this method will throw an error.
	 * Use the buffer recording API instead:
	 * startBufferRecording() → stopBufferRecording() → transcribeBuffer()
	 */
	stopRecording(
		contextId: number,
		options: Record<string, any>
	): Promise<{
		text: string;
		duration: number;
		language: string;
		segments: Array<{
			text: string;
			start: number;
			end: number;
			confidence?: number;
		}>;
	}>;

	startBufferRecording(
		contextId: number,
		maxDurationSeconds?: number
	): Promise<string>;

	stopBufferRecording(contextId: number): Promise<string>;

	transcribeBufferRecording(
		contextId: number,
		jobId: number,
		options: Record<string, any>
	): Promise<{
		text: string;
		duration: number;
		language: string;
		segments: Array<{
			text: string;
			start: number;
			end: number;
			confidence?: number;
		}>;
	}>;

	detectLanguage(
		contextId: number,
		filePath: string
	): Promise<{
		language: string;
		languageName: string;
		confidence: number;
	}>;

	getLibVersion(): Promise<string>;

	addListener(
		eventName: string,
		listener: (event: any) => void
	): EventSubscription;
}

/**
 * Get the native ExpoWhisper module
 *
 * The module name 'ExpoWhisper' must match the Name() declaration in native code:
 * - iOS: Name("ExpoWhisper") in ExpoWhisperModule.swift
 * - Android: Name("ExpoWhisper") in ExpoWhisperModule.kt
 *
 * @returns The native module instance
 * @throws Error if the native module cannot be loaded
 */
function getNativeModule(): INativeWhisperModule {
	try {
		return requireNativeModule<INativeWhisperModule>('ExpoWhisper');
	} catch (error) {
		console.error('[ExpoWhisper] Failed to load native module:', error);
		throw new Error(
			'[ExpoWhisper] Native module not found. Ensure ExpoWhisper is properly installed and linked.'
		);
	}
}

export const ExpoWhisper = getNativeModule();

export type { INativeWhisperModule };
