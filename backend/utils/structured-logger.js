/**
 * Structured Logger for Vidia Backend
 *
 * Provides JSON-formatted log output with consistent fields for
 * observability and debugging. Each log entry includes:
 * - timestamp (ISO 8601)
 * - requestId (from request context, if available)
 * - level (debug, info, warn, error)
 * - component (logical area of the codebase)
 * - message (human-readable description)
 * - data (optional structured payload)
 *
 * Usage:
 *   import { createStructuredLogger } from './utils/structured-logger.js';
 *   const log = createStructuredLogger('MyComponent');
 *   log.info(request, 'Something happened', { key: 'value' });
 */

const LEVELS = ['debug', 'info', 'warn', 'error'];

/**
 * Format a structured log entry as a JSON string.
 * @param {string} level - Log level
 * @param {string} component - Component name
 * @param {Request|null} request - The request object (may carry requestId)
 * @param {string} message - Log message
 * @param {Object} [data] - Optional structured data
 * @returns {string} JSON-formatted log line
 */
function formatEntry(level, component, request, message, data) {
	const entry = {
		timestamp: new Date().toISOString(),
		requestId: request?.requestId || null,
		level,
		component,
		message,
	};

	if (data !== undefined) {
		entry.data = data;
	}

	return JSON.stringify(entry);
}

/**
 * Create a structured logger bound to a specific component name.
 * Returns an object with debug/info/warn/error methods.
 *
 * Each method accepts:
 *   (request, message)
 *   (request, message, data)
 *
 * If you don't have a request object, pass null.
 *
 * @param {string} component - The logical component name (e.g., 'AuthRoutes', 'WebSocketManager')
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createStructuredLogger(component) {
	const logger = {};

	for (const level of LEVELS) {
		logger[level] = (request, message, data) => {
			const line = formatEntry(level, component, request, message, data);

			// Route to the appropriate console method
			switch (level) {
				case 'debug':
					console.debug(line);
					break;
				case 'warn':
					console.warn(line);
					break;
				case 'error':
					console.error(line);
					break;
				default:
					console.log(line);
			}
		};
	}

	return logger;
}
