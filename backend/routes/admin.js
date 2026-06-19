/**
 * Admin routes - user management, storage debug, terminal logs
 * 
 * All routes here require JWT auth + admin privileges.
 * The withAuth and withAdmin middleware are applied at registration time.
 */
import { jsonResponse, corsHeaders } from '../utils/response.js';
import { withAuth } from '../middleware/auth.js';
import { withAdmin } from '../middleware/admin.js';

export function adminRoutes(router) {
	// --- User/storage management ---

	// Debug endpoint for raw storage
	router.get('/api/admin/debug/storage', withAuth, withAdmin, async (request, env) => {
		const id = env.USER_AUTH.idFromName('user-auth-instance');
		const userAuth = env.USER_AUTH.get(id);
		return userAuth.fetch(new Request('http://internal/debug', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				action: 'dump-raw-storage',
				requesterEmail: request.user.email
			})
		}));
	});

	// Clear all data (admin only)
	router.post('/api/admin/clear-storage', withAuth, withAdmin, async (request, env) => {
		console.log('Clear storage request from:', request.user.email);
		const id = env.USER_AUTH.idFromName('user-auth-instance');
		const userAuth = env.USER_AUTH.get(id);
		return userAuth.fetch(new Request('http://internal/admin/clear', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				action: 'clear-all-data',
				requesterEmail: request.user.email
			})
		}));
	});

	// List all users
	router.get('/api/admin/users', withAuth, withAdmin, async (request, env) => {
		const id = env.USER_AUTH.idFromName('user-auth-instance');
		const userAuth = env.USER_AUTH.get(id);
		const response = await userAuth.fetch(new Request('http://internal/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'list-users' })
		}));

		const responseData = await response.json();
		return new Response(JSON.stringify(responseData), {
			status: response.status,
			headers: {
				...corsHeaders,
				'Content-Type': 'application/json',
				'X-Debug-Admin': 'true',
				'X-Debug-Time': new Date().toISOString()
			}
		});
	});

	// Add a new user
	router.post('/api/admin/users', withAuth, withAdmin, async (request, env) => {
		const id = env.USER_AUTH.idFromName('user-auth-instance');
		const userAuth = env.USER_AUTH.get(id);
		const body = await request.json();
		return userAuth.fetch(new Request('http://internal/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				action: 'add-user',
				email: body.email,
				requesterEmail: request.user.email
			})
		}));
	});

	// Delete a user
	router.delete('/api/admin/users/:userId', withAuth, withAdmin, async (request, env) => {
		const id = env.USER_AUTH.idFromName('user-auth-instance');
		const userAuth = env.USER_AUTH.get(id);
		return userAuth.fetch(new Request('http://internal/admin/users', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				action: 'delete-user',
				userId: request.params.userId,
				requesterEmail: request.user.email
			})
		}));
	});

	// --- Terminal log admin endpoints ---

	// List all emails with terminal logs
	router.get('/api/admin/terminal-emails', withAuth, withAdmin, async (request, env) => {
		const logManagerId = env.LOG_MANAGER.idFromName('log-manager-instance');
		const logManager = env.LOG_MANAGER.get(logManagerId);
		return logManager.fetch('http://internal/list-emails-with-logs');
	});

	// Get terminal logs for a specific email
	router.get('/api/admin/terminal-email-logs', withAuth, withAdmin, async (request, env) => {
		const email = new URL(request.url).searchParams.get('email');
		if (!email) {
			return jsonResponse({ success: false, message: 'Email required' }, 400);
		}
		const logManagerId = env.LOG_MANAGER.idFromName('log-manager-instance');
		const logManager = env.LOG_MANAGER.get(logManagerId);
		return logManager.fetch(`http://internal/email-logs?email=${encodeURIComponent(email)}`);
	});

	// Get terminal logs for a specific generation
	router.get('/api/admin/terminal-generation-logs', withAuth, withAdmin, async (request, env) => {
		const generation_id = new URL(request.url).searchParams.get('generation_id');
		if (!generation_id) {
			return jsonResponse({ success: false, message: 'Generation ID required' }, 400);
		}
		const logManagerId = env.LOG_MANAGER.idFromName('log-manager-instance');
		const logManager = env.LOG_MANAGER.get(logManagerId);
		return logManager.fetch(`http://internal/generation-logs?generation_id=${generation_id}`);
	});

	// Clear terminal logs
	router.post('/api/admin/terminal-clear-logs', withAuth, withAdmin, async (request, env) => {
		console.log('Admin request to clear terminal logs from:', request.user.email);
		const logManagerId = env.LOG_MANAGER.idFromName('log-manager-instance');
		const logManager = env.LOG_MANAGER.get(logManagerId);
		return logManager.fetch(new Request('http://internal/clear-terminal-logs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(await request.json())
		}));
	});

	// Get all terminal logs (admin diagnostics)
	router.get('/api/admin/terminal-all-logs', withAuth, withAdmin, async (request, env) => {
		console.log('Admin request to view all terminal logs from:', request.user.email);
		const logManagerId = env.LOG_MANAGER.idFromName('log-manager-instance');
		const logManager = env.LOG_MANAGER.get(logManagerId);
		return logManager.fetch('http://internal/get-all-terminal-logs');
	});
}
