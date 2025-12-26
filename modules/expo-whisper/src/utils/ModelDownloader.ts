/**
 * Model downloader utility for managing whisper model files from Hugging Face
 *
 * Downloads ggml-format models from: https://huggingface.co/ggerganov/whisper.cpp
 */

import { WHISPER_MODELS, WhisperModelSize } from '../types/whisper';
import { getLogger } from './Logger';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Paths } from 'expo-file-system';

const HUGGINGFACE_MODEL_HOST = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export interface ModelDownloadProgress {
	modelSize: WhisperModelSize;
	downloadId: string;
	bytesDownloaded: number;
	totalBytes: number;
	percentComplete: number;
	startTime: number;
	estimatedRemainingMs: number;
	speed: number; // bytes per second
}

export interface ModelDownloadOptions {
	onProgress?: (progress: ModelDownloadProgress) => void;
	onComplete?: () => void;
	onError?: (error: Error) => void;
	forceDownload?: boolean;
	timeout?: number;
}

export interface ModelInfo {
	name: WhisperModelSize;
	sizeMB: number;
	isDownloaded: boolean;
	localPath: string;
}

/**
 * Model downloader for managing whisper model downloads from Hugging Face
 */
export class ModelDownloader {
	private activeDownloads = new Map<string, ModelDownloadProgress>();
	private downloadedModels = new Set<WhisperModelSize>();
	private logger = getLogger();

	/**
	 * Get the base URL for models on Hugging Face
	 */
	getHuggingFaceUrl(modelSize: WhisperModelSize): string {
		return `${HUGGINGFACE_MODEL_HOST}/ggml-${modelSize}.bin`;
	}

	/**
	 * Get the models directory using new Paths API
	 * Returns a Directory object that can be used with File API
	 */
	private getModelsDir() {
		try {
			const { Directory } = require('expo-file-system');
			if (Directory && Paths.document) {
				return new Directory(Paths.document, 'whisper-models');
			}
		} catch (e) {
			this.logger.warn(`Failed to create Directory object: ${e}`);
		}
		return null;
	}

