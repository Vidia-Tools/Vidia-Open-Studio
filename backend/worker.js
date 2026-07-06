/**
 * Vidia Backend - Cloudflare Worker Entry Point
 * 
 * This is the thin entry point that wires together the router,
 * middleware, route modules, and Durable Object exports.
 * All business logic lives in the routes/ directory.
 */
import { Router } from 'itty-router';
import { corsMiddleware } from './middleware/cors.js';
import { withRequestId } from './middleware/request-id.js';
import { jsonResponse } from './utils/response.js';

// Route modules
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { runpodRoutes } from './routes/runpod.js';
import { filesRoutes } from './routes/files.js';
import { videosRoutes } from './routes/videos.js';
import { generationRoutes } from './routes/generation.js';
import { miscRoutes } from './routes/misc.js';

// --- Durable Object re-exports (required by Cloudflare - must be from the main module) ---
export { LogManager } from './durableObjects/logManager.js';
export { UserAuth } from './durableObjects/userAuth.js';
export { PaymentManager } from './durableObjects/paymentManager.js';
export { RunpodRunManager } from './durableObjects/runpodRunManager.js';
export { VidiaGenerationManager } from './durableObjects/vidiaGenerationManager.js';
export { WebSocketManager } from './durableObjects/websocketManager.js';
export { VideoHistoryManager } from './durableObjects/videoHistoryManager.js';

// --- Router setup ---
const router = Router();

// CORS middleware runs before every route handler
router.all('*', corsMiddleware);

// Assign a unique requestId to each request for structured logging and tracing
router.all('*', withRequestId);

// Register route modules (order matters for specificity - more specific routes first)
generationRoutes(router);  // /api/vidiaGeneration/* (specific routes before wildcard)
authRoutes(router);        // /api/auth/*
adminRoutes(router);       // /api/admin/*
runpodRoutes(router);      // /api/runpod/*
filesRoutes(router);       // /api/fileUpload/*
videosRoutes(router);      // /api/videos/*
	miscRoutes(router);        // /, /ws, /api/payments/*, /api/logging/*, /api/newsletter/*

// 404 fallback
router.all('*', () => jsonResponse({ success: false, error: 'Not Found' }, 404));

// --- Worker exports ---
export default {
	// Scheduled handler for cron-triggered tasks
	async scheduled(event, env, ctx) {
		// Automated monthly update of disposable email domains
		console.log('Running scheduled KV update for disposable email domains');
		try {
			const response = await fetch(
				'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf'
			);

			if (!response.ok) {
				throw new Error(`Failed to fetch domain list: ${response.status}`);
			}

			const domainsText = await response.text();
			const domains = domainsText.split('\n').filter(d => d.trim() && !d.startsWith('#'));

			console.log(`Updating ${domains.length} disposable email domains in KV`);

			const domainsArray = domains.map(d => d.toLowerCase().trim());
			await env.DISPOSABLE_EMAIL_DOMAINS.put('__blocklist__', JSON.stringify(domainsArray));

			console.log(`Successfully updated ${domainsArray.length} disposable email domains`);
		} catch (error) {
			console.error('Failed to update disposable email domains:', error);
		}
	},

	// HTTP request handler - delegates to itty-router
	async fetch(request, env, ctx) {
		try {
			// Debug logging for all requests
			const url = new URL(request.url);
			console.log(`Worker request: ${request.method} ${url.pathname}`);

			return await router.fetch(request, env, ctx);
		} catch (error) {
			console.error('Error:', error);
			return jsonResponse(
				{
					success: false,
					error: 'Server error',
				},
				500
			);
		}
	},
};
