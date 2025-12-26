/**
 * JobCoordinator: Manages job-to-callback mapping
 *
 * Responsibilities:
 * - Track jobId → callbacks mapping
 * - Route native events to JavaScript callbacks
 * - Manage job metadata and lifecycle
 * - Provide job statistics and monitoring
 */

import { JobId, TaskId, OperationStatus, Progress } from '../types/common';
import { Segment, TranscribeResult } from '../types/whisper';
import {
	JobCallbacks,
	JobMetadata,
	IJobCoordinator,
	JobStatistics,
} from '../types/operations';
import { getLogger } from '../utils/Logger';

/**
 * JobCoordinator implementation
 */
export class JobCoordinator implements IJobCoordinator {
	private jobs = new Map<JobId, JobMetadata>();
	private callbacks = new Map<JobId, Partial<JobCallbacks>>();
	private cancelledJobs = new Set<JobId>();
	private logger = getLogger();

	/**
	 * Register a new job with callbacks
	 */
	registerJob(
		jobId: JobId,
		taskId: TaskId,
		type: 'file' | 'buffer' | 'stream' | 'realtime',
		callbacks: Partial<JobCallbacks>,
	): void {
		const metadata: JobMetadata = {
			jobId,
			taskId,
			type,
			status: 'pending',
			progress: 0 as Progress,
			startTime: Date.now(),
			retryCount: 0,
			maxRetries: 3,
		};

		this.jobs.set(jobId, metadata);
		this.callbacks.set(jobId, callbacks);

		this.logger.debug(`Job registered`, {
			jobId,
			taskId,
			type,
		});
	}

	/**
	 * Unregister a job and clean up
	 */
	unregisterJob(jobId: JobId): void {
		const job = this.jobs.get(jobId);
		if (job) {
			job.endTime = Date.now();
			this.logger.debug(`Job unregistered`, {
				jobId,
				status: job.status,
				duration: job.endTime - job.startTime,
			});
		}

		this.callbacks.delete(jobId);
		this.cancelledJobs.delete(jobId);
		// Keep job metadata for history/statistics
	}

	/**
	 * Get callbacks for a job
	 */
	getCallbacks(jobId: JobId): Partial<JobCallbacks> | undefined {
		return this.callbacks.get(jobId);
	}

	/**
	 * Get metadata for a job
	 */
	getMetadata(jobId: JobId): JobMetadata | undefined {
		return this.jobs.get(jobId);
	}

	/**
	 * Update job status
	 */
	updateJobStatus(jobId: JobId, status: OperationStatus, progress?: Progress): void {
		const job = this.jobs.get(jobId);
		if (!job) {
			this.logger.warn(`Job not found`, { jobId });
			return;
		}

		job.status = status;
		if (progress !== undefined) {
			job.progress = progress;
		}

		if (status === 'completed') {
			job.endTime = Date.now();
		}

		this.logger.debug(`Job status updated`, {
			jobId,
			status,
			progress,
		});
	}

	/**
	 * Report progress for a job
	 */
	reportProgress(jobId: JobId, progress: Progress): void {
		const job = this.jobs.get(jobId);
		if (!job) {
			this.logger.warn(`Job not found for progress update`, { jobId });
			return;
		}

		job.progress = progress;
		job.status = 'processing';

		const callbacks = this.callbacks.get(jobId);
		try {
			callbacks?.onProgress?.(progress);
		} catch (error) {
			this.logger.error(`Error in progress callback`, {
				jobId,
				error: (error as Error).message,
			});
		}
	}

	/**
	 * Report a segment for a job
	 */
	reportSegment(jobId: JobId, segment: Segment): void {
		const callbacks = this.callbacks.get(jobId);
		try {
			callbacks?.onSegment?.(segment);
		} catch (error) {
			this.logger.error(`Error in segment callback`, {
				jobId,
				error: (error as Error).message,
			});
		}
	}

