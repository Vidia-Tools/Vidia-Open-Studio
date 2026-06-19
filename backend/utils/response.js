// Shared static CORS headers for internal/non-browser responses (RunPod callbacks, etc.)
import { DEFAULT_CORS_HEADERS as corsHeaders } from '../middleware/cors.js';
import { createStructuredLogger } from './structured-logger.js';

const jsonResponse = (data, status = 200) => {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});
};

const workerLogger = createStructuredLogger('Worker');

/**
 * Debug logging helper - delegates to the shared structured logger.
 * @param {string} message - Message to log
 * @param {any} data - Optional data to log
 */
function logDebug(message, data) {
	workerLogger.debug(null, message, data);
}

export { corsHeaders, jsonResponse, logDebug };
