/**
 * Audio processing and manipulation utilities
 */

import { SAMPLE_RATE, BYTES_PER_SAMPLE } from '../types/common';

/**
 * Calculate the duration of audio data in milliseconds
 */
export function calculateAudioDurationMs(byteLength: number): number {
    const samples = byteLength / BYTES_PER_SAMPLE;
    return (samples / SAMPLE_RATE) * 1000;
}

/**
 * Calculate the required buffer size for a given duration in milliseconds
 */
export function calculateBufferSizeForDuration(durationMs: number): number {
    const samples = (durationMs / 1000) * SAMPLE_RATE;
    return samples * BYTES_PER_SAMPLE;
}

/**
 * Split audio buffer into chunks of specified duration
 */
export function splitAudioIntoChunks(
    audioBuffer: Uint8Array,
    chunkDurationMs: number,
): Uint8Array[] {
    const chunkSize = calculateBufferSizeForDuration(chunkDurationMs);
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
        const chunk = audioBuffer.slice(i, Math.min(i + chunkSize, audioBuffer.length));
        chunks.push(chunk);
    }

    return chunks;
}

/**
 * Concatenate multiple audio buffers into one
 */
export function concatenateAudioBuffers(buffers: Uint8Array[]): Uint8Array {
    if (buffers.length === 0) {
        return new Uint8Array(0);
    }

    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new Uint8Array(totalLength);

    let offset = 0;
    for (const buffer of buffers) {
        result.set(buffer, offset);
        offset += buffer.length;
    }

    return result;
}

/**
 * Calculate the number of samples in audio data
 */
export function calculateSampleCount(byteLength: number): number {
    return byteLength / BYTES_PER_SAMPLE;
}

/**
 * Normalize audio samples to [-1, 1] range
 */
export function normalizeAudioSamples(samples: Float32Array): Float32Array {
    const normalized = new Float32Array(samples.length);
    let max = 0;

    // Find the maximum absolute value
    for (let i = 0; i < samples.length; i++) {
        max = Math.max(max, Math.abs(samples[i]));
    }

    // Normalize
    if (max > 0) {
        for (let i = 0; i < samples.length; i++) {
            normalized[i] = samples[i] / max;
        }
    } else {
        normalized.set(samples);
    }

    return normalized;
}

/**
 * Calculate RMS (Root Mean Square) energy of audio samples
 */
export function calculateAudioEnergy(samples: Float32Array): number {
    if (samples.length === 0) {
        return 0;
    }

    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
    }

    return Math.sqrt(sumSquares / samples.length);
}

/**
 * Detect silence in audio buffer (returns true if audio is mostly silent)
 */
export function detectSilence(
    audioBuffer: Uint8Array,
    energyThreshold: number = 0.01,
    sampleWindowMs: number = 100,
): boolean {
    // Convert to samples
    const sampleWindowSize = (sampleWindowMs / 1000) * SAMPLE_RATE * BYTES_PER_SAMPLE;
    const windowSize = Math.min(sampleWindowSize, audioBuffer.length);

    // Convert first window to samples
    const int16Array = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, windowSize / 2);
    const float32Array = new Float32Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
        const int16 = int16Array[i];
        float32Array[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
    }

    const energy = calculateAudioEnergy(float32Array);
    return energy < energyThreshold;
}

/**
 * Trim silence from the beginning and end of audio buffer
 */
export function trimSilence(
    audioBuffer: Uint8Array,
    energyThreshold: number = 0.01,
    frameSizeMs: number = 20,
): Uint8Array {
    const frameSize = (frameSizeMs / 1000) * SAMPLE_RATE * BYTES_PER_SAMPLE;
    let startIdx = 0;
    let endIdx = audioBuffer.length;

    // Find start of audio (skip silent frames at beginning)
    for (let i = 0; i < audioBuffer.length; i += frameSize) {
        const frameEnd = Math.min(i + frameSize, audioBuffer.length);
        const frame = audioBuffer.slice(i, frameEnd);

        if (!detectSilence(frame, energyThreshold)) {
            startIdx = i;
            break;
        }
    }

    // Find end of audio (skip silent frames at end)
    for (let i = audioBuffer.length - frameSize; i >= startIdx; i -= frameSize) {
        const frameStart = Math.max(0, i);
        const frame = audioBuffer.slice(frameStart, Math.min(i + frameSize, audioBuffer.length));

        if (!detectSilence(frame, energyThreshold)) {
            endIdx = Math.min(i + frameSize, audioBuffer.length);
            break;
        }
    }

    return audioBuffer.slice(startIdx, endIdx);
}

/**
 * Resample audio from one sample rate to another
 */
export function resampleAudio(
    audioBuffer: Uint8Array,
    fromSampleRate: number,
    toSampleRate: number,
): Uint8Array {
    if (fromSampleRate === toSampleRate) {
        return audioBuffer;
    }

    // Convert to int16 samples
    const int16Array = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
    const sampleCount = int16Array.length;
    const newSampleCount = Math.ceil((sampleCount * toSampleRate) / fromSampleRate);
    const newInt16Array = new Int16Array(newSampleCount);

    // Linear interpolation resampling
    for (let i = 0; i < newSampleCount; i++) {
        const originalIndex = (i * fromSampleRate) / toSampleRate;
        const lower = Math.floor(originalIndex);
        const upper = Math.ceil(originalIndex);
        const fraction = originalIndex - lower;

        if (upper >= sampleCount) {
            newInt16Array[i] = int16Array[sampleCount - 1];
        } else {
            const lowerSample = int16Array[lower];
            const upperSample = int16Array[upper];
            newInt16Array[i] = Math.round(lowerSample * (1 - fraction) + upperSample * fraction);
        }
    }

    return new Uint8Array(newInt16Array.buffer);
}

/**
 * Apply simple low-pass filter to reduce noise
 */
export function applyLowPassFilter(samples: Float32Array, cutoffFrequency: number = 3000): Float32Array {
    const SAMPLE_RATE_HZ = SAMPLE_RATE;
    const rc = 1.0 / (2.0 * Math.PI * cutoffFrequency);
    const dt = 1.0 / SAMPLE_RATE_HZ;
    const alpha = dt / (rc + dt);

    const filtered = new Float32Array(samples.length);
    filtered[0] = samples[0];

    for (let i = 1; i < samples.length; i++) {
        filtered[i] = alpha * samples[i] + (1 - alpha) * filtered[i - 1];
    }

    return filtered;
}

/**
 * Get statistics about audio buffer
 */
export function getAudioStatistics(audioBuffer: Uint8Array) {
    const int16Array = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
    const float32Array = new Float32Array(int16Array.length);

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;

    for (let i = 0; i < int16Array.length; i++) {
        const int16 = int16Array[i];
        const float32 = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
        float32Array[i] = float32;

        min = Math.min(min, float32);
        max = Math.max(max, float32);
        sum += float32;
    }

    const mean = sum / float32Array.length;
    let variance = 0;
    for (let i = 0; i < float32Array.length; i++) {
        variance += (float32Array[i] - mean) ** 2;
    }
    variance /= float32Array.length;
    const stdDev = Math.sqrt(variance);

    return {
        min,
        max,
        mean,
        stdDev,
        rms: calculateAudioEnergy(float32Array),
        durationMs: calculateAudioDurationMs(audioBuffer.length),
    };
}
