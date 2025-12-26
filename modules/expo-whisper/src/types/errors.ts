/**
 * Error types and custom error classes
 */

import { ErrorSeverity, Result } from './common';

/**
 * Base error information
 */
export interface ErrorInfo {
    code: string;
    message: string;
    severity: ErrorSeverity;
    timestamp: number;
    context?: Record<string, any>;
}

/**
 * Custom error class with structured information
 */
export class WhisperError extends Error implements ErrorInfo {
    code: string;
    severity: ErrorSeverity;
    timestamp: number;
    context?: Record<string, any>;

    constructor(
        code: string,
        message: string,
        severity: ErrorSeverity = 'error',
        context?: Record<string, any>,
    ) {
        super(message);
        this.name = 'WhisperError';
        this.code = code;
        this.severity = severity;
        this.timestamp = Date.now();
        this.context = context;
        Object.setPrototypeOf(this, WhisperError.prototype);
    }
}

/**
 * Validation error
 */
export class ValidationError extends WhisperError {
    constructor(message: string, context?: Record<string, any>) {
        super('VALIDATION_ERROR', message, 'error', context);
        this.name = 'ValidationError';
    }
}

/**
 * File not found error
 */
export class FileNotFoundError extends WhisperError {
    constructor(filePath: string) {
        super('FILE_NOT_FOUND', `File not found: ${filePath}`, 'error', { filePath });
        this.name = 'FileNotFoundError';
    }
}

/**
 * Model not loaded error
 */
export class ModelNotLoadedError extends WhisperError {
    constructor(modelSize: string) {
        super('MODEL_NOT_LOADED', `Model not loaded: ${modelSize}`, 'error', { modelSize });
        this.name = 'ModelNotLoadedError';
    }
}

/**
 * Transcription failed error
 */
export class TranscriptionError extends WhisperError {
    constructor(message: string, context?: Record<string, any>) {
        super('TRANSCRIPTION_ERROR', message, 'error', context);
        this.name = 'TranscriptionError';
    }
}

/**
 * Streaming error
 */
export class StreamingError extends WhisperError {
    constructor(message: string, context?: Record<string, any>) {
        super('STREAMING_ERROR', message, 'error', context);
        this.name = 'StreamingError';
    }
}

/**
 * Context pool error
 */
export class ContextPoolError extends WhisperError {
    constructor(message: string, context?: Record<string, any>) {
        super('CONTEXT_POOL_ERROR', message, 'error', context);
        this.name = 'ContextPoolError';
    }
}

/**
 * Job coordinator error
 */
export class JobCoordinatorError extends WhisperError {
    constructor(message: string, jobId?: number | string, context?: Record<string, any>) {
        super('JOB_COORDINATOR_ERROR', message, 'error', { jobId, ...context });
        this.name = 'JobCoordinatorError';
    }
}

/**
 * Operation timeout error
 */
export class TimeoutError extends WhisperError {
    constructor(operation: string, timeoutMs: number) {
        super(
            'TIMEOUT_ERROR',
            `Operation '${operation}' timed out after ${timeoutMs}ms`,
            'error',
            { operation, timeoutMs },
        );
        this.name = 'TimeoutError';
    }
}

/**
 * Cancellation error
 */
export class CancellationError extends WhisperError {
    constructor(operation: string) {
        super('CANCELLATION_ERROR', `Operation '${operation}' was cancelled`, 'warning', { operation });
        this.name = 'CancellationError';
    }
}

/**
 * Memory error
 */
export class MemoryError extends WhisperError {
    constructor(requiredMb: number, availableMb: number) {
        super(
            'MEMORY_ERROR',
            `Insufficient memory. Required: ${requiredMb}MB, Available: ${availableMb}MB`,
            'fatal',
            { requiredMb, availableMb },
        );
        this.name = 'MemoryError';
    }
}

/**
 * Native module error
 */
export class NativeModuleError extends WhisperError {
    constructor(message: string, context?: Record<string, any>) {
        super('NATIVE_MODULE_ERROR', message, 'error', context);
        this.name = 'NativeModuleError';
    }
}

/**
 * Recovery error
 */
export class RecoveryError extends WhisperError {
    constructor(message: string, originalError: Error, context?: Record<string, any>) {
        super('RECOVERY_ERROR', message, 'error', { originalError: originalError.message, ...context });
        this.name = 'RecoveryError';
    }
}

/**
 * Error handler type
 */
export type ErrorHandler = (error: Error) => void;

/**
 * Error recovery handler type
 */
export type ErrorRecoveryHandler = (error: Error) => Promise<boolean>;

/**
 * Type guard to check if error is a WhisperError
 */
export function isWhisperError(error: any): error is WhisperError {
    return error instanceof WhisperError;
}

/**
 * Type guard to check if error is a specific WhisperError type
 */
export function isErrorCode(error: any, code: string): error is WhisperError {
    return isWhisperError(error) && error.code === code;
}

/**
 * Convert any error to WhisperError
 */
export function toWhisperError(error: any, context?: Record<string, any>): WhisperError {
    if (isWhisperError(error)) {
        return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    return new WhisperError('UNKNOWN_ERROR', message, 'error', context);
}

/**
 * Safe error handler that catches and logs errors
 */
export function safeErrorHandler(
    handler: ErrorHandler,
    fallback?: (error: Error) => void,
): ErrorHandler {
    return (error: Error) => {
        try {
            handler(error);
        } catch (handlerError) {
            if (fallback) {
                fallback(handlerError instanceof Error ? handlerError : new Error(String(handlerError)));
            }
        }
    };
}

/**
 * Error recovery with retry logic
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000,
): Promise<Result<T>> {
    let lastError: Error | undefined;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const result = await operation();
            return { ok: true, value: result };
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (i < maxRetries - 1) {
                // Wait before retrying (exponential backoff)
                const delay = delayMs * Math.pow(2, i);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    return {
        ok: false,
        error: lastError || new Error('Operation failed after retries'),
    };
}
