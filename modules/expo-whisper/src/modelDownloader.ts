import { Paths, File, Directory } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import type { WhisperModelSize, DownloadProgressCallback } from './ExpoWhisper.types';

const MODEL_HOST = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

// Use the new Paths API
const getModelDir = (): Directory => {
    return new Directory(Paths.document, 'whisper-models');
};

/**
 * Model file sizes in MB (approximate)
 */
export const MODEL_SIZES: Record<WhisperModelSize, number> = {
    'tiny': 75,
    'tiny.en': 75,
    'base': 142,
    'base.en': 142,
    'small': 466,
    'small.en': 466,
    'medium': 1500,
    'medium.en': 1500,
    'large-v1': 2900,
    'large-v2': 2900,
    'large-v3': 3100,
    'large-v3-turbo': 1600,
};

/**
 * Ensure the models directory exists
 */
async function ensureModelDir(): Promise<void> {
    const modelDir = getModelDir();
    if (!modelDir.exists) {
        modelDir.create();
    }
}

/**
 * Get the local path for a model
 * Returns the native file path (not URI) for use with native modules
 */
export function getModelPath(model: WhisperModelSize): string {
    const modelDir = getModelDir();
    const file = new File(modelDir, `ggml-${model}.bin`);
    // Return the path without file:// prefix for native code
    // expo-file-system File.uri returns file:// URI, but native code needs raw path
    const uri = file.uri;
    if (uri.startsWith('file://')) {
        return uri.substring(7); // Remove 'file://' prefix
    }
    return uri;
}

/**
 * Check if a model is already downloaded
 */
export async function isModelDownloaded(model: WhisperModelSize): Promise<boolean> {
    const modelDir = getModelDir();
    const modelFile = new File(modelDir, `ggml-${model}.bin`);
    return modelFile.exists;
}

/**
 * Get list of downloaded models
 */
export async function getDownloadedModels(): Promise<WhisperModelSize[]> {
    await ensureModelDir();

    const modelDir = getModelDir();
    const contents = modelDir.list();
    const models: WhisperModelSize[] = [];

    for (const item of contents) {
        if (item instanceof File) {
            const match = item.name.match(/^ggml-(.+)\.bin$/);
            if (match) {
                const modelName = match[1] as WhisperModelSize;
                if (MODEL_SIZES[modelName] !== undefined) {
                    models.push(modelName);
                }
            }
        }
    }

    return models;
}

/**
 * Download a Whisper model from HuggingFace
 */
export async function downloadModel(
    model: WhisperModelSize,
    onProgress?: DownloadProgressCallback
): Promise<string> {
    await ensureModelDir();

    const modelPath = getModelPath(model);
    const modelUrl = `${MODEL_HOST}/ggml-${model}.bin`;

    // Check if already downloaded
    const exists = await isModelDownloaded(model);
    if (exists) {
        return modelPath;
    }

    // For download, we need to use the file:// URI format
    const modelDir = getModelDir();
    const modelFile = new File(modelDir, `ggml-${model}.bin`);
    const downloadUri = modelFile.uri;

    // Use legacy API for download with progress - the new API doesn't have built-in progress
    const downloadResumable = LegacyFileSystem.createDownloadResumable(
        modelUrl,
        downloadUri,
        {},
        (downloadProgress) => {
            const progress =
                downloadProgress.totalBytesWritten /
                downloadProgress.totalBytesExpectedToWrite;
            onProgress?.(progress);
        }
    );

    try {
        const result = await downloadResumable.downloadAsync();

        if (!result || !result.uri) {
            throw new Error('Download failed - no result');
        }

        // Return the native path (without file:// prefix)
        return modelPath;
    } catch (error) {
        // Clean up partial download
        const modelFileToDelete = new File(downloadUri);
        if (modelFileToDelete.exists) {
            modelFileToDelete.delete();
        }
        throw error;
    }
}

/**
 * Delete a downloaded model
 */
export async function deleteModel(model: WhisperModelSize): Promise<void> {
    const modelDir = getModelDir();
    const modelFile = new File(modelDir, `ggml-${model}.bin`);
    if (modelFile.exists) {
        modelFile.delete();
    }
}

/**
 * Delete all downloaded models
 */
export async function deleteAllModels(): Promise<void> {
    const modelDir = getModelDir();
    if (modelDir.exists) {
        modelDir.delete();
    }
}

/**
 * Get model info (size, download status)
 */
export async function getModelInfo(model: WhisperModelSize): Promise<{
    name: WhisperModelSize;
    sizeMB: number;
    isDownloaded: boolean;
    localPath: string;
}> {
    const isDownloaded = await isModelDownloaded(model);

    return {
        name: model,
        sizeMB: MODEL_SIZES[model],
        isDownloaded,
        localPath: getModelPath(model),
    };
}
