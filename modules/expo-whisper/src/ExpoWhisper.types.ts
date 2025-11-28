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
 * Options for initializing a Whisper context
 */
export interface WhisperContextOptions {
    /** Path to the model file */
    filePath: string;
    /** Whether to use GPU acceleration (default: true) */
    useGpu?: boolean;
    /** Whether to use CoreML on iOS (default: true) */
    useCoreMLIos?: boolean;
    /** Whether to use Flash Attention (default: false) */
    useFlashAttn?: boolean;
}

/**
 * Native context returned from initContext
 */
export interface NativeWhisperContext {
    contextId: number;
    gpu: boolean;
    reasonNoGPU: string;
}

/**
 * A transcription segment with timestamps
 */
export interface TranscribeSegment {
    /** Segment text */
    text: string;
    /** Start time in centiseconds */
    t0: number;
    /** End time in centiseconds */
    t1: number;
}

/**
 * Result of a transcription
 */
export interface TranscribeResult {
    /** Full transcription text */
    result: string;
    /** Individual segments with timestamps */
    segments: TranscribeSegment[];
    /** Whether the transcription was aborted */
    isAborted?: boolean;
}

/**
 * Options for file transcription
 */
export interface TranscribeFileOptions {
    /** Language code (e.g., 'en', 'es', 'fr') or 'auto' for detection */
    language?: string;
    /** Whether to translate to English */
    translate?: boolean;
    /** Maximum tokens per segment (0 = no limit) */
    maxTokens?: number;
    /** Progress callback (0-100) */
    onProgress?: (progress: number) => void;
    /** Callback for new segments */
    onNewSegments?: (result: TranscribeResult) => void;

    // Advanced options
    /** Initial prompt to seed the decoder for better context */
    initialPrompt?: string;
    /** Temperature for sampling (0.0 = deterministic, 1.0+ = random) */
    temperature?: number;
    /** Audio slice duration in milliseconds */
    audioSliceSec?: number;
    /** Enable token-level timestamps */
    tokenTimestamps?: boolean;
    /** Suppress blank segments */
    suppressBlank?: boolean;
    /** Suppress non-speech tokens */
    suppressNst?: boolean;
    /** Temperature increment for re-sampling fallback */
    temperatureInc?: number;
    /** Entropy threshold for compression ratio */
    entropyThold?: number;
    /** Log probability threshold */
    logprobThold?: number;
    /** No-speech probability threshold */
    noSpeechThold?: number;
    /** Sampling strategy: 'greedy' or 'beamsearch' */
    samplingStrategy?: 'greedy' | 'beamsearch';
    /** For greedy sampling: best_of candidates to sample */
    greedyBestOf?: number;
    /** For beam search: beam size */
    beamSearchBeamSize?: number;
    /** Enable Voice Activity Detection */
    enableVad?: boolean;
    /** VAD threshold (0.0-1.0) */
    vadThreshold?: number;
    /** Minimum speech duration in milliseconds */
    minSpeechDurationMs?: number;
    /** Minimum silence duration in milliseconds */
    minSilenceDurationMs?: number;
    /** Split segments on word boundaries instead of tokens */
    splitOnWord?: boolean;
}

/**
 * Options for realtime transcription
 */
export interface TranscribeRealtimeOptions {
    /** Language code (e.g., 'en', 'es', 'fr') or 'auto' for detection */
    language?: string;
    /** Whether to translate to English */
    translate?: boolean;
    /** Maximum tokens per segment */
    maxTokens?: number;
    /** Audio slice duration in ms (default: 25ms) */
    audioSliceSec?: number;
    /** VAD (Voice Activity Detection) settings */
    useVad?: boolean;

    // Advanced options (extends TranscribeFileOptions)
    /** Initial prompt to seed the decoder */
    initialPrompt?: string;
    /** Temperature for sampling (0.0 = deterministic, 1.0+ = random) */
    temperature?: number;
    /** Enable token-level timestamps */
    tokenTimestamps?: boolean;
    /** Suppress blank segments */
    suppressBlank?: boolean;
    /** Suppress non-speech tokens */
    suppressNst?: boolean;
    /** Temperature increment for re-sampling fallback */
    temperatureInc?: number;
    /** Entropy threshold for compression ratio */
    entropyThold?: number;
    /** No-speech probability threshold */
    noSpeechThold?: number;
    /** Sampling strategy: 'greedy' or 'beamsearch' */
    samplingStrategy?: 'greedy' | 'beamsearch';
    /** For greedy sampling: best_of candidates */
    greedyBestOf?: number;
    /** For beam search: beam size */
    beamSearchBeamSize?: number;
    /** Enable Voice Activity Detection */
    enableVad?: boolean;
    /** VAD threshold (0.0-1.0) */
    vadThreshold?: number;
    /** Minimum speech duration in milliseconds */
    minSpeechDurationMs?: number;
    /** Minimum silence duration in milliseconds */
    minSilenceDurationMs?: number;
}

/**
 * Event from realtime transcription
 */
export interface TranscribeRealtimeEvent {
    contextId: number;
    jobId: number;
    /** Whether audio is being captured */
    isCapturing?: boolean;
    /** Whether transcription is in progress */
    isTranscribing?: boolean;
    /** Current transcription data */
    data?: TranscribeResult;
    /** Error message if any */
    error?: string;
    /** Processing time in ms */
    processTime?: number;
    /** Recording time in ms */
    recordingTime?: number;
}

/**
 * Callback for download progress
 */
export type DownloadProgressCallback = (progress: number) => void;

/**
 * Options for chunked real-time transcription (PURE BUFFER MODE)
 */
export interface ChunkedRealtimeOptions extends TranscribeRealtimeOptions {
    /** Chunk duration in milliseconds (default: 15000 = 15 seconds) */
    chunkDurationMs?: number;
}

/**
 * Result of processing a single chunk
 */
export interface ChunkResult {
    /** Index of this chunk (0-based) */
    chunkIndex: number;
    /** Start time in milliseconds from recording start */
    startTime: number;
    /** End time in milliseconds from recording start */
    endTime: number;
    /** Duration of chunk in milliseconds */
    duration: number;
    /** Transcription of this chunk */
    transcript: string;
    /** Word-level segments with timestamps */
    segments: TranscribeSegment[];
    /** Time taken to transcribe this chunk in milliseconds */
    processTime: number;
}

/**
 * Event from chunked real-time transcription
 */
export interface ChunkedRealtimeEvent {
    contextId: number;
    jobId: number;
    /** Current chunk result */
    chunk?: ChunkResult;
    /** Accumulated transcript from all chunks so far */
    accumulatedTranscript: string;
    /** All segments from all chunks processed so far */
    allSegments: TranscribeSegment[];
    /** Whether audio is being captured */
    isCapturing?: boolean;
    /** Whether a chunk is currently being processed */
    isProcessing?: boolean;
    /** Current chunk index being processed */
    currentChunkIndex: number;
    /** Progress within current chunk (0-100) */
    chunkProgress: number;
    /** Error message if any */
    error?: string;
}

/**
 * Language detection result
 */
export interface LanguageDetectionResult {
    /** Detected language code (e.g., 'en', 'es', 'fr') */
    language: string;
    /** Confidence score (0-1) */
    confidence: number;
    /** Full language name */
    languageName: string;
}
