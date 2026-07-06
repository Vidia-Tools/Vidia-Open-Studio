/**
 * RunPod routes - generation, callbacks from Docker handler, direct API calls, runs manager
 */
import jwt from 'jsonwebtoken';
import { jsonResponse } from '../utils/response.js';
import { sendEmail, getVideoReadyEmailTemplate } from '../utils/email.js';
import { withCallbackSecret } from '../middleware/callback-secret.js';
import { withAuth } from '../middleware/auth.js';
import { withRateLimit } from '../middleware/rate-limit.js';
import { validateParams } from '../utils/validate-params.js';
import { runEndpointAsync, pollAsyncRunStatus } from '../services/runpod.js';

export function runpodRoutes(router) {
	// --- Generation ---

	// Start a generation on RunPod - rate limited to prevent GPU abuse (10 per 10 min per IP)
	const handleGenerate = async (request, env) => {
		try {
			const { params, generation_id, plan = 'basic', type = 'full' } = await request.json();

			// Edge validation: reject malformed params before any GPU spend (design section 3 / 10.5.2)
			const validation = validateParams(params);
			if (!validation.valid) {
				return jsonResponse({ success: false, message: validation.error }, 400);
			}

			// Auth is mandatory for GPU compute
			const authHeader = request.headers.get('Authorization') || '';
			const token = authHeader.replace('Bearer ', '');

			let userId = generation_id;

			if (!token) {
				return jsonResponse({ success: false, message: 'Authentication required' }, 401);
			}

			try {
				if (!env.JWT_SECRET) {
					console.error('JWT_SECRET not set in environment variables');
					return jsonResponse({
						success: false,
						message: 'Server configuration error: JWT_SECRET not set'
					}, 500);
				}

				const decoded = jwt.verify(token, env.JWT_SECRET);
				userId = decoded.userId || generation_id;
				console.log(`Token verified successfully for user: ${decoded.email || 'unknown'}`);
			} catch (error) {
				console.error('JWT verification failed:', error.message);
				return jsonResponse({
					success: false,
					message: 'Authentication failed: ' + error.message
				}, 401);
			}

			console.log(`Using client-provided generation_id: ${generation_id} for user: ${userId}`);

			// Forward the params payload opaquely (design section 3). The backend never
			// inspects or builds graphs; the handler assembles the pipeline from params.
			// `type` (preview|full) rides alongside params so the worker can cap preview
			// source-video frames per method (PREVIEW_FRAME_CAPS in runner.py).
			const payload = {
				client_id: generation_id,
				user_id: userId,
				params,
				type
			};

			// Send to RunPod
			const result = await runEndpointAsync(plan, payload, userId, env);

			if (result.error) {
				return jsonResponse({
					success: false,
					message: result.message || 'Failed to start generation on RunPod'
				}, 500);
			}

			// Register the job in WebSocketManager DO
			const wsManagerId = env.WEBSOCKET_MANAGER.idFromName('default');
			const wsManager = env.WEBSOCKET_MANAGER.get(wsManagerId);
			await wsManager.fetch('http://fake/registerJob', {
				method: 'POST',
				body: JSON.stringify({
					runId: result.id,
					clientId: generation_id,
					userId: userId
				})
			});

			console.log(`Registered job ${result.id} with generation_id: ${generation_id} for userID: ${userId}`);

			return jsonResponse({
				success: true,
				runId: result.id,
				message: 'Generation started successfully'
			});
		} catch (error) {
			console.error('RunPod generation error:', error);
			return jsonResponse({
				success: false,
				message: error.message || 'Failed to start generation'
			}, 500);
		}
	};

	// Spec endpoint name is POST /generate (design section 3; local app_server serves
	// the same path). Keep the legacy /api/runpod/generate alias for back-compat.
	router.post('/api/runpod/generate', withRateLimit(10, 600), handleGenerate);
	router.post('/generate', withRateLimit(10, 600), handleGenerate);

	// --- Callbacks from Docker handler (require callback secret) ---

	// Progress update
	router.post('/api/runpod/progress', withCallbackSecret, async (request, env) => {
		try {
			const { generation_id, eventType, progressData } = await request.json();

			const wsManagerId = env.WEBSOCKET_MANAGER.idFromName('default');
			const wsManager = env.WEBSOCKET_MANAGER.get(wsManagerId);

			await wsManager.fetch('http://fake/progress', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ generation_id, eventType, progressData })
			});

			return jsonResponse({ success: true, message: 'Progress update received' });
		} catch (error) {
			console.error('Error processing progress update:', error);
			return jsonResponse({ success: false, message: 'Failed to process progress update' }, 500);
		}
	});

	// Terminal logs from Docker handler
	router.post('/api/runpod/terminal-logs', withCallbackSecret, async (request, env) => {
		try {
			const { generation_id, userId, terminalOutput, timestamp } = await request.json();

			if (!generation_id || !terminalOutput) {
				return jsonResponse({ success: false, message: 'Missing required fields' }, 400);
			}

			// Resolve user email for log association
			let userEmail = 'unknown@user.com';
			if (userId && userId !== 'unknown') {
				try {
					const userAuthId = env.USER_AUTH.idFromName('user-auth-instance');
					const userAuth = env.USER_AUTH.get(userAuthId);

					const userResponse = await userAuth.fetch(new Request('http://internal/get-user', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'get-user', userId })
					}));

					const userData = await userResponse.json();
					if (userData.success && userData.user && userData.user.email) {
						userEmail = userData.user.email;
					}
				} catch (e) {
					console.error('Error getting user email:', e);
				}
			}

			// Store in LogManager DO
			const logManagerId = env.LOG_MANAGER.idFromName('log-manager-instance');
			const logManager = env.LOG_MANAGER.get(logManagerId);

			const logResponse = await logManager.fetch('http://internal/store-terminal-logs', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ generation_id, userId, userEmail, terminalOutput, timestamp })
			});

			if (!logResponse.ok) {
				throw new Error(`Failed to store terminal logs: ${logResponse.status}`);
			}

			return jsonResponse({ success: true, message: 'Terminal logs received' });
		} catch (error) {
			console.error('Error processing terminal logs:', error);
			return jsonResponse({ success: false, message: 'Failed to process terminal logs' }, 500);
		}
	});

	// Video ready notification from Docker handler
	router.post('/api/runpod/videoReady', withCallbackSecret, async (request, env) => {
		try {
			const { generation_id, videoUrl } = await request.json();

			if (!generation_id || !videoUrl) {
				return jsonResponse({ success: false, message: 'Missing required fields' }, 400);
			}

			console.log(`[VideoReady] Received notification for generation_id: ${generation_id}, URL: ${videoUrl}`);

			// Get job info from WebSocketManager
			const wsManagerId = env.WEBSOCKET_MANAGER.idFromName('default');
			const wsManager = env.WEBSOCKET_MANAGER.get(wsManagerId);

			const jobResponse = await wsManager.fetch(`http://fake/getJob?generation_id=${generation_id}`);
			const jobData = await jobResponse.json();

			if (!jobData.success || !jobData.job) {
				console.error(`[VideoReady] No job found for generation_id: ${generation_id}`);
				return jsonResponse({ success: false, message: 'Job not found' }, 404);
			}

			const userId = jobData.job.userId;
			console.log(`[VideoReady] Found userId: ${userId} for generation_id: ${generation_id}`);

			// Store video in history
			const vhmId = env.VIDEO_HISTORY_MANAGER.idFromName('default');
			const videoHistoryManager = env.VIDEO_HISTORY_MANAGER.get(vhmId);

			// Idempotency: if a video already exists for this generation_id
			// (duplicate callback from pod/node), skip the store and email but
			// still send the WS videoReady event and return success.
			const existingResponse = await videoHistoryManager.fetch(
				`http://internal/byGeneration?generation_id=${encodeURIComponent(generation_id)}`);
			const existingData = await existingResponse.json();

			if (existingData.success && existingData.video) {
				console.log(`[VideoReady] Duplicate callback for generation_id: ${generation_id}, skipping store + email`);
			} else {
				await videoHistoryManager.fetch(new Request('http://internal/store', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						userId,
						videoUrl,
						title: `Video ${new Date().toISOString()}`,
						generation_id
					})
				}));

				console.log(`[VideoReady] Stored video in history for user ${userId}`);

				// Send email notification (non-blocking on failure)
				try {
					const userAuthId = env.USER_AUTH.idFromName('user-auth-instance');
					const userAuth = env.USER_AUTH.get(userAuthId);

					const userResponse = await userAuth.fetch(new Request('http://internal/admin/users', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'get-user', userId })
					}));

					const userData = await userResponse.json();

					if (userData.success && userData.user) {
						const userEmail = userData.user.email;
						const userName = userData.user.name || null;
						const templateData = getVideoReadyEmailTemplate(userName, videoUrl, env);

						console.log(`[VideoReady] Sending notification to: ${userEmail}`);
						const emailResult = await sendEmail(env, userEmail, templateData);

						if (emailResult.success) {
							console.log(`[VideoReady] Successfully sent notification to ${userEmail}`);
						} else {
							console.error(`[VideoReady] Failed to send email: ${emailResult.message}`);
						}
					} else {
						console.error('[VideoReady] Failed to get user data for email notification');
					}
				} catch (emailError) {
					console.error('[VideoReady] Email sending error:', emailError);
				}
			}

			// Send videoReady event via WebSocket
			await wsManager.fetch('http://fake/progress', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					generation_id,
					eventType: 'videoReady',
					progressData: { status: 'completed', videoUrl }
				})
			});

			console.log('[VideoReady] Sent videoReady event via WebSocket');

			return jsonResponse({ success: true, message: 'Video ready notification processed' });
		} catch (error) {
			console.error('[VideoReady] Error processing video ready notification:', error);
			return jsonResponse({ success: false, message: 'Failed to process video ready notification' }, 500);
		}
	});

	// Worker restart endpoint. Restart is NOT implemented in Open Studio v1: there
	// is no real RunPod restart path behind this route. The endpoint is kept so
	// imports/routes stay intact, but it is now authenticated, rate limited, and
	// returns 501 Not Implemented rather than a misleading 202 success.
	router.post('/api/runpod/restartWorker', withAuth, withRateLimit(3, 600), async (request, env) => {
		try {
			const { generation_id } = await request.json();
			if (!generation_id) {
				return jsonResponse({ success: false, message: 'Missing required field: generation_id' }, 400);
			}
			console.log(`[RestartWorker] Request received for generation_id: ${generation_id}`);
			return jsonResponse({
				success: false,
				message: 'Worker restart is not supported in Open Studio v1. Restart is disabled until a secured restart implementation exists.',
				generation_id
			}, 501);
		} catch (error) {
			console.error('Restart endpoint error:', error);
			return jsonResponse({ success: false, message: 'Failed to process restart request' }, 500);
		}
	});

	// --- Direct RunPod API calls ---

	router.post('/api/runpod/pollAsyncRunStatus', withAuth, withRateLimit(30, 600), async (request, env) => {
		const { plan, generation_id } = await request.json();
		const status = await pollAsyncRunStatus(plan, generation_id, env);
		return jsonResponse({ success: true, status });
	});

	// --- RunpodRunManager DO forwarding ---

	router.get('/api/runpod/runs/:userId', withAuth, withRateLimit(30, 600), async (request, env) => {
		const requestedUserId = request.params.userId;
		const tokenUserId = request.user && request.user.userId;

		// Enforce per-user ownership: a user may only list their own runs.
		// Admins (email matches env.ADMIN_EMAIL) may list any user's runs.
		// These checks run before any DO access so 401/403 never reach the DO.
		if (!tokenUserId) {
			return jsonResponse({ success: false, message: 'Forbidden: authentication token did not include a user identity' }, 403);
		}

		const isAdminUser = request.user.email === env.ADMIN_EMAIL;
		if (requestedUserId !== tokenUserId && !isAdminUser) {
			return jsonResponse({ success: false, message: 'Forbidden: you may only list your own runs' }, 403);
		}

		const id = env.RUNPOD_RUN_MANAGER.idFromName('default');
		const runManager = env.RUNPOD_RUN_MANAGER.get(id);

		const userId = requestedUserId;
		const status = new URL(request.url).searchParams.get('status');

		let response;
		if (status) {
			response = await runManager.fetch(`http://fake/getUsersRunsByStatus?userId=${userId}&status=${status}`);
		} else {
			response = await runManager.fetch(`http://fake/getUsersRuns?userId=${userId}`);
		}

		const runs = await response.json();
		return jsonResponse({ success: true, runs });
	});
}
