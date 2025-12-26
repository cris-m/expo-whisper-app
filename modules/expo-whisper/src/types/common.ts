/**
 * Common type definitions used across the library
 */

/**
 * Unique identifier for transcription context
 */
export type ContextId = number & { readonly __brand: 'ContextId' };

/**
 * Unique identifier for transcription job
 */
export type JobId = number & { readonly __brand: 'JobId' };

/**
 * Unique identifier for streaming state
 */
export type StateId = string & { readonly __brand: 'StateId' };

/**
 * Unique identifier for transcription task
 */
export type TaskId = string & { readonly __brand: 'TaskId' };

/**
 * Unique identifier for realtime session
 */
export type SessionId = string & { readonly __brand: 'SessionId' };

/**
 * Audio sample rate in Hz
 */
export const SAMPLE_RATE = 16000;

/**
 * Bytes per audio sample (16-bit PCM)
 */
export const BYTES_PER_SAMPLE = 2;

/**
 * Audio format specification
 */
export interface AudioFormat {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
}

/**
 * Standard audio format (16kHz, mono, 16-bit PCM)
 */
export const STANDARD_AUDIO_FORMAT: AudioFormat = {
    sampleRate: SAMPLE_RATE,
    channels: 1,
    bitsPerSample: 16,
};

/**
 * Calculate duration from byte length
 */
export function calculateDurationMs(byteLength: number): number {
    const samples = byteLength / BYTES_PER_SAMPLE;
    return (samples / SAMPLE_RATE) * 1000;
}

/**
 * Calculate byte length from duration
 */
export function calculateByteLength(durationMs: number): number {
    const samples = (durationMs / 1000) * SAMPLE_RATE;
    return samples * BYTES_PER_SAMPLE;
}

/**
 * Timestamp in centiseconds (1/100th of a second)
 */
export type TimeInCentiseconds = number & { readonly __brand: 'Centiseconds' };

/**
 * Convert milliseconds to centiseconds
 */
export function msToCentiseconds(ms: number): TimeInCentiseconds {
    return (Math.round(ms / 10) as TimeInCentiseconds);
}

/**
 * Convert centiseconds to milliseconds
 */
export function centisecondsToMs(cs: TimeInCentiseconds): number {
    return cs * 10;
}

/**
 * Progress indicator (0-100)
 */
export type Progress = number & { readonly __brand: 'Progress' };

/**
 * Create validated progress value
 */
export function validateProgress(value: number): Progress {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    return clamped as Progress;
}

/**
 * Supported languages (BCP 47 format)
 */
export type LanguageCode =
    | 'auto'
    | 'en'
    | 'es'
    | 'fr'
    | 'de'
    | 'it'
    | 'ja'
    | 'zh'
    | 'ru'
    | string;

/**
 * Callback function type
 */
export type Callback<T> = (value: T) => void | Promise<void>;

/**
 * Unsubscribe function returned by event listeners
 */
export type Unsubscribe = () => void;

/**
 * Library version information
 */
export interface VersionInfo {
    library: string;
    whisperCpp: string;
    nativeModule: string;
}

/**
 * Platform-specific information
 */
export interface PlatformInfo {
    platform: 'ios' | 'android' | 'other';
    osVersion: string;
    hardwareConcurrency: number;
    totalMemory?: number;
    availableMemory?: number;
}

/**
 * Device capability information
 */
export interface DeviceCapabilities {
    supportsGPU: boolean;
    gpuType?: 'cuda' | 'metal' | 'other';
    supportsNN?: boolean;
    maxContextSize: number;
    maxConcurrentJobs: number;
}

/**
 * Optimization mode
 */
export type OptimizationMode = 'maximum-quality' | 'balanced' | 'low-latency' | 'mobile';

/**
 * Operation status
 */
export type OperationStatus =
    | 'pending'
    | 'initializing'
    | 'processing'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';

/**
 * Error severity level
 */
export type ErrorSeverity = 'warning' | 'error' | 'fatal';

/**
 * Recoverable operation result
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Helper to create success result
 */
export function ok<T>(value: T): Result<T> {
    return { ok: true, value };
}

/**
 * Helper to create error result
 */
export function err<E = Error>(error: E): Result<never, E> {
    return { ok: false, error };
}

/**
 * Metric record
 */
export interface Metric {
    name: string;
    value: number;
    unit: string;
    timestamp: number;
    tags?: Record<string, string>;
}

/**
 * Statistics snapshot
 */
export interface Statistics {
    timestamp: number;
    [key: string]: any;
}
