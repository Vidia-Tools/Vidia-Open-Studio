/**
 * JWT authentication middleware for itty-router
 * 
 * Extracts and verifies the Bearer token from the Authorization header.
 * If valid, attaches the decoded user to request.user.
 * If invalid or missing, returns 401.
 */
import jwt from 'jsonwebtoken';
import { jsonResponse } from '../utils/response.js';

/**
 * itty-router middleware: require a valid JWT token.
 * Returns a 401 Response if the token is missing or invalid,
 * which short-circuits the router. Otherwise returns nothing (undefined)
 * so the next handler runs.
 */
export function withAuth(request, env) {
	const authHeader = request.headers.get('Authorization') || '';
	const token = authHeader.replace('Bearer ', '');

	if (!token) {
		return jsonResponse({ success: false, message: 'No session token provided' }, 401);
	}

	try {
		const decoded = jwt.verify(token, env.JWT_SECRET);
		// Attach decoded token payload so downstream handlers can use it
		request.user = decoded;
	} catch (error) {
		return jsonResponse({ success: false, message: 'Invalid or expired token' }, 401);
	}
}
