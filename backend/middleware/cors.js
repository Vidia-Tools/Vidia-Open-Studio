/**
 * CORS middleware for itty-router
 * 
 * Reflects the request origin if it matches an allowed domain,
 * otherwise defaults to the primary domain (which won't match,
 * so the browser blocks the request).
 */

/**
 * Static CORS headers for Durable Objects and non-browser/internal responses.
 * Self-hosted deployments gate cross-origin access at the preflight allowlist
 * (see makeCorsHeaders); response bodies use a permissive ACAO so the browser
 * can read them. Auth rides in the Authorization header, never cookies, so a
 * wildcard origin here does not expose credentialed state.
 */
const DEFAULT_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS,DELETE',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	'Access-Control-Max-Age': '86400',
};

/**
 * Parse the comma-separated ALLOWED_ORIGINS env var into a trimmed list.
 * @param {Object} env - Worker environment bindings
 * @returns {string[]} Allowed origin strings
 */
function parseAllowedOrigins(env) {
	const raw = env?.ALLOWED_ORIGINS || '';
	return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Resolve the Access-Control-Allow-Origin value for a request by reflecting
 * the request origin when it is in the env allowlist (localhost on any port is
 * always allowed for local development).
 * @param {Request} request
 * @param {Object} env
 * @returns {string}
 */
function getCorsOrigin(request, env) {
	const origin = request?.headers?.get('Origin') || '';
	const allowed = parseAllowedOrigins(env);
	if (allowed.includes(origin) || origin.startsWith('http://localhost:')) {
		return origin;
	}
	return allowed[0] || '';
}

/**
 * Build reflective CORS headers for a given request using the env allowlist.
 * @param {Request} request
 * @param {Object} env
 * @returns {Object}
 */
function makeCorsHeaders(request, env) {
	return {
		'Access-Control-Allow-Origin': getCorsOrigin(request, env),
		'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS,DELETE',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Max-Age': '86400',
	};
}

/**
 * itty-router middleware: handles OPTIONS preflight and sets CORS headers.
 * When used in the router's `before` array, this runs before every handler.
 * Returning a Response from a `before` handler short-circuits the router.
 */
function corsMiddleware(request, env) {
	if (request.method === 'OPTIONS') {
		return new Response(null, { headers: makeCorsHeaders(request, env) });
	}
	// Stash CORS headers on the request so route handlers can access them
	request.corsHeaders = makeCorsHeaders(request, env);
}

export { DEFAULT_CORS_HEADERS, parseAllowedOrigins, getCorsOrigin, makeCorsHeaders, corsMiddleware };
