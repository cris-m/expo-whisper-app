/**
 * Whisper-specific type definitions
 */

import type { LanguageCode, TimeInCentiseconds } from './common';

// Re-export for convenience
export type { LanguageCode, TimeInCentiseconds };

/**
 * Transcription result from whisper
 */
export interface TranscribeResult {
    /** Full transcribed text */
    text: string;

    /** Individual segments with timing information */
    segments: Segment[];

    /** Total audio duration in seconds */
    duration?: number;

    /** Detected language (if auto-detect was used) */
    language?: string;

    /** Time spent processing in milliseconds */
    processingTimeMs?: number;

    /** Whether transcription was aborted */
    isAborted?: boolean;

    /** Error message if transcription failed */
    error?: string;
}

/**
 * Single segment of transcription
 */
export interface Segment {
    /** Segment text */
    text: string;

    /** Start time in seconds */
    start: number;

    /** End time in seconds */
    end: number;

    /** Optional: confidence score (0-1) */
    confidence?: number;
}

/**
 * Transcription options
 */
export interface TranscribeOptions {
    /** Language code (e.g., 'en', 'es', 'auto') */
    language?: string;

    /** Temperature for sampling (0-2) */
    temperature?: number;

    /** Beam size for beam search */
    beamSize?: number;

    /** Progress callback (0-100) */
    onProgress?: (progress: number) => void;

    /** New segment callback */
    onSegment?: (segment: Segment) => void;
}

/**
 * Whisper model size identifier
 */
export type WhisperModelSize =
    | 'tiny'
    | 'tiny.en'
    | 'base'
    | 'base.en'
    | 'small'
    | 'small.en'
    | 'medium'
    | 'medium.en'
    | 'large-v1'
    | 'large-v2'
    | 'large-v3'
    | 'large-v3-turbo';

/**
 * Model capabilities
 */
export interface ModelCapabilities {
    isMultilingual: boolean;
    isQuantizable: boolean;
}

/**
 * Model metadata
 */
export interface WhisperModel {
    id: WhisperModelSize;
    label: string;
    url: string;
    filename: string;
    sizeInMB: number;
    capabilities: ModelCapabilities;
}

const HUGGINGFACE_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/**
 * Available whisper models with metadata
 */
