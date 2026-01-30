export interface TelemetryEvent {
	timestamp: string;
	level: 'info' | 'warn' | 'error';
	message: string;
	context?: Record<string, unknown>;
}

/**
 * Logs telemetry events to console in a non-blocking way
 * Can be extended to send to external services (e.g., Datadog, Sentry, etc.)
 */
export class Telemetry {
	/**
	 * Log an info-level event
	 */
	static info(message: string, context?: Record<string, unknown>): void {
		this.log('info', message, context);
	}

	/**
	 * Log a warning-level event
	 */
	static warn(message: string, context?: Record<string, unknown>): void {
		this.log('warn', message, context);
	}

	/**
	 * Log an error-level event
	 */
	static error(message: string, context?: Record<string, unknown>): void {
		this.log('error', message, context);
	}

	/**
	 * Internal logging method
	 */
	private static log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void {
		const event: TelemetryEvent = {
			timestamp: new Date().toISOString(),
			level,
			message,
			context,
		};

		// Log to console (non-blocking)
		const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
		logFn(JSON.stringify(event));
	}

	/**
	 * Execute a function and log telemetry in a non-blocking way using ExecutionContext
	 */
	static async logAsync(
		ctx: ExecutionContext,
		level: 'info' | 'warn' | 'error',
		message: string,
		context?: Record<string, unknown>
	): Promise<void> {
		ctx.waitUntil(
			Promise.resolve().then(() => {
				this.log(level, message, context);
			})
		);
	}
}