	/**
	 * Report completion for a job
	 */
	reportCompletion(jobId: JobId, result: TranscribeResult): void {
		const job = this.jobs.get(jobId);
		if (!job) {
			this.logger.warn(`Job not found for completion`, { jobId });
			return;
		}

		job.status = 'completed';
		job.progress = 100 as Progress;
		job.endTime = Date.now();

		const callbacks = this.callbacks.get(jobId);
		try {
			callbacks?.onComplete?.(result);
		} catch (error) {
			this.logger.error(`Error in completion callback`, {
				jobId,
				error: (error as Error).message,
			});
		}

		this.logger.info(`Job completed`, {
			jobId,
			duration: job.endTime - job.startTime,
		});
	}

	/**
	 * Report an error for a job
	 */
	reportError(jobId: JobId, error: Error): void {
		const job = this.jobs.get(jobId);
		if (!job) {
			this.logger.warn(`Job not found for error`, { jobId });
			return;
		}

		job.status = 'failed';
		job.endTime = Date.now();

		const callbacks = this.callbacks.get(jobId);
		try {
			callbacks?.onError?.(error);
		} catch (callbackError) {
			this.logger.error(`Error in error callback`, {
				jobId,
				error: (callbackError as Error).message,
			});
		}

		this.logger.error(`Job failed`, {
			jobId,
			error: error.message,
			duration: job.endTime - job.startTime,
		});
	}

	/**
	 * Get all active jobs
	 */
	getActiveJobs(): JobId[] {
		const activeStatuses: OperationStatus[] = ['pending', 'initializing', 'processing', 'paused'];
		return Array.from(this.jobs.entries())
			.filter(([_, job]) => activeStatuses.includes(job.status))
			.map(([jobId]) => jobId);
	}

	/**
	 * Get all jobs with a specific status
	 */
	getJobsByStatus(status: OperationStatus): JobId[] {
		return Array.from(this.jobs.entries())
			.filter(([_, job]) => job.status === status)
			.map(([jobId]) => jobId);
	}

	/**
	 * Cancel a job
	 */
	cancelJob(jobId: JobId): void {
		const job = this.jobs.get(jobId);
		if (!job) {
			this.logger.warn(`Job not found for cancellation`, { jobId });
			return;
		}

		this.cancelledJobs.add(jobId);
		job.status = 'cancelled';
		job.endTime = Date.now();

		this.logger.info(`Job cancelled`, { jobId });
	}

	/**
	 * Check if a job is cancelled
	 */
	isJobCancelled(jobId: JobId): boolean {
		return this.cancelledJobs.has(jobId);
	}

	/**
	 * Get job statistics
	 */
	getStatistics(): JobStatistics {
		const jobs = Array.from(this.jobs.values());

		const completed = jobs.filter(j => j.status === 'completed').length;
		const failed = jobs.filter(j => j.status === 'failed').length;
		const cancelled = jobs.filter(j => j.status === 'cancelled').length;
		const active = this.getActiveJobs().length;

		const completedJobs = jobs.filter(j => j.status === 'completed');
		const totalProcessingTime = completedJobs.reduce(
			(sum, j) => sum + ((j.endTime ?? Date.now()) - j.startTime),
			0,
		);
		const averageProcessingTime = completed > 0 ? totalProcessingTime / completed : 0;

		const totalRetries = jobs.reduce((sum, j) => sum + j.retryCount, 0);
		const averageRetries = jobs.length > 0 ? totalRetries / jobs.length : 0;

		const successRate = jobs.length > 0 ? completed / jobs.length : 0;

		return {
			totalJobs: jobs.length,
			activeJobs: active,
			completedJobs: completed,
			failedJobs: failed,
			cancelledJobs: cancelled,
			averageProcessingTimeMs: Math.round(averageProcessingTime),
			averageRetries: parseFloat(averageRetries.toFixed(2)),
			successRate: parseFloat(successRate.toFixed(3)),
		};
	}

	/**
	 * Clear all jobs
	 */
	clearJobs(): void {
		this.jobs.clear();
		this.callbacks.clear();
		this.cancelledJobs.clear();
		this.logger.info(`All jobs cleared`);
	}
}

/**
 * Singleton instance
 */
let coordinatorInstance: JobCoordinator | null = null;

/**
 * Get or create the job coordinator singleton
 */
export function getJobCoordinator(): JobCoordinator {
	if (!coordinatorInstance) {
		coordinatorInstance = new JobCoordinator();
	}
	return coordinatorInstance;
}