export const WHISPER_MODELS: Record<WhisperModelSize, WhisperModel> = {
    tiny: {
        id: 'tiny',
        label: 'Tiny (Multilingual)',
        url: `${HUGGINGFACE_BASE}/ggml-tiny.bin`,
        filename: 'ggml-tiny.bin',
        sizeInMB: 75,
        capabilities: {
            isMultilingual: true,
            isQuantizable: true,
        },
    },
    'tiny.en': {
        id: 'tiny.en',
        label: 'Tiny (English)',
        url: `${HUGGINGFACE_BASE}/ggml-tiny.en.bin`,
        filename: 'ggml-tiny.en.bin',
        sizeInMB: 75,
        capabilities: {
            isMultilingual: false,
            isQuantizable: true,
        },
    },
    base: {
        id: 'base',
        label: 'Base (Multilingual)',
        url: `${HUGGINGFACE_BASE}/ggml-base.bin`,
        filename: 'ggml-base.bin',
        sizeInMB: 142,
        capabilities: {
            isMultilingual: true,
            isQuantizable: true,
        },
    },
    'base.en': {
        id: 'base.en',
        label: 'Base (English)',
        url: `${HUGGINGFACE_BASE}/ggml-base.en.bin`,
        filename: 'ggml-base.en.bin',
        sizeInMB: 142,
        capabilities: {
            isMultilingual: false,
            isQuantizable: true,
        },
    },
    small: {
        id: 'small',
        label: 'Small (Multilingual)',
        url: `${HUGGINGFACE_BASE}/ggml-small.bin`,
        filename: 'ggml-small.bin',
        sizeInMB: 466,
        capabilities: {
            isMultilingual: true,
            isQuantizable: true,
        },
    },
    'small.en': {
        id: 'small.en',
        label: 'Small (English)',
        url: `${HUGGINGFACE_BASE}/ggml-small.en.bin`,
        filename: 'ggml-small.en.bin',
        sizeInMB: 466,
        capabilities: {
            isMultilingual: false,
            isQuantizable: true,
        },
    },
    medium: {
        id: 'medium',
        label: 'Medium (Multilingual)',
        url: `${HUGGINGFACE_BASE}/ggml-medium.bin`,
        filename: 'ggml-medium.bin',
        sizeInMB: 1500,
        capabilities: {
            isMultilingual: true,
            isQuantizable: true,
        },
    },
    'medium.en': {
        id: 'medium.en',
        label: 'Medium (English)',
        url: `${HUGGINGFACE_BASE}/ggml-medium.en.bin`,
        filename: 'ggml-medium.en.bin',
        sizeInMB: 1500,
        capabilities: {
            isMultilingual: false,
            isQuantizable: true,
        },
    },
    'large-v1': {
        id: 'large-v1',
        label: 'Large v1 (Multilingual)',
        url: `${HUGGINGFACE_BASE}/ggml-large-v1.bin`,
        filename: 'ggml-large-v1.bin',
        sizeInMB: 2900,
        capabilities: {
            isMultilingual: true,
            isQuantizable: true,
        },
    },
    'large-v2': {
        id: 'large-v2',
        label: 'Large v2 (Multilingual)',
        url: `${HUGGINGFACE_BASE}/ggml-large-v2.bin`,
        filename: 'ggml-large-v2.bin',
        sizeInMB: 2900,
        capabilities: {
            isMultilingual: true,
            isQuantizable: true,
        },
    },
    'large-v3': {
        id: 'large-v3',
        label: 'Large v3 (Multilingual)',
        url: `${HUGGINGFACE_BASE}/ggml-large-v3.bin`,
        filename: 'ggml-large-v3.bin',
        sizeInMB: 3100,
        capabilities: {
            isMultilingual: true,
            isQuantizable: true,
        },
    },
    'large-v3-turbo': {
        id: 'large-v3-turbo',
        label: 'Large v3 Turbo (Multilingual)',
        url: `${HUGGINGFACE_BASE}/ggml-large-v3-turbo.bin`,
        filename: 'ggml-large-v3-turbo.bin',
        sizeInMB: 1600,
        capabilities: {
            isMultilingual: true,
            isQuantizable: true,
        },
    },
};

/**
 * Native context handle
 */
export interface NativeWhisperContext {
    contextId: number;
    gpu: boolean;
    reasonNoGPU: string;
}

/**
 * Context initialization options
 */
export interface ContextOptions {
    /** Path to model file */
    filePath: string;

    /** Enable GPU acceleration */
    useGpu?: boolean;

    /** Enable CoreML on iOS */
    useCoreMLIos?: boolean;

    /** Enable Flash Attention */
    useFlashAttn?: boolean;

    /** Number of CPU threads to use */
    nThreads?: number;
}

/**
 * Common transcription options
 */
export interface TranscribeOptionsBase {
    /** Language code (e.g., 'en', 'es', 'auto') */
    language?: LanguageCode;

    /** Whether to translate to English */
    translate?: boolean;

    /** Maximum context tokens */
    maxTokens?: number;

    /** Initial prompt for context */
    initialPrompt?: string;

    /** Temperature for sampling (0-2) */
    temperature?: number;

    /** Temperature increment for retries */
    temperatureInc?: number;

    /** Enable token-level timestamps */
    tokenTimestamps?: boolean;

    /** Suppress blank segments */
    suppressBlank?: boolean;

    /** Suppress non-speech tokens */
    suppressNst?: boolean;

    /** Sampling strategy */
    samplingStrategy?: 'greedy' | 'beamsearch';

