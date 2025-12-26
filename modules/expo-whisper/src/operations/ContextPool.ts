/**
 * ContextPool: Manages reusable whisper context instances
 *
 * Responsibilities:
 * - Pool and reuse expensive context initialization
 * - Track context lifecycle and access patterns
 * - Automatic cleanup and garbage collection
 * - Provide context statistics and monitoring
 */

import { ContextId } from '../types/common';
import {
    WhisperContext,
    IContextPool,
    ContextPoolStatistics,
} from '../types/operations';
import { WhisperModelSize } from '../types/whisper';
import { getLogger } from '../utils/Logger';

/**
 * ContextPool implementation
 */
export class ContextPool implements IContextPool {
    private contexts = new Map<ContextId, WhisperContext>();
    private availableContexts = new Map<string, ContextId[]>(); // modelSize -> [contextIds]
    private inUseContexts = new Set<ContextId>();
    private maxContextsPerModel: number;
    private maxContextAge: number; // milliseconds
    private logger = getLogger();

    constructor(maxContextsPerModel: number = 5, maxContextAgeMs: number = 3600000) {
        // 5 contexts per model, 1 hour TTL
        this.maxContextsPerModel = maxContextsPerModel;
        this.maxContextAge = maxContextAgeMs;
    }

    /**
     * Acquire a context from the pool, creating one if needed
     */
    async acquireContext(modelSize: string): Promise<WhisperContext> {
        const available = this.availableContexts.get(modelSize) || [];
        const validContexts = available.filter(contextId => {
            const ctx = this.contexts.get(contextId);
            return ctx && !ctx.isInUse && this.isContextValid(ctx);
        });

        if (validContexts.length > 0) {
            const contextId = validContexts[0];
            const context = this.contexts.get(contextId)!;

            context.isInUse = true;
            context.lastAccessedAt = Date.now();
            context.accessCount++;
            this.inUseContexts.add(contextId);

            this.logger.debug(`Context acquired (reused)`, {
                contextId,
                modelSize,
                accessCount: context.accessCount,
            });

            return context;
        }

        const modelContexts = available.length;
        if (modelContexts >= this.maxContextsPerModel) {
            const oldestUnused = available
                .map(id => ({
                    id,
                    context: this.contexts.get(id)!,
                }))
                .filter(({ context }) => !context.isInUse)
                .sort((a, b) => a.context.lastAccessedAt - b.context.lastAccessedAt)[0];

            if (oldestUnused) {
                this.evictContext(oldestUnused.id);
            }
        }

        const contextId = this.createContextId();
        const context: WhisperContext = {
            contextId,
            modelSize,
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
            accessCount: 1,
            isInUse: true,
        };

        this.contexts.set(contextId, context);
        this.inUseContexts.add(contextId);

        const modelContextsList = this.availableContexts.get(modelSize) || [];
        modelContextsList.push(contextId);
        this.availableContexts.set(modelSize, modelContextsList);

        this.logger.info(`Context created and acquired`, {
            contextId,
            modelSize,
        });

        return context;
    }

    /**
     * Release a context back to the pool
     */
    releaseContext(contextId: ContextId): void {
        const context = this.contexts.get(contextId);
        if (!context) {
            this.logger.warn(`Context not found for release`, { contextId });
            return;
        }

        context.isInUse = false;
        this.inUseContexts.delete(contextId);

        this.logger.debug(`Context released`, {
            contextId,
            modelSize: context.modelSize,
            totalAccesses: context.accessCount,
        });
    }

    /**
     * Get a context if it exists and is available
     */
    getContext(contextId: ContextId): WhisperContext | undefined {
        return this.contexts.get(contextId);
    }

    /**
     * Reuse a context (increment access count and update last accessed time)
     */
    reuseContext(contextId: ContextId): void {
        const context = this.contexts.get(contextId);
        if (!context) {
            this.logger.warn(`Context not found for reuse`, { contextId });
            return;
        }

        context.lastAccessedAt = Date.now();
        context.accessCount++;
    }

    /**
     * Invalidate a context and remove from pool
     */
    invalidateContext(contextId: ContextId): void {
        const context = this.contexts.get(contextId);
        if (!context) {
            this.logger.warn(`Context not found for invalidation`, { contextId });
            return;
        }

        this.evictContext(contextId);
        this.logger.info(`Context invalidated`, { contextId });
    }

    /**
     * Get all contexts for a specific model
     */
    getContextsForModel(modelSize: WhisperModelSize): WhisperContext[] {
        const contextIds = this.availableContexts.get(modelSize) || [];
        return contextIds
            .map(id => this.contexts.get(id))
            .filter((ctx): ctx is WhisperContext => ctx !== undefined);
    }

    /**
     * Get pool statistics
     */
    getStatistics(): ContextPoolStatistics {
        const allContexts = Array.from(this.contexts.values());
        const totalContexts = allContexts.length;
        const inUse = this.inUseContexts.size;
        const available = totalContexts - inUse;

        const contextsByModel: Record<string, number> = {};
        for (const [modelSize, contextIds] of this.availableContexts) {
            contextsByModel[modelSize] = contextIds.length;
        }

        const totalAccesses = allContexts.reduce((sum, ctx) => sum + ctx.accessCount, 0);
        const averageAccesses = totalContexts > 0 ? totalAccesses / totalContexts : 0;

        const now = Date.now();
        const totalAge = allContexts.reduce((sum, ctx) => sum + (now - ctx.createdAt), 0);
        const averageAge = totalContexts > 0 ? totalAge / totalContexts : 0;

        const reuseCount = totalAccesses - totalContexts;
        const reuseRate = totalAccesses > 0 ? reuseCount / totalAccesses : 0;

        return {
            totalContexts,
            availableContexts: available,
            inUseContexts: inUse,
            contextsByModel,
            averageAccessCount: parseFloat(averageAccesses.toFixed(2)),
            averageContextAge: Math.round(averageAge),
            totalAccessesSinceCreation: totalAccesses,
            contextReuseRate: parseFloat(reuseRate.toFixed(3)),
        };
    }

    /**
     * Clear the pool and clean up all contexts
     */
    clearPool(): void {
        this.contexts.clear();
        this.availableContexts.clear();
        this.inUseContexts.clear();
        this.logger.info(`Context pool cleared`);
    }

    /**
     * Private: Check if context is still valid
     */
    private isContextValid(context: WhisperContext): boolean {
        const age = Date.now() - context.createdAt;
        return age < this.maxContextAge;
    }

    /**
     * Private: Create a unique context ID
     */
    private createContextId(): ContextId {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 100000);
        const id = (timestamp * 100000 + random) as ContextId;
        return id;
    }

    /**
     * Private: Remove a context from the pool
     */
    private evictContext(contextId: ContextId): void {
        const context = this.contexts.get(contextId);
        if (!context) return;

        const modelContexts = this.availableContexts.get(context.modelSize) || [];
        const index = modelContexts.indexOf(contextId);
        if (index > -1) {
            modelContexts.splice(index, 1);
        }

        this.contexts.delete(contextId);
        this.inUseContexts.delete(contextId);

        this.logger.debug(`Context evicted`, {
            contextId,
            modelSize: context.modelSize,
        });
    }
}

/**
 * Singleton instance
 */
let poolInstance: ContextPool | null = null;

/**
 * Get or create the context pool singleton
 */
export function getContextPool(): ContextPool {
    if (!poolInstance) {
        poolInstance = new ContextPool(5, 3600000);
    }
    return poolInstance;
}
