/**
 * Callback secret validation middleware for itty-router
 * 
 * Validates the X-Callback-Secret header on RunPod-to-backend requests.
 * This shared secret ensures only our Docker handler can call callback endpoints.
 */
import { jsonResponse } from '../utils/response.js';

/**
 * itty-router middleware: require valid callback secret.
 * Returns 401 if the secret is missing or does not match.
 */
export function withCallbackSecret(request, env) {
	const secret = request.headers.get('X-Callback-Secret');
	if (!env.RUNPOD_CALLBACK_SECRET) {
		console.error('[Security] RUNPOD_CALLBACK_SECRET not configured');
		return jsonResponse({ success: false, message: 'Server misconfiguration' }, 500);
	}
	if (secret !== env.RUNPOD_CALLBACK_SECRET) {
		return jsonResponse({ success: false, message: 'Invalid callback secret' }, 401);
	}
}
