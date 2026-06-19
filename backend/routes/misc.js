/**
 * Miscellaneous routes - health, newsletter, payments, websocket, logging, secure workflow
 * 
 * Small endpoints that don't warrant their own route file.
 */
import jwt from 'jsonwebtoken';
import { jsonResponse, corsHeaders } from '../utils/response.js';
import { isDisposableEmail, addToMailerLite } from '../utils/email.js';

export function miscRoutes(router) {
	// Health check
	router.get('/', (request) => {
		return new Response('Hello World!', {
			headers: corsHeaders,
		});
	});

	// Newsletter subscription
	router.post('/api/newsletter/subscribe', async (request, env) => {
		try {
			const { email, turnstileToken } = await request.json();

			// Validate Turnstile
			const turnstileResponse = await fetch(
				'https://challenges.cloudflare.com/turnstile/v0/siteverify',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						secret: env.TURNSTILE_SECRET_KEY_NEWSLETTER,
						response: turnstileToken
					})
				}
			);

			const turnstileResult = await turnstileResponse.json();
			if (!turnstileResult.success) {
				return jsonResponse({
					success: false,
					message: 'Security verification failed'
				}, 400);
			}

			// Block disposable emails
			if (await isDisposableEmail(email, env)) {
				return jsonResponse({
					success: false,
					message: 'Please use a permanent email address'
				}, 400);
			}

			// Add to MailerLite Newsletter group
			const country = request.cf?.country || 'Unknown';
			await addToMailerLite(email, env.MAILERLITE_NEWSLETTER_GROUP_ID, country, env);

			return jsonResponse({
				success: true,
				message: 'Thanks for subscribing! Check your email for confirmation.'
			});
		} catch (error) {
			console.error('Newsletter subscription error:', error);
			return jsonResponse({
				success: false,
				message: 'Subscription failed. Please try again.'
			}, 500);
		}
	});

	// Payments - forward to PaymentManager DO.
	// EXPERIMENTAL / out of scope for v1: the Stripe flow is decorative (credits are
	// never granted). Disabled by default; opt in with VIDIA_PAYMENTS_ENABLED=true.
	router.all('/api/payments/*', async (request, env) => {
		if (env.VIDIA_PAYMENTS_ENABLED !== 'true') {
			return jsonResponse({ success: false, message: 'Payments are disabled (experimental)' }, 503);
		}
		const id = env.PAYMENT_MANAGER.idFromName('payment-manager-instance');
		const obj = env.PAYMENT_MANAGER.get(id);
		return obj.fetch(request);
	});

	// WebSocket upgrade
	router.get('/ws', handleWebSocket);
	router.get('/api/ws', handleWebSocket);
	router.get('/api/ws/*', handleWebSocket);

	// Logging - forward to LogManager DO
	// The /logging/* alias (without /api/ prefix) is needed because the RunPod handler
	// and some internal callers use the non-prefixed path
	router.all('/api/logging/*', forwardToLogManager);
	router.all('/logging/*', forwardToLogManager);
}

// Forward to LogManager DO, rewriting /logging/* to /api/logging/* if needed
// so the DO's internal path matching works correctly
async function forwardToLogManager(request, env) {
	const logManagerId = env.LOG_MANAGER.idFromName('log-manager-instance');
	const logManager = env.LOG_MANAGER.get(logManagerId);

	const url = new URL(request.url);
	// Rewrite non-prefixed /logging/* to /api/logging/* for DO compatibility
	if (!url.pathname.startsWith('/api/')) {
		url.pathname = '/api' + url.pathname;
		const rewritten = new Request(url.toString(), request);
		return logManager.fetch(rewritten);
	}
	return logManager.fetch(request);
}

// Shared WebSocket handler
async function handleWebSocket(request, env) {
	const clientId = new URL(request.url).searchParams.get('clientId');
	if (!clientId) {
		return jsonResponse({ success: false, message: 'Missing clientId parameter' }, 400);
	}

	const wsManagerId = env.WEBSOCKET_MANAGER.idFromName('default');
	const wsManager = env.WEBSOCKET_MANAGER.get(wsManagerId);
	return wsManager.fetch(request);
}
