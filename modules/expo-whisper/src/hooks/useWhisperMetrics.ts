/**
 * useWhisperMetrics: React hook for accessing library statistics and monitoring
 *
 * Features:
 * - Real-time metrics collection
 * - Error statistics tracking
 * - Context pool monitoring
 * - Performance metrics
 * - Health status reporting
 * - Automatic updates via polling
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getJobCoordinator } from '../operations/JobCoordinator';
import { getContextPool } from '../operations/ContextPool';
import { getErrorHandler } from '../operations/ErrorHandler';
import { getLogger } from '../utils/Logger';
import { JobStatistics } from '../types/operations';
import { ContextPoolStatistics } from '../types/operations';
import { ErrorStatisticsSnapshot } from '../operations/ErrorHandler';

export interface LibraryMetrics {
    jobs: JobStatistics;
    contextPool: ContextPoolStatistics;
    errors: ErrorStatisticsSnapshot;
    uptime: number;
    timestamp: number;
}

export interface HealthStatus {
    isHealthy: boolean;
    issues: HealthIssue[];
    lastCheckTime: number;
}

export interface HealthIssue {
    severity: 'warning' | 'critical';
    component: 'jobs' | 'contextPool' | 'errors' | 'memory';
    message: string;
}

export interface UseWhisperMetricsOptions {
    pollIntervalMs?: number;
    autoStart?: boolean;
    enableDetailedTracking?: boolean;
}

export interface UseWhisperMetricsReturn {
    // State
    metrics: LibraryMetrics | null;
    health: HealthStatus | null;
    isPolling: boolean;

    // Methods
    startPolling: () => void;
    stopPolling: () => void;
    refreshMetrics: () => void;
    resetMetrics: () => void;
    getJobStatistics: () => JobStatistics | null;
    getContextPoolStatistics: () => ContextPoolStatistics | null;
    getErrorStatistics: () => ErrorStatisticsSnapshot | null;
    exportMetrics: () => string;
}

/**
 * Hook for monitoring library metrics and health
 */
