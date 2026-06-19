/**
 * Request ID middleware for itty-router
 *
 * Assigns a unique requestId to every incoming request using crypto.randomUUID().
 * The ID is attached to the request object so downstream handlers and the
 * structured logger can include it in log output for end-to-end tracing.
 *
 * Pattern follows the existing corsMiddleware: mutate the request object
 * and return undefined to let the router continue to the next handler.
 */

/**
 * Attach a unique requestId to the request object.
 * @param {Request} request - The incoming request (mutated in place)
 */
export function withRequestId(request) {
	request.requestId = crypto.randomUUID();
}
