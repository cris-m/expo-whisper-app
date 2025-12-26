/**
 * ErrorHandler: Manages error recovery strategies
 *
 * Responsibilities:
 * - Determine recovery strategy for different error types
 * - Implement exponential backoff for retries
 * - Circuit breaker pattern for cascading failures
 * - Error statistics and monitoring
 */

import { JobMetadata } from '../types/operations';
import { WhisperError, toWhisperError } from '../types/errors';
import { getLogger } from '../utils/Logger';

/**
 * Error recovery strategies
 */
export interface ErrorRecoveryStrategy {
    strategy: 'retry' | 'skip' | 'cancel' | 'fallback';
    maxRetries?: number;
    backoffMultiplier?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
}

/**
 * Error statistics
 */
export interface ErrorStatisticsSnapshot {
    totalErrors: number;
    errorsByType: Record<string, number>;
    retriedErrors: number;
    recoveredErrors: number;
    failedErrors: number;
    averageRetryCount: number;
    circuitBreakerOpen: boolean;
}

/**
 * ErrorHandler implementation
 */
export class ErrorHandler {
    private errorHandlers = new Map<string, (error: Error) => ErrorRecoveryStrategy>();
    private errorCount = new Map<string, number>();
    private retriedCount = new Map<string, number>();
    private recoveredCount = new Map<string, number>();
    private failedCount = new Map<string, number>();
    private totalErrors = 0;
    private circuitBreakerThreshold = 5; // Fail fast after 5 errors
    private circuitBreakerResetTimeMs = 60000; // Reset after 1 minute
    private circuitBreakerOpenTime: number | null = null;
    private circuitBreakerOpen = false;
    private logger = getLogger();

    constructor() {
        this.registerDefaultHandlers();
    }

    /**
     * Handle an error and determine recovery strategy
     */
    handle(error: Error, jobMetadata: JobMetadata): ErrorRecoveryStrategy {
        const whisperError = toWhisperError(error);
        const errorCode = 'code' in whisperError ? (whisperError as any).code : 'UNKNOWN_ERROR';

        // Track error
        this.totalErrors++;
        this.errorCount.set(errorCode, (this.errorCount.get(errorCode) ?? 0) + 1);

        // Check circuit breaker
        if (this.circuitBreakerOpen) {
            if (
                this.circuitBreakerOpenTime &&
                Date.now() - this.circuitBreakerOpenTime > this.circuitBreakerResetTimeMs
            ) {
                this.circuitBreakerOpen = false;
                this.circuitBreakerOpenTime = null;
                this.logger.info(`Circuit breaker reset`);
            } else {
                this.logger.warn(`Circuit breaker open, failing fast`, { errorCode });
                return { strategy: 'cancel' };
            }
        }

        // Check if we should open circuit breaker
        const recentErrors = this.totalErrors - 0; // In production, track sliding window
        if (recentErrors > this.circuitBreakerThreshold) {
            this.circuitBreakerOpen = true;
            this.circuitBreakerOpenTime = Date.now();
            this.logger.warn(`Circuit breaker opened due to repeated errors`, {
                totalErrors: this.totalErrors,
                threshold: this.circuitBreakerThreshold,
            });
            return { strategy: 'cancel' };
        }

        // Get registered handler or use default
        const handler = this.errorHandlers.get(errorCode) || this.getDefaultStrategy;
        const strategy = handler.call(this, whisperError);

        // Log the decision
        this.logger.info(`Error recovery strategy determined`, {
            errorCode,
            strategy: strategy.strategy,
            maxRetries: strategy.maxRetries,
        });

        return strategy;
    }

    /**
     * Check if a job should be retried
     */
    shouldRetry(jobMetadata: JobMetadata): boolean {
        return jobMetadata.retryCount < (jobMetadata.maxRetries ?? 3);
    }

    /**
     * Calculate backoff delay for retry
     */
    calculateBackoffDelay(
        retryCount: number,
        initialDelayMs: number = 1000,
        maxDelayMs: number = 60000,
    ): number {
        const exponentialDelay = initialDelayMs * Math.pow(2, retryCount);
        const jitteredDelay = exponentialDelay * (0.5 + Math.random() * 0.5); // Add jitter
        return Math.min(jitteredDelay, maxDelayMs);
    }