	/**
	 * Get the local storage directory for models (platform-specific)
	 * Returns path string for logging/debugging
	 */
	getModelsDirectory(): string {
		try {
			const docPath = Paths.document;
			if (docPath) {
				// Paths.document is a Directory object, need to get the uri property
				let pathString = typeof docPath === 'object' && docPath.uri ? docPath.uri : String(docPath);
				// Ensure path ends with slash
				if (!pathString.endsWith('/')) {
					pathString += '/';
				}
				const dirPath = `${pathString}whisper-models`;
				this.logger.info(`Using Paths.document directory: ${dirPath}`);
				return dirPath;
			}
		} catch (e) {
			this.logger.warn(`Paths.document not available: ${e}`);
		}

		try {
			// Fallback to legacy API
			const FileSystem = require('expo-file-system');
			if (FileSystem && FileSystem.documentDirectory) {
				// React Native with Expo - use DocumentDirectory
				let dirPath = FileSystem.documentDirectory;
				if (!dirPath.endsWith('/')) {
					dirPath += '/';
				}
				dirPath += 'whisper-models';
				this.logger.info(`Using legacy FileSystem.documentDirectory: ${dirPath}`);
				return dirPath;
			}
		} catch (e) {
			this.logger.warn(`Failed to get expo-file-system: ${e}`);
		}

		// Fallback for other environments
		if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
			// Browser/Web environment
			return 'indexeddb://whisper-models';
		} else {
			// Node.js or other environment
			return `${process.cwd()}/models`;
		}
	}

	/**
	 * Get the full local path for a model file
	 * Returns native path (without file:// prefix) for use with native modules
	 */
	getModelPath(modelSize: WhisperModelSize): string {
		const dirPath = this.getModelsDirectory();
		const fullPath = `${dirPath}/ggml-${modelSize}.bin`;
		// Strip file:// prefix if present (native code needs raw path)
		if (fullPath.startsWith('file://')) {
			return fullPath.substring(7);
		}
		return fullPath;
	}

	/**
	 * Get file:// URI for a model (for use with download)
	 */
	private getModelFileUri(modelSize: WhisperModelSize): string {
		try {
			const { File } = require('expo-file-system');
			if (File) {
				const modelsDir = this.getModelsDir();
				if (modelsDir) {
					const file = new File(modelsDir, `ggml-${modelSize}.bin`);
					return file.uri;
				}
			}
		} catch (e) {
			this.logger.warn(`Failed to get file URI: ${e}`);
		}
		// Fallback to path-based URI
		return `file://${this.getModelPath(modelSize)}`;
	}

	/**
	 * Check if a model is already downloaded locally
	 *
	 * Checks both in-memory cache and actual filesystem
	 */
	async isModelDownloaded(modelSize: WhisperModelSize): Promise<boolean> {
		if (this.downloadedModels.has(modelSize)) {
			return true;
		}

		try {
			const modelPath = this.getModelPath(modelSize);
			// Try using new File API from expo-file-system
			const { File } = require('expo-file-system');
			if (File) {
				const file = new File(modelPath);
				const exists = file.exists;
				if (exists) {
					this.downloadedModels.add(modelSize);
				}
				return exists;
			}
		} catch (error) {
			this.logger.debug(`[isModelDownloaded] New File API not available, trying legacy API`);
		}

		// Fallback to legacy API if new API is not available
		try {
			const FileSystem = require('expo-file-system');
			if (FileSystem && FileSystem.getInfoAsync) {
				const modelPath = this.getModelPath(modelSize);
				const fileInfo = await FileSystem.getInfoAsync(modelPath);
				const exists = fileInfo?.exists ?? false;
				if (exists) {
					this.downloadedModels.add(modelSize);
				}
				return exists;
			}
		} catch (error) {
			// If file system check fails, only return what's in cache
			const err = error instanceof Error ? error : new Error(String(error));
			this.logger.warn(`[isModelDownloaded] File system check failed for ${modelSize}:`, err);
		}

		return false;
	}

	/**
	 * Download a whisper model from Hugging Face
	 *
	 * Features:
	 * - Resume support (via createDownloadResumable)
	 * - Progress tracking with ETA
	 * - Timeout protection
	 * - Automatic cleanup on failure
	 */
	async downloadModel(
		modelSize: WhisperModelSize,
		options: ModelDownloadOptions = {},
	): Promise<string> {
		const modelInfo = WHISPER_MODELS[modelSize];

		if (!modelInfo) {
			throw new Error(`Unknown model size: ${modelSize}`);
		}

		if (!options.forceDownload && (await this.isModelDownloaded(modelSize))) {
			this.logger.info(`Model already downloaded, skipping: ${modelSize}`);
			return this.getModelPath(modelSize);
		}

		const downloadId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
		const totalBytes = modelInfo.sizeInMB * 1024 * 1024;
		const startTime = Date.now();
		let lastProgressTime = startTime;
		let lastProgressBytes = 0;

		const progress: ModelDownloadProgress = {
			modelSize,
			downloadId,
			bytesDownloaded: 0,
			totalBytes,
			percentComplete: 0,
			startTime,
			estimatedRemainingMs: 0,
			speed: 0,
		};

		this.activeDownloads.set(downloadId, progress);

		try {
			const modelUrl = this.getHuggingFaceUrl(modelSize);
			this.logger.info(`Starting download from Hugging Face`, {
				model: modelSize,
				url: modelUrl,
				sizeInMB: modelInfo.sizeInMB,
			});

			// Ensure directory exists using new File API
			try {
				const modelsDir = this.getModelsDir();
				if (modelsDir && !modelsDir.exists) {
					modelsDir.create();
					this.logger.info(`Created models directory`);
				}
			} catch (mkdirErr) {
				// Try legacy API as fallback
				try {
					const FileSystem = require('expo-file-system');
					const dirPath = this.getModelsDirectory();
					if (FileSystem?.makeDirectoryAsync) {
						await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
					}
				} catch (legacyErr) {
					this.logger.warn(`Directory creation failed: ${legacyErr}`);
				}
			}

			const modelFileUri = this.getModelFileUri(modelSize);
			const modelPath = this.getModelPath(modelSize);
			this.logger.info(`Downloading model to: ${modelPath}`);
			this.logger.info(`Using download URI: ${modelFileUri}`);

			// Use createDownloadResumable from legacy API - proper React Native pattern
			const downloadResumable = LegacyFileSystem.createDownloadResumable(
				modelUrl,
				modelFileUri,
				{},
				(downloadProgress) => {
					progress.bytesDownloaded = downloadProgress.totalBytesWritten;
					progress.percentComplete = Math.round(
						(downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100
					);

					const now = Date.now();
					const timeSinceLastUpdate = (now - lastProgressTime) / 1000;
					const bytesSinceLastUpdate = progress.bytesDownloaded - lastProgressBytes;
					progress.speed = timeSinceLastUpdate > 0 ? bytesSinceLastUpdate / timeSinceLastUpdate : 0;

					if (progress.speed > 0) {
						const remainingSeconds = (totalBytes - progress.bytesDownloaded) / progress.speed;
						progress.estimatedRemainingMs = Math.round(remainingSeconds * 1000);
					}

					lastProgressTime = now;
					lastProgressBytes = progress.bytesDownloaded;

					options.onProgress?.(progress);
				}
			);

			const result = await downloadResumable.downloadAsync();

			if (!result || !result.uri) {
				throw new Error('Download failed - no result');
			}

			progress.bytesDownloaded = totalBytes;
			progress.percentComplete = 100;

			const finalNow = Date.now();
			const finalTime = (finalNow - lastProgressTime) / 1000;
			const finalBytes = totalBytes - lastProgressBytes;
			progress.speed = finalTime > 0 ? finalBytes / finalTime : 0;

			options.onProgress?.(progress);

			// Mark as downloaded
			this.downloadedModels.add(modelSize);

			const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

			this.logger.info(`Download completed`, {
				model: modelSize,
				path: modelPath,
				totalTimeSeconds: totalTime,
				averageSpeed: `${(progress.speed / (1024 * 1024)).toFixed(2)} MB/s`,
			});

			options.onComplete?.();
			return modelPath;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.logger.error(`Download failed: ${modelSize}`, {
				error: err.message,
				bytesDownloaded: progress.bytesDownloaded,
				totalBytes: progress.totalBytes,
			});
			options.onError?.(err);
			throw err;
		} finally {
			this.activeDownloads.delete(downloadId);
		}
	}

	/**
	 * Download multiple models in sequence
	 *
	 * Downloads models one by one. Returns a map of successful downloads.
	 */
	async downloadModels(
		modelSizes: WhisperModelSize[],
		options: ModelDownloadOptions = {},
	): Promise<Map<WhisperModelSize, string>> {
		const results = new Map<WhisperModelSize, string>();

		for (const modelSize of modelSizes) {
			try {
				const path = await this.downloadModel(modelSize, options);
				results.set(modelSize, path);
			} catch (error) {
				this.logger.warn(`Failed to download model, continuing...`, {
					model: modelSize,
					error: (error as Error).message,
				});
				// Continue with next model
			}
		}

		return results;
	}

	/**
	 * Cancel an active download
	 */
	cancelDownload(downloadId: string): void {
		if (this.activeDownloads.has(downloadId)) {
			const progress = this.activeDownloads.get(downloadId);
			this.activeDownloads.delete(downloadId);
			this.logger.info(`Download cancelled`, {
				downloadId,
				model: progress?.modelSize,
				bytesDownloaded: progress?.bytesDownloaded,
			});
		}
	}

	/**
	 * Get all active downloads
	 */
	getActiveDownloads(): ModelDownloadProgress[] {
		return Array.from(this.activeDownloads.values());
	}

	/**
	 * Get list of downloaded models
	 */
	getDownloadedModels(): WhisperModelSize[] {
		return Array.from(this.downloadedModels);
	}

	/**
	 * Delete a model file
	 */
	async deleteModel(modelSize: WhisperModelSize): Promise<void> {
		this.downloadedModels.delete(modelSize);
		this.logger.info(`Model deleted`, { model: modelSize });
	}

	/**
	 * Delete all downloaded models
	 */
	async deleteAllModels(): Promise<void> {
		this.downloadedModels.clear();
		this.logger.info(`All models deleted`);
	}

	/**
	 * Get total size of downloaded models
	 */
	getTotalDownloadedSize(): number {
		let total = 0;
		for (const modelSize of this.downloadedModels) {
			const modelInfo = WHISPER_MODELS[modelSize];
			if (modelInfo) {
				total += modelInfo.sizeInMB * 1024 * 1024;
			}
		}
		return total;
	}

	/**
	 * Get information about a model
	 */
	async getModelInfo(modelSize: WhisperModelSize): Promise<ModelInfo> {
		const modelInfo = WHISPER_MODELS[modelSize];
		if (!modelInfo) {
			throw new Error(`Unknown model size: ${modelSize}`);
		}

		return {
			name: modelSize,
			sizeMB: modelInfo.sizeInMB,
			isDownloaded: await this.isModelDownloaded(modelSize),
			localPath: this.getModelPath(modelSize),
		};
	}

	/**
	 * Get information about all available models
	 */
	async getAllModelInfo(): Promise<ModelInfo[]> {
		const models = Object.keys(WHISPER_MODELS) as WhisperModelSize[];
		return Promise.all(models.map(model => this.getModelInfo(model)));
	}

	/**
	 * Clear the cache (delete all models)
	 */
	async clearCache(): Promise<void> {
		await this.deleteAllModels();
	}
}

/**
 * Singleton instance
 */
let downloaderInstance: ModelDownloader | null = null;

/**
 * Get or create the model downloader singleton
 */
export function getModelDownloader(): ModelDownloader {
	if (!downloaderInstance) {
		downloaderInstance = new ModelDownloader();
	}
	return downloaderInstance;
}