export function useWhisperMetrics(
    options: UseWhisperMetricsOptions = {},
): UseWhisperMetricsReturn {
    const logger = getLogger();
    const coordinatorRef = useRef(getJobCoordinator());
    const poolRef = useRef(getContextPool());
    const errorHandlerRef = useRef(getErrorHandler());
    const pollingIntervalRef = useRef<NodeJS.Timer | null>(null);
    const startTimeRef = useRef(Date.now());

    const pollIntervalMs = options.pollIntervalMs ?? 5000;
    const autoStart = options.autoStart ?? false;
    const enableDetailedTracking = options.enableDetailedTracking ?? true;

    const [metrics, setMetrics] = useState<LibraryMetrics | null>(null);
    const [health, setHealth] = useState<HealthStatus | null>(null);
    const [isPolling, setIsPolling] = useState(false);

    /**
     * Collect all metrics from various sources
     */
    const collectMetrics = useCallback((): LibraryMetrics => {
        const jobStats = coordinatorRef.current.getStatistics();
        const poolStats = poolRef.current.getStatistics();
        const errorStats = errorHandlerRef.current.getStatistics();
        const uptime = Date.now() - startTimeRef.current;

        return {
            jobs: jobStats,
            contextPool: poolStats,
            errors: errorStats,
            uptime,
            timestamp: Date.now(),
        };
    }, []);

    /**
     * Calculate health status based on metrics
     */
    const calculateHealth = useCallback((): HealthStatus => {
        const currentMetrics = collectMetrics();
        const issues: HealthIssue[] = [];

        // Check job health
        const jobStats = currentMetrics.jobs;
        if (jobStats.failedJobs > 0 && jobStats.totalJobs > 0) {
            const failureRate = jobStats.failedJobs / jobStats.totalJobs;
            if (failureRate > 0.25) {
                issues.push({
                    severity: 'critical',
                    component: 'jobs',
                    message: `High job failure rate: ${(failureRate * 100).toFixed(1)}%`,
                });
            } else if (failureRate > 0.1) {
                issues.push({
                    severity: 'warning',
                    component: 'jobs',
                    message: `Elevated job failure rate: ${(failureRate * 100).toFixed(1)}%`,
                });
            }
        }

        // Check context pool health
        const poolStats = currentMetrics.contextPool;
        if (poolStats.inUseContexts === poolStats.totalContexts && poolStats.totalContexts > 0) {
            issues.push({
                severity: 'warning',
                component: 'contextPool',
                message: 'All contexts in use, potential bottleneck',
            });
        }

        if (poolStats.contextReuseRate < 0.5 && poolStats.totalContexts > 3) {
            issues.push({
                severity: 'warning',
                component: 'contextPool',
                message: `Low context reuse rate: ${(poolStats.contextReuseRate * 100).toFixed(1)}%`,
            });
        }

        // Check error health
        const errorStats = currentMetrics.errors;
        if (errorStats.circuitBreakerOpen) {
            issues.push({
                severity: 'critical',
                component: 'errors',
                message: 'Circuit breaker is open - failing fast on new requests',
            });
        }

        if (errorStats.totalErrors > 100) {
            const recentErrorRate = errorStats.totalErrors / Math.max(1, jobStats.totalJobs);
            if (recentErrorRate > 0.5) {
                issues.push({
                    severity: 'warning',
                    component: 'errors',
                    message: `High error rate: ${recentErrorRate.toFixed(2)} errors per job`,
                });
            }
        }

        return {
            isHealthy: issues.filter(i => i.severity === 'critical').length === 0,
            issues,
            lastCheckTime: Date.now(),
        };
    }, [collectMetrics]);

    /**
     * Refresh metrics immediately
     */
    const refreshMetrics = useCallback(() => {
        try {
            const newMetrics = collectMetrics();
            const newHealth = calculateHealth();

            setMetrics(newMetrics);
            setHealth(newHealth);

            if (enableDetailedTracking) {
                logger.debug(`Metrics refreshed`, {
                    activeJobs: newMetrics.jobs.activeJobs,
                    contextPoolHealth: newMetrics.contextPool.availableContexts,
                    errorCount: newMetrics.errors.totalErrors,
                });
            }
        } catch (err) {
            logger.error(`Error refreshing metrics`, { error: (err as Error).message });
        }
    }, [collectMetrics, calculateHealth, enableDetailedTracking]);

    /**
     * Start polling for metrics updates
     */
    const startPolling = useCallback(() => {
        if (isPolling) return;

        logger.info(`Starting metrics polling`, { interval: pollIntervalMs });

        // Initial refresh
        refreshMetrics();

        // Set up polling
        pollingIntervalRef.current = setInterval(() => {
            refreshMetrics();
        }, pollIntervalMs) as unknown as NodeJS.Timer;

        setIsPolling(true);
    }, [isPolling, pollIntervalMs, refreshMetrics]);

    /**
     * Stop polling for metrics updates
     */
    const stopPolling = useCallback(() => {
        if (!isPolling) return;

        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current as unknown as number);
            pollingIntervalRef.current = null;
        }

        setIsPolling(false);
        logger.info(`Stopped metrics polling`);
    }, [isPolling]);

    /**
     * Reset all metrics in the library
     */
    const resetMetrics = useCallback(() => {
        try {
            coordinatorRef.current.clearJobs();
            errorHandlerRef.current.resetStatistics();
            poolRef.current.clearPool();

            startTimeRef.current = Date.now();
            setMetrics(null);
            setHealth(null);

            logger.info(`All metrics reset`);
        } catch (err) {
            logger.error(`Error resetting metrics`, { error: (err as Error).message });
        }
    }, []);

    /**
     * Get job statistics only
     */
    const getJobStatistics = useCallback((): JobStatistics | null => {
        try {
            return coordinatorRef.current.getStatistics();
        } catch (err) {
            logger.error(`Error getting job statistics`, { error: (err as Error).message });
            return null;
        }
    }, []);

    /**
     * Get context pool statistics only
     */
    const getContextPoolStatistics = useCallback((): ContextPoolStatistics | null => {
        try {
            return poolRef.current.getStatistics();
        } catch (err) {
            logger.error(`Error getting context pool statistics`, { error: (err as Error).message });
            return null;
        }
    }, []);

    /**
     * Get error statistics only
     */
    const getErrorStatistics = useCallback((): ErrorStatisticsSnapshot | null => {
        try {
            return errorHandlerRef.current.getStatistics();
        } catch (err) {
            logger.error(`Error getting error statistics`, { error: (err as Error).message });
            return null;
        }
    }, []);

    /**
     * Export all metrics as JSON string
     */
    const exportMetrics = useCallback((): string => {
        try {
            const exportData = {
                exportedAt: new Date().toISOString(),
                uptime: metrics?.uptime || 0,
                metrics: {
                    jobs: getJobStatistics(),
                    contextPool: getContextPoolStatistics(),
                    errors: getErrorStatistics(),
                },
                health: health?.issues || [],
            };

            return JSON.stringify(exportData, null, 2);
        } catch (err) {
            logger.error(`Error exporting metrics`, { error: (err as Error).message });
            return '';
        }
    }, [metrics, health, getJobStatistics, getContextPoolStatistics, getErrorStatistics]);

    // Auto-start polling if enabled
    useEffect(() => {
        if (autoStart) {
            startPolling();
        }

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current as unknown as number);
            }
        };
    }, [autoStart, startPolling]);

    return {
        metrics,
        health,
        isPolling,
        startPolling,
        stopPolling,
        refreshMetrics,
        resetMetrics,
        getJobStatistics,
        getContextPoolStatistics,
        getErrorStatistics,
        exportMetrics,
    };
}
