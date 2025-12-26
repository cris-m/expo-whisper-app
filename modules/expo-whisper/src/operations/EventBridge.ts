/**
 * EventBridge: Routes native events to JavaScript callbacks
 *
 * Responsibilities:
 * - Bridge native (Kotlin/Swift) events to JavaScript
 * - Route events to registered job handlers
 * - Event deduplication and ordering
 * - Event history tracking for debugging
 */

import { JobId, Progress } from '../types/common';
import { NativeEvent, IEventBridge } from '../types/operations';
import { getLogger } from '../utils/Logger';
import { getJobCoordinator } from './JobCoordinator';

/**
 * EventBridge implementation
 */
export class EventBridge implements IEventBridge {
	private subscribers = new Map<JobId, Set<(event: NativeEvent) => void>>();
	private globalSubscribers = new Set<(event: NativeEvent) => void>();
	private eventHistory = new Map<JobId, NativeEvent[]>();
	private maxHistorySize = 1000;
	private lastEventTimestamp = new Map<JobId, number>();
	private deduplicationWindow = 100; // milliseconds
	private logger = getLogger();
	private jobCoordinator = getJobCoordinator();

	/**
	 * Subscribe to native events for a specific job
	 */
	subscribe(jobId: JobId, handler: (event: NativeEvent) => void): () => void {
		if (!this.subscribers.has(jobId)) {
			this.subscribers.set(jobId, new Set());
		}

		this.subscribers.get(jobId)!.add(handler);

		this.logger.debug(`Event subscriber added`, { jobId });

		// Return unsubscribe function
		return () => {
			const handlers = this.subscribers.get(jobId);
			if (handlers) {
				handlers.delete(handler);
			}
		};
	}

	/**
	 * Emit a native event (from native module)
	 */
	emit(event: NativeEvent): void {
		if (this.isDuplicate(event)) {
			this.logger.debug(`Duplicate event ignored`, {
				jobId: event.jobId,
				eventType: event.eventType,
			});
			return;
		}

		this.lastEventTimestamp.set(event.jobId, event.timestamp);

		// Route to JobCoordinator
		this.routeToCoordinator(event);

		// Notify job-specific subscribers
		const jobSubscribers = this.subscribers.get(event.jobId);
		if (jobSubscribers) {
			for (const handler of jobSubscribers) {
				try {
					handler(event);
				} catch (error) {
					this.logger.error(`Error in event handler`, {
						jobId: event.jobId,
						eventType: event.eventType,
						error: (error as Error).message,
					});
				}
			}
		}

		// Notify global subscribers
		for (const handler of this.globalSubscribers) {
			try {
				handler(event);
			} catch (error) {
				this.logger.error(`Error in global event handler`, {
					jobId: event.jobId,
					eventType: event.eventType,
					error: (error as Error).message,
				});
			}
		}

		this.addToHistory(event);

		this.logger.debug(`Event emitted`, {
			jobId: event.jobId,
			eventType: event.eventType,
		});
	}

	/**
	 * Subscribe to all events
	 */
	subscribeAll(handler: (event: NativeEvent) => void): () => void {
		this.globalSubscribers.add(handler);

		this.logger.debug(`Global event subscriber added`);

		// Return unsubscribe function
		return () => {
			this.globalSubscribers.delete(handler);
		};
	}

	/**
	 * Get event history for a job
	 */
	getEventHistory(jobId: JobId): NativeEvent[] {
		return this.eventHistory.get(jobId) || [];
	}

	/**
	 * Clear event history
	 */
	clearEventHistory(jobId?: JobId): void {
		if (jobId) {
			this.eventHistory.delete(jobId);
			this.logger.debug(`Event history cleared for job`, { jobId });
		} else {
			this.eventHistory.clear();
			this.logger.info(`All event histories cleared`);
		}
	}

	/**
	 * Private: Check if event is a duplicate
	 */
	private isDuplicate(event: NativeEvent): boolean {
		const lastTime = this.lastEventTimestamp.get(event.jobId) ?? 0;
		const timeSinceLastEvent = event.timestamp - lastTime;

		// Same event type within deduplication window = duplicate
		if (
			timeSinceLastEvent < this.deduplicationWindow &&
			this.getLastEventType(event.jobId) === event.eventType
		) {
			return true;
		}

		return false;
	}

	/**
	 * Private: Get the last event type for a job
	 */
	private getLastEventType(jobId: JobId): string | undefined {
		const history = this.eventHistory.get(jobId);
		if (history && history.length > 0) {
			return history[history.length - 1].eventType;
		}
		return undefined;
	}

	/**
	 * Private: Route event to JobCoordinator
	 */
	private routeToCoordinator(event: NativeEvent): void {
		try {
			switch (event.eventType) {
				case 'progress':
					if (event.data && typeof event.data === 'number') {
						this.jobCoordinator.reportProgress(event.jobId, event.data as Progress);
					}
					break;

				case 'segment':
					if (event.data) {
						this.jobCoordinator.reportSegment(event.jobId, event.data);
					}
					break;

				case 'complete':
					if (event.data) {
						this.jobCoordinator.reportCompletion(event.jobId, event.data);
					}
					break;

				case 'error':
					const error = new Error(
						typeof event.data === 'string' ? event.data : 'Unknown error',
					);
					this.jobCoordinator.reportError(event.jobId, error);
					break;

				case 'cancelled':
					this.jobCoordinator.cancelJob(event.jobId);
					break;

				default:
					this.logger.warn(`Unknown event type`, {
						jobId: event.jobId,
						eventType: event.eventType,
					});
			}
		} catch (error) {
			this.logger.error(`Error routing event to coordinator`, {
				jobId: event.jobId,
				eventType: event.eventType,
				error: (error as Error).message,
			});
		}
	}

	/**
	 * Private: Add event to history
	 */
	private addToHistory(event: NativeEvent): void {
		if (!this.eventHistory.has(event.jobId)) {
			this.eventHistory.set(event.jobId, []);
		}

		const history = this.eventHistory.get(event.jobId)!;
		history.push(event);

		// Keep history size manageable
		if (history.length > this.maxHistorySize) {
			history.shift();
		}
	}
}

/**
 * Singleton instance
 */
let bridgeInstance: EventBridge | null = null;

/**
 * Get or create the event bridge singleton
 */
export function getEventBridge(): EventBridge {
	if (!bridgeInstance) {
		bridgeInstance = new EventBridge();
	}
	return bridgeInstance;
}