    /**
     * Register an error handler for specific error types
     */
    registerHandler(errorType: string, handler: (error: Error) => ErrorRecoveryStrategy): void {
        this.errorHandlers.set(errorType, handler);
        this.logger.debug(`Error handler registered`, { errorType });
    }

    /**
     * Get error statistics
     */
    getStatistics(): ErrorStatisticsSnapshot {
        const errorsByType: Record<string, number> = {};
        for (const [type, count] of this.errorCount) {
            errorsByType[type] = count;
        }

        const retriedTotal = Array.from(this.retriedCount.values()).reduce((a, b) => a + b, 0);
        const recoveredTotal = Array.from(this.recoveredCount.values()).reduce((a, b) => a + b, 0);
        const failedTotal = Array.from(this.failedCount.values()).reduce((a, b) => a + b, 0);

        return {
            totalErrors: this.totalErrors,
            errorsByType,
            retriedErrors: retriedTotal,
            recoveredErrors: recoveredTotal,
            failedErrors: failedTotal,
            averageRetryCount:
                this.totalErrors > 0 ? parseFloat(((retriedTotal + recoveredTotal) / this.totalErrors).toFixed(2)) : 0,
            circuitBreakerOpen: this.circuitBreakerOpen,
        };
    }

    /**
     * Reset statistics
     */
    resetStatistics(): void {
        this.errorCount.clear();
        this.retriedCount.clear();
        this.recoveredCount.clear();
        this.failedCount.clear();
        this.totalErrors = 0;
        this.circuitBreakerOpen = false;
        this.circuitBreakerOpenTime = null;
        this.logger.info(`Error statistics reset`);
    }

    /**
     * Private: Get default recovery strategy based on error type
     */
    private getDefaultStrategy(error: Error): ErrorRecoveryStrategy {
        const message = error.message.toLowerCase();

        // Transient errors - retry
        if (
            message.includes('timeout') ||
            message.includes('network') ||
            message.includes('connection') ||
            message.includes('temporary')
        ) {
            return {
                strategy: 'retry',
                maxRetries: 3,
                backoffMultiplier: 2,
                initialDelayMs: 1000,
                maxDelayMs: 30000,
            };
        }

        // Out of memory - cancel immediately
        if (message.includes('memory') || message.includes('oom')) {
            return {
                strategy: 'cancel',
            };
        }

        // Invalid input - skip and continue
        if (message.includes('invalid') || message.includes('malformed')) {
            return {
                strategy: 'skip',
            };
        }

        // File not found - cancel
        if (message.includes('not found') || message.includes('no such file')) {
            return {
                strategy: 'cancel',
            };
        }

        // Unknown error - try once more
        return {
            strategy: 'retry',
            maxRetries: 1,
            initialDelayMs: 500,
            maxDelayMs: 5000,
        };
    }

    /**
     * Private: Register default error handlers
     */
    private registerDefaultHandlers(): void {
        this.registerHandler('TIMEOUT_ERROR', () => ({
            strategy: 'retry',
            maxRetries: 3,
            backoffMultiplier: 2,
            initialDelayMs: 1000,
            maxDelayMs: 30000,
        }));

        this.registerHandler('NETWORK_ERROR', () => ({
            strategy: 'retry',
            maxRetries: 3,
            backoffMultiplier: 2,
            initialDelayMs: 2000,
            maxDelayMs: 60000,
        }));

        this.registerHandler('MEMORY_ERROR', () => ({
            strategy: 'cancel',
        }));

        this.registerHandler('FILE_NOT_FOUND', () => ({
            strategy: 'cancel',
        }));

        this.registerHandler('VALIDATION_ERROR', () => ({
            strategy: 'skip',
        }));

        this.registerHandler('MODEL_NOT_LOADED', () => ({
            strategy: 'retry',
            maxRetries: 1,
            initialDelayMs: 500,
        }));
    }
}

/**
 * Singleton instance
 */
let handlerInstance: ErrorHandler | null = null;

/**
 * Get or create the error handler singleton
 */
export function getErrorHandler(): ErrorHandler {
    if (!handlerInstance) {
        handlerInstance = new ErrorHandler();
    }
    return handlerInstance;
}