    /** For greedy: best-of candidates */
    greedyBestOf?: number;

    /** For beam search: beam size */
    beamSearchBeamSize?: number;

    /** Enable Voice Activity Detection */
    enableVad?: boolean;

    /** VAD threshold (0-1) */
    vadThreshold?: number;
}

/**
 * Transcription-specific options
 */
export interface TranscribeFileOptions extends TranscribeOptionsBase {
    /** Progress callback (0-100) */
    onProgress?: (progress: number) => void;

    /** New segments callback */
    onSegment?: (segment: Segment) => void;

    /** Completion callback */
    onComplete?: (result: TranscribeResult) => void;

    /** Error callback */
    onError?: (error: Error) => void;

    /** Optimization mode */
    optimizationMode?: 'quality' | 'balanced' | 'latency';

    /** Enable parallel processing */
    enableParallel?: boolean;

    /** Parallel chunk size in milliseconds */
    parallelChunkSizeMs?: number;
}

/**
 * Language detection result
 */
export interface LanguageDetectionResult {
    language: LanguageCode;
    confidence: number;
    allLanguages: Array<{
        language: LanguageCode;
        confidence: number;
    }>;
}

/**
 * Parameters for whisper inference
 */
export interface WhisperParameters {
    temperature: number;
    beamSize: number;
    nProcessors: number;
    tokenTimestamps: boolean;
    translate: boolean;
    language: LanguageCode;
    initialPrompt?: string;
}

/**
 * Sampling strategy
 */
export type SamplingStrategy = 'greedy' | 'beamsearch';

/**
 * Voice Activity Detection (VAD) options
 */
export interface VadOptions {
    /** Probability threshold (0-1) */
    threshold?: number;

    /** Minimum speech duration in milliseconds */
    minSpeechDurationMs?: number;

    /** Minimum silence duration in milliseconds */
    minSilenceDurationMs?: number;

    /** Maximum speech duration in seconds */
    maxSpeechDurationS?: number;

    /** Padding around speech segments in milliseconds */
    speechPadMs?: number;

    /** Samples overlap (0-1) */
    samplesOverlap?: number;
}

/**
 * VAD segment
 */
export interface VadSegment {
    /** Start time in centiseconds */
    t0: TimeInCentiseconds;

    /** End time in centiseconds */
    t1: TimeInCentiseconds;

    /** Confidence score (0-1) */
    confidence?: number;
}

/**
 * Realtime transcription state
 */
export interface RealtimeState {
    /** Whether streaming is active */
    isStreaming: boolean;

    /** Accumulated transcribed text */
    accumulatedText: string;

    /** Accumulated segments */
    accumulatedSegments: Segment[];
}

/**
 * Single transcription task with tracking
 */
export interface TranscriptionTask {
    /** Unique task identifier */
    taskId: string;

    /** Task type */
    type: 'file' | 'buffer' | 'recording' | 'realtime';

    /** Current task status */
    status: 'queued' | 'processing' | 'complete' | 'error' | 'cancelled';

    /** Current progress (0-100) */
    progress: number;

    /** Transcription result (set when complete) */
    result?: TranscribeResult;

    /** Error (set if task failed) */
    error?: Error;

    /** Timestamp when task started */
    startTime: number;

    /** Timestamp when task ended (null if still processing) */
    endTime?: number;

    /** Cancel the task */
    cancel: () => Promise<void>;

    /** Get detailed progress information */
    getProgress: () => {
        progress: number;
        processingTimeMs: number;
        estimatedRemainingMs: number;
    };
}

/**
 * Device-specific transcription capabilities
 */
export interface TranscriptionCapabilities {
    supportsStreaming: boolean;
    supportsParallel: boolean;
    supportedSamplingStrategies: SamplingStrategy[];
    maxContextSize: number;
    maxConcurrentTranscriptions: number;
    estimatedBandwidth: number;
}
