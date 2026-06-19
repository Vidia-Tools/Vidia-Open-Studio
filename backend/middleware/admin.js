/**
 * Admin authorization middleware for itty-router
 * 
 * Must be used AFTER withAuth middleware, since it reads request.user.
 * Checks if the authenticated user's email matches the admin email.
 */
import { jsonResponse } from '../utils/response.js';

/**
 * itty-router middleware: require admin privileges.
 * Assumes request.user is already set by withAuth.
 * Returns 401 if the user is not an admin (compared against env.ADMIN_EMAIL).
 */
export function withAdmin(request, env) {
	if (!request.user || request.user.email !== env.ADMIN_EMAIL) {
		return jsonResponse({ success: false, message: 'Unauthorized' }, 401);
	}
}

/**
 * Check if an email belongs to an admin.
 * Useful for inline checks in route handlers that need the boolean.
 * @param {string} email
 * @param {Object} env - Worker environment bindings (provides ADMIN_EMAIL)
 * @returns {boolean}
 */
export function isAdmin(email, env) {
	return email === env.ADMIN_EMAIL;
}
