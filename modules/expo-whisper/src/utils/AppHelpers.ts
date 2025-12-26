/**
 * AppHelpers: Convenience wrappers for common app operations
 *
 * These functions provide simple, direct access to model management and permissions
 * by delegating to the more comprehensive ModelDownloader class and native module
 */

import { ExpoWhisper } from '../NativeModuleWrapper';
import { getModelDownloader } from './ModelDownloader';
import { getLogger } from './Logger';
import { WHISPER_MODELS } from '../types/whisper';
import type { WhisperModelSize } from '../types/whisper';

const logger = getLogger();
const downloader = getModelDownloader();

/**
 * Download a model file from HuggingFace
 * Convenience wrapper around ModelDownloader
 *
 * @param modelId The model identifier
 * @param onProgress Callback for download progress (0-1)
 * @returns Path to the downloaded model
 */
export async function downloadModel(
	modelId: WhisperModelSize,
	onProgress?: (progress: number) => void
): Promise<string> {
	try {
		await downloader.downloadModel(modelId, {
			onProgress: (progress) => {
				// Convert ModelDownloadProgress to simple 0-1 value
				const ratio = progress.percentComplete / 100;
				onProgress?.(ratio);
			},
		});
		return downloader.getModelPath(modelId);
	} catch (error) {
		logger.error('[downloadModel] Failed');
		throw error;
	}
}

/**
 * Check if a model is already downloaded
 * Convenience wrapper around ModelDownloader
 */
export async function isModelDownloaded(modelId: WhisperModelSize): Promise<boolean> {
	try {
		return await downloader.isModelDownloaded(modelId);
	} catch (error) {
		logger.warn('[isModelDownloaded] Check failed');
		return false;
	}
}

/**
 * Delete a specific model file
 * Convenience wrapper around ModelDownloader
 */
export async function deleteModel(modelId: WhisperModelSize): Promise<boolean> {
	try {
		await downloader.deleteModel(modelId);
		return true;
	} catch (error) {
		logger.error('[deleteModel] Failed to delete model');
		return false;
	}
}

/**
 * Clean all downloaded models from cache
 * Convenience wrapper around ModelDownloader
 */
export async function cleanAllModels(): Promise<void> {
	try {
		await downloader.deleteAllModels();
	} catch (error) {
		logger.error('[cleanAllModels] Failed to clean models');
		throw error;
	}
}

/**
 * Get the directory for storing downloaded models
 * Convenience wrapper around ModelDownloader
 */
export function getModelsDirectory(): string {
	return downloader.getModelsDirectory();
}

/**
 * Get the full path to a model file
 * Convenience wrapper around ModelDownloader
 */
export function getModelPath(modelId: WhisperModelSize): string {
	return downloader.getModelPath(modelId);
}

/**
 * Request microphone permission via native module
 * This delegates to the native ExpoWhisper module which handles platform-specific permission requests
 */
export async function requestMicrophonePermissions(): Promise<boolean> {
	try {
		const granted = await ExpoWhisper.requestMicrophonePermission();
		logger.info('[requestMicrophonePermissions] Permission granted:', { granted });
		return granted;
	} catch (error) {
		logger.error('[requestMicrophonePermissions] Error');
		return false;
	}
}

/**
 * Model sizes in MB for UI display
 */
export const MODEL_SIZES: Record<WhisperModelSize, number> = Object.fromEntries(
	Object.entries(WHISPER_MODELS).map(([key, model]) => [key, model.sizeInMB])
) as Record<WhisperModelSize, number>;
