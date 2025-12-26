/**
 * Input validation utilities
 */

import { WhisperModelSize, WHISPER_MODELS, LanguageCode } from '../types/whisper';
import { Progress } from '../types/common';

/**
 * Validate that a file path is provided
 */
export function validateFilePath(filePath: string | undefined): string {
	if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
		throw new Error('Invalid file path: must be a non-empty string');
	}
	return filePath;
}

/**
 * Validate that audio buffer is provided and has correct format
 */
export function validateAudioBuffer(buffer: Uint8Array | undefined): Uint8Array {
	if (!buffer || !(buffer instanceof Uint8Array)) {
		throw new Error('Invalid audio buffer: must be a Uint8Array');
	}
	if (buffer.length === 0) {
		throw new Error('Invalid audio buffer: cannot be empty');
	}
	if (buffer.length % 2 !== 0) {
		throw new Error('Invalid audio buffer: length must be even (16-bit PCM requires pairs of bytes)');
	}
	return buffer;
}

/**
 * Validate that model size is supported
 */
export function validateModelSize(modelSize: string | undefined): WhisperModelSize {
	if (!modelSize || typeof modelSize !== 'string') {
		throw new Error('Invalid model size: must be a string');
	}
	if (!WHISPER_MODELS[modelSize as WhisperModelSize]) {
		const supported = Object.keys(WHISPER_MODELS).join(', ');
		throw new Error(`Invalid model size: '${modelSize}' is not supported. Supported models: ${supported}`);
	}
	return modelSize as WhisperModelSize;
}

/**
 * Validate that language code is valid
 */
export function validateLanguageCode(language: string | undefined): LanguageCode | undefined {
	if (language === undefined || language === null || language === '') {
		return undefined;
	}
	if (typeof language !== 'string') {
		throw new Error('Invalid language code: must be a string');
	}
	// Language codes should be 2-5 characters (e.g., 'en', 'fr', 'zh-CN')
	if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)) {
		throw new Error(`Invalid language code: '${language}' does not match expected format (e.g., 'en', 'fr', 'zh-CN')`);
	}
	return language as LanguageCode;
}

/**
 * Validate that progress is within 0-100 range
 */
export function validateProgress(progress: number | undefined): Progress {
	if (progress === undefined || progress === null) {
		throw new Error('Invalid progress: must be a number');
	}
	if (typeof progress !== 'number') {
		throw new Error('Invalid progress: must be a number');
	}
	if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
		throw new Error(`Invalid progress: must be an integer between 0 and 100, got ${progress}`);
	}
	return progress as Progress;
}

/**
 * Validate that a timeout value is reasonable
 */
export function validateTimeout(timeoutMs: number | undefined, minMs: number = 1000, maxMs: number = 3600000): number {
	if (timeoutMs === undefined) {
		return maxMs;
	}
	if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
		throw new Error('Invalid timeout: must be a finite number');
	}
	if (timeoutMs < minMs || timeoutMs > maxMs) {
		throw new Error(`Invalid timeout: must be between ${minMs}ms and ${maxMs}ms, got ${timeoutMs}ms`);
	}
	return timeoutMs;
}

/**
 * Validate that a callback function is provided (if required)
 */
export function validateCallback<T extends (...args: any[]) => any>(
	callback: T | undefined,
	required: boolean = false,
): T | undefined {
	if (callback && typeof callback !== 'function') {
		throw new Error('Invalid callback: must be a function');
	}
	if (required && !callback) {
		throw new Error('Callback is required');
	}
	return callback;
}

/**
 * Validate object structure
 */
export function validateObject(obj: any, expectedKeys?: string[]): object {
	if (obj === null || typeof obj !== 'object') {
		throw new Error('Invalid object: must be an object');
	}
	if (expectedKeys && expectedKeys.length > 0) {
		const actualKeys = Object.keys(obj);
		const missingKeys = expectedKeys.filter(key => !actualKeys.includes(key));
		if (missingKeys.length > 0) {
			throw new Error(`Invalid object: missing required keys: ${missingKeys.join(', ')}`);
		}
	}
	return obj;
}

/**
 * Validate that a value is a positive number
 */
export function validatePositiveNumber(value: number | undefined, fieldName: string = 'value'): number {
	if (value === undefined || value === null) {
		throw new Error(`Invalid ${fieldName}: must be a number`);
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`Invalid ${fieldName}: must be a finite number`);
	}
	if (value <= 0) {
		throw new Error(`Invalid ${fieldName}: must be positive, got ${value}`);
	}
	return value;
}

/**
 * Validate that a value is in a set of allowed values
 */
export function validateEnum<T extends string>(
	value: string | undefined,
	allowedValues: readonly T[],
	fieldName: string = 'value',
): T {
	if (!value || typeof value !== 'string') {
		throw new Error(`Invalid ${fieldName}: must be a non-empty string`);
	}
	if (!allowedValues.includes(value as T)) {
		throw new Error(
			`Invalid ${fieldName}: '${value}' is not allowed. Must be one of: ${allowedValues.join(', ')}`,
		);
	}
	return value as T;
}

/**
 * Safe parse JSON with validation
 */
export function validateJSON<T = any>(jsonString: string | undefined, fieldName: string = 'JSON'): T {
	if (!jsonString || typeof jsonString !== 'string') {
		throw new Error(`Invalid ${fieldName}: must be a non-empty string`);
	}
	try {
		return JSON.parse(jsonString) as T;
	} catch (error) {
		throw new Error(`Invalid ${fieldName}: failed to parse as JSON - ${(error as Error).message}`);
	}
}
