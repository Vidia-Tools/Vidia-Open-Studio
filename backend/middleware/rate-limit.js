/**
 * Rate limiting middleware for itty-router
 * 
 * Uses a simple sliding window counter stored in a Durable Object.
 * Each key (IP + endpoint) tracks request timestamps, and requests
 * exceeding the window limit are rejected with 429.
 * 
 * Since Workers are stateless, we use the WebSocketManager DO as a
 * lightweight store (via a dedicated /rateLimit endpoint), keeping
 * the implementation simple without requiring a new DO class and migration.
 * 
 * Alternatively, this can use KV with short TTL for eventual-consistency
 * rate limiting that works well enough for abuse prevention.
 */
import { jsonResponse } from '../utils/response.js';

/**
 * Creates a rate limit middleware for a specific limit and window.
 * Uses KV with TTL for simple, low-overhead rate limiting.
 * 
 * @param {number} maxRequests - Maximum requests allowed in the window
 * @param {number} windowSeconds - Time window in seconds
 * @returns {Function} itty-router middleware
 */
export function withRateLimit(maxRequests, windowSeconds) {
	return async (request, env) => {
		const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
		const path = new URL(request.url).pathname;
		const key = `rl:${ip}:${path}`;

		try {
			// Read current counter from KV
			const existing = await env.DISPOSABLE_EMAIL_DOMAINS.get(key);
			const now = Math.floor(Date.now() / 1000);

			if (existing) {
				const data = JSON.parse(existing);
				// Remove expired timestamps from the window
				const validTimestamps = data.timestamps.filter(
					ts => ts > now - windowSeconds
				);

				if (validTimestamps.length >= maxRequests) {
					const retryAfter = windowSeconds - (now - validTimestamps[0]);
					return new Response(
						JSON.stringify({
							success: false,
							message: 'Too many requests. Please try again later.'
						}),
						{
							status: 429,
							headers: {
								'Content-Type': 'application/json',
								'Retry-After': String(retryAfter)
							}
						}
					);
				}

				// Add current timestamp and save
				validTimestamps.push(now);
				await env.DISPOSABLE_EMAIL_DOMAINS.put(
					key,
					JSON.stringify({ timestamps: validTimestamps }),
					{ expirationTtl: windowSeconds }
				);
			} else {
				// First request in this window
				await env.DISPOSABLE_EMAIL_DOMAINS.put(
					key,
					JSON.stringify({ timestamps: [now] }),
					{ expirationTtl: windowSeconds }
				);
			}
		} catch (error) {
			// Fail open - if rate limiting errors, allow the request through
			console.error('[RateLimit] Error checking rate limit:', error);
		}
	};
}
