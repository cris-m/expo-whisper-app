/**
 * Structured logging utility with support for multiple handlers and log levels
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogContext {
	[key: string]: any;
}

export interface LogEntry {
	timestamp: number;
	level: LogLevel;
	message: string;
	context?: LogContext;
}

export interface LogHandler {
	handle(entry: LogEntry): void | Promise<void>;
}

/**
 * Console handler - logs to console
 */
class ConsoleHandler implements LogHandler {
	handle(entry: LogEntry): void {
		const timestamp = new Date(entry.timestamp).toISOString();
		const levelColor = {
			DEBUG: '\x1b[36m',   // cyan
			INFO: '\x1b[32m',    // green
			WARN: '\x1b[33m',    // yellow
			ERROR: '\x1b[31m',   // red
			FATAL: '\x1b[35m',   // magenta
		};
		const reset = '\x1b[0m';
		const color = levelColor[entry.level];
		const prefix = `${color}[${timestamp}] [${entry.level}]${reset}`;
		const contextStr = entry.context && Object.keys(entry.context).length > 0
			? ` ${JSON.stringify(entry.context)}`
			: '';

		console.log(`${prefix} ${entry.message}${contextStr}`);
	}
}

/**
 * Structured logger with support for multiple handlers and context stacking
 */
export class Logger {
	private static instance: Logger;
	private handlers: Map<string, LogHandler> = new Map();
	private contextStack: LogContext[] = [];
	private minLogLevel: LogLevel = 'DEBUG';

	private constructor() {
		// Add default console handler
		this.handlers.set('console', new ConsoleHandler());
	}

	static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	/**
	 * Set the minimum log level (logs below this level are ignored)
	 */
	setMinLogLevel(level: LogLevel): void {
		this.minLogLevel = level;
	}

	/**
	 * Add a log handler
	 */
	addHandler(name: string, handler: LogHandler): void {
		this.handlers.set(name, handler);
	}

	/**
	 * Remove a log handler
	 */
	removeHandler(name: string): void {
		this.handlers.delete(name);
	}

	/**
	 * Push context onto the stack (for nested operations)
	 */
	pushContext(context: LogContext): void {
		this.contextStack.push(context);
	}

	/**
	 * Pop context from the stack
	 */
	popContext(): LogContext | undefined {
		return this.contextStack.pop();
	}

	/**
	 * Run a function with additional context
	 */
	async withContext<T>(context: LogContext, fn: () => Promise<T>): Promise<T> {
		this.pushContext(context);
		try {
			return await fn();
		} finally {
			this.popContext();
		}
	}

	/**
	 * Get merged context from all levels of the stack
	 */
	private getMergedContext(additionalContext?: LogContext): LogContext | undefined {
		const merged: LogContext = {};
		for (const ctx of this.contextStack) {
			Object.assign(merged, ctx);
		}
		if (additionalContext) {
			Object.assign(merged, additionalContext);
		}
		return Object.keys(merged).length > 0 ? merged : undefined;
	}

	/**
	 * Get log level priority (higher number = higher priority)
	 */
	private getLogLevelPriority(level: LogLevel): number {
		const priorities: Record<LogLevel, number> = {
			DEBUG: 0,
			INFO: 1,
			WARN: 2,
			ERROR: 3,
			FATAL: 4,
		};
		return priorities[level];
	}

	/**
	 * Check if a log level should be logged
	 */
	private shouldLog(level: LogLevel): boolean {
		return this.getLogLevelPriority(level) >= this.getLogLevelPriority(this.minLogLevel);
	}

	/**
	 * Internal method to log a message
	 */
	private log(level: LogLevel, message: string, context?: LogContext): void {
		if (!this.shouldLog(level)) {
			return;
		}

		const mergedContext = this.getMergedContext(context);
		const entry: LogEntry = {
			timestamp: Date.now(),
			level,
			message,
			context: mergedContext,
		};

		for (const handler of this.handlers.values()) {
			try {
				handler.handle(entry);
			} catch (error) {
				console.error('Error in log handler:', error);
			}
		}
	}

	/**
	 * Log a debug message
	 */
	debug(message: string, context?: LogContext): void {
		this.log('DEBUG', message, context);
	}

	/**
	 * Log an info message
	 */
	info(message: string, context?: LogContext): void {
		this.log('INFO', message, context);
	}

	/**
	 * Log a warning message
	 */
	warn(message: string, context?: LogContext): void {
		this.log('WARN', message, context);
	}

	/**
	 * Log an error message
	 */
	error(message: string, context?: LogContext): void {
		this.log('ERROR', message, context);
	}

	/**
	 * Log a fatal error message
	 */
	fatal(message: string, context?: LogContext): void {
		this.log('FATAL', message, context);
	}

	/**
	 * Clear all handlers
	 */
	clearHandlers(): void {
		this.handlers.clear();
	}

	/**
	 * Clear all context
	 */
	clearContext(): void {
		this.contextStack = [];
	}
}

/**
 * Get the singleton logger instance
 */
export function getLogger(): Logger {
	return Logger.getInstance();
}

/**
 * Convenience export for quick logging
 */
export const log = {
	debug: (message: string, context?: LogContext) => getLogger().debug(message, context),
	info: (message: string, context?: LogContext) => getLogger().info(message, context),
	warn: (message: string, context?: LogContext) => getLogger().warn(message, context),
	error: (message: string, context?: LogContext) => getLogger().error(message, context),
	fatal: (message: string, context?: LogContext) => getLogger().fatal(message, context),
};
