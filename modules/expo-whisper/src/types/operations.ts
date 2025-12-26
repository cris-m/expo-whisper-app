/**
 * Operations layer type definitions for job coordination and context pooling
 */

import { JobId, ContextId, StateId, TaskId, SessionId, OperationStatus, Progress } from './common';
import { TranscribeResult, TranscribeFileOptions, Segment } from './whisper';

/**
 * Job-level callbacks for transcription tasks
 */
export interface JobCallbacks {
    onProgress: (progress: Progress) => void;
    onSegment: (segment: Segment) => void;
    onComplete: (result: TranscribeResult) => void;
    onError: (error: Error) => void;
}

/**
 * Job metadata and tracking information
 */
export interface JobMetadata {
    jobId: JobId;
    taskId: TaskId;
    type: 'file' | 'buffer' | 'stream' | 'realtime';
    status: OperationStatus;
    progress: Progress;
    startTime: number;
    endTime?: number;
    estimatedDurationMs?: number;
    contextId?: ContextId;
    stateId?: StateId;
    retryCount: number;
    maxRetries: number;
}

/**
 * Job coordinator interface for tracking and managing jobs
 */
export interface IJobCoordinator {
    /**
     * Register a new job with callbacks
     */
    registerJob(
        jobId: JobId,
        taskId: TaskId,
        type: 'file' | 'buffer' | 'stream' | 'realtime',
        callbacks: Partial<JobCallbacks>,
    ): void;

    /**
     * Unregister a job and clean up
     */
    unregisterJob(jobId: JobId): void;

    /**
     * Get callbacks for a job
     */
    getCallbacks(jobId: JobId): Partial<JobCallbacks> | undefined;

    /**
     * Get metadata for a job
     */
    getMetadata(jobId: JobId): JobMetadata | undefined;

    /**
     * Update job status
     */
    updateJobStatus(jobId: JobId, status: OperationStatus, progress?: Progress): void;

    /**
     * Report progress for a job
     */
    reportProgress(jobId: JobId, progress: Progress): void;

    /**
     * Report a segment for a job
     */
    reportSegment(jobId: JobId, segment: Segment): void;

    /**
     * Report completion for a job
     */
    reportCompletion(jobId: JobId, result: TranscribeResult): void;

    /**
     * Report an error for a job
     */
    reportError(jobId: JobId, error: Error): void;

    /**
     * Get all active jobs
     */
    getActiveJobs(): JobId[];

    /**
     * Get all jobs with a specific status
     */
    getJobsByStatus(status: OperationStatus): JobId[];

    /**
     * Cancel a job
     */
    cancelJob(jobId: JobId): void;

    /**
     * Check if a job is cancelled
     */
    isJobCancelled(jobId: JobId): boolean;

    /**
     * Get job statistics
     */
    getStatistics(): JobStatistics;

    /**
     * Clear all jobs
     */
    clearJobs(): void;
}

/**
 * Job statistics
 */
export interface JobStatistics {
    totalJobs: number;
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    cancelledJobs: number;
    averageProcessingTimeMs: number;
    averageRetries: number;
    successRate: number;
}

/**
 * Whisper context (encoder state) for streaming operations
 */
export interface WhisperContext {
    contextId: ContextId;
    modelSize: string;
    state?: any; // whisper_state from C++ layer (opaque)
    createdAt: number;
    lastAccessedAt: number;
    accessCount: number;
    isInUse: boolean;
}

/**
 * Context pool interface for managing reusable contexts
 */
export interface IContextPool {
    /**
     * Acquire a context from the pool, creating one if needed
     */
    acquireContext(modelSize: string): Promise<WhisperContext>;

    /**
     * Release a context back to the pool
     */
    releaseContext(contextId: ContextId): void;

    /**
     * Get a context if it exists and is available
     */
    getContext(contextId: ContextId): WhisperContext | undefined;

    /**
     * Reuse a context (increment access count and update last accessed time)
     */
    reuseContext(contextId: ContextId): void;

    /**
     * Invalidate a context and remove from pool
     */
    invalidateContext(contextId: ContextId): void;

    /**
     * Get all contexts for a specific model
     */
    getContextsForModel(modelSize: string): WhisperContext[];

    /**
     * Get pool statistics
     */
    getStatistics(): ContextPoolStatistics;

    /**
     * Clear the pool and clean up all contexts
     */
    clearPool(): void;
}

/**
 * Context pool statistics
 */
export interface ContextPoolStatistics {
    totalContexts: number;
    availableContexts: number;
    inUseContexts: number;
    contextsByModel: Record<string, number>;
    averageAccessCount: number;
    averageContextAge: number;
    totalAccessesSinceCreation: number;
    contextReuseRate: number;
}

/**
 * Native event from Kotlin/Objective-C layer
 */
export interface NativeEvent {
    jobId: JobId;
    eventType: 'progress' | 'segment' | 'complete' | 'error' | 'cancelled';
    data?: any;
    timestamp: number;
}

/**
 * Event bridge interface for routing native events
 */
export interface IEventBridge {
    /**
     * Subscribe to native events
     */
    subscribe(jobId: JobId, handler: (event: NativeEvent) => void): () => void;

    /**
     * Emit a native event (from native module)
     */
    emit(event: NativeEvent): void;

    /**
     * Subscribe to all events
     */
    subscribeAll(handler: (event: NativeEvent) => void): () => void;

    /**
     * Get event history for a job
     */
    getEventHistory(jobId: JobId): NativeEvent[];

    /**
     * Clear event history
     */
    clearEventHistory(jobId?: JobId): void;
}

/**
 * Error recovery strategy
 */
export interface ErrorRecoveryStrategy {
    strategy: 'retry' | 'skip' | 'cancel' | 'fallback';
    maxRetries?: number;
    backoffMultiplier?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
}

/**
 * Error handler interface for automatic recovery
 */
export interface IErrorHandler {
    /**
     * Handle an error and determine recovery strategy
     */
    handle(error: Error, jobMetadata: JobMetadata): ErrorRecoveryStrategy;

    /**
     * Check if a job should be retried
     */
    shouldRetry(jobMetadata: JobMetadata): boolean;

    /**
     * Calculate backoff delay for retry
     */
    calculateBackoffDelay(retryCount: number, initialDelayMs: number, maxDelayMs: number): number;

    /**
     * Register an error handler for specific error types
     */
    registerHandler(errorType: string, handler: (error: Error) => ErrorRecoveryStrategy): void;

    /**
     * Get error statistics
     */
    getStatistics(): ErrorStatistics;
}

/**
 * Error statistics
 */
export interface ErrorStatistics {
    totalErrors: number;
    errorsByType: Record<string, number>;
    retriedErrors: number;
    recoveredErrors: number;
    failedErrors: number;
    averageRetryCount: number;
}
