/**
 * Video history routes - store, retrieve, and admin cleanup of video records
 */
import { jsonResponse } from '../utils/response.js';
import { sendEmail, getVideoReadyEmailTemplate } from '../utils/email.js';
import { withAuth } from '../middleware/auth.js';
import { withAdmin } from '../middleware/admin.js';

export function videosRoutes(router) {
	// Store a video for a user
	router.post('/api/videos/store', withAuth, async (request, env) => {
		const vhmId = env.VIDEO_HISTORY_MANAGER.idFromName('default');
		const videoHistoryManager = env.VIDEO_HISTORY_MANAGER.get(vhmId);

		try {
			const {
				videoUrl,
				title,
				generation_id = null,
				runId = null,
				sendNotification = false
			} = await request.json();

			const finalUserId = request.user.userId;
			if (!finalUserId) {
				return jsonResponse({ success: false, message: 'userId is required' }, 400);
			}

			const finalGenerationID = generation_id || runId;

			// Store the video
			await videoHistoryManager.fetch(new Request('http://internal/store', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: finalUserId,
					videoUrl,
					title,
					generation_id: finalGenerationID
				})
			}));

			console.log(`Stored video in history for user ${finalUserId}${finalGenerationID ? ` (generation_id: ${finalGenerationID})` : ''}`);

			// Send email notification if requested
			if (sendNotification) {
				console.log(`[EMAIL] Notification requested for video URL: ${videoUrl.substring(0, 40)}...`);
				try {
					console.log(`[EMAIL] Looking up user data for userId: ${finalUserId}`);
					const userAuthId = env.USER_AUTH.idFromName('user-auth-instance');
					const userAuth = env.USER_AUTH.get(userAuthId);

					const userResponse = await userAuth.fetch(new Request('http://internal/admin/users', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'get-user', userId: finalUserId })
					}));

					const userData = await userResponse.json();
					console.log(`[EMAIL] User lookup result: ${userData.success ? 'Success' : 'Failed'}, Email found: ${userData.user?.email ? 'Yes' : 'No'}`);

					if (userData.success && userData.user) {
						const userEmail = userData.user.email;
						const userName = userData.user.name || null;
						const templateData = getVideoReadyEmailTemplate(userName, videoUrl);

						console.log(`[EMAIL] Sending notification to: ${userEmail}`);
						const emailResult = await sendEmail(env, userEmail, templateData);
						console.log(`[EMAIL] Email API response: ${JSON.stringify(emailResult)}`);

						if (emailResult.success) {
							console.log(`[EMAIL] Successfully sent notification to ${userEmail}`);
						} else {
							console.error(`[EMAIL] Failed to send email: ${emailResult.message}`);
						}
					} else {
						console.error('[EMAIL] Failed to get user data for email notification');
					}
				} catch (emailError) {
					console.error(`[EMAIL] Email sending error: ${emailError.message}`, emailError);
				}
			}

			return jsonResponse({ success: true, message: 'Video stored in history' });
		} catch (error) {
			console.error('Error storing video:', error);
			return jsonResponse({
				success: false,
				message: 'Failed to store video',
				details: error.message
			}, 500);
		}
	});

	// Get videos for a user
	router.get('/api/videos/user/:userId', withAuth, async (request, env) => {
		const vhmId = env.VIDEO_HISTORY_MANAGER.idFromName('default');
		const videoHistoryManager = env.VIDEO_HISTORY_MANAGER.get(vhmId);

		try {
			const userId = request.params.userId;
			if (!userId) {
				return jsonResponse({ success: false, message: 'userId is required' }, 400);
			}

			if (userId !== request.user.userId && request.user.email !== env.ADMIN_EMAIL) {
				return jsonResponse({ success: false, message: 'Forbidden' }, 403);
			}

			const response = await videoHistoryManager.fetch(
				`http://internal/list?userId=${userId}`
			);

			if (!response.ok) {
				throw new Error(`Failed to get user videos: ${response.status}`);
			}

			const data = await response.json();
			return jsonResponse({ success: true, videos: data.videos });
		} catch (error) {
			console.error('Error getting user videos:', error);
			return jsonResponse({
				success: false,
				message: 'Failed to get user videos',
				details: error.message
			}, 500);
		}
	});

	// Get video by generation_id
	router.get('/api/videos/byGeneration', withAuth, async (request, env) => {
		const vhmId = env.VIDEO_HISTORY_MANAGER.idFromName('default');
		const videoHistoryManager = env.VIDEO_HISTORY_MANAGER.get(vhmId);

		try {
			const generation_id = new URL(request.url).searchParams.get('generation_id');
			if (!generation_id) {
				return jsonResponse({ success: false, message: 'generation_id parameter is required' }, 400);
			}

			const response = await videoHistoryManager.fetch(
				`http://internal/byGeneration?generation_id=${generation_id}`
			);

			if (!response.ok) {
				const errorMsg = response.status === 404
					? 'No video found for this generation_id'
					: `Error looking up video: ${response.status}`;
				return jsonResponse({ success: false, message: errorMsg }, response.status);
			}

			const data = await response.json();

			// VHM generation mapping stores the owning userId; enforce ownership
			if (data.video && data.video.userId !== request.user.userId && request.user.email !== env.ADMIN_EMAIL) {
				return jsonResponse({ success: false, message: 'Forbidden' }, 403);
			}

			return jsonResponse(data);
		} catch (error) {
			console.error('Error getting video by generation_id:', error);
			return jsonResponse({
				success: false,
				message: 'Failed to get video by generation_id',
				details: error.message
			}, 500);
		}
	});

	// Clear expired videos (admin only)
	router.post('/api/videos/clearExpired', withAuth, withAdmin, async (request, env) => {
		const vhmId = env.VIDEO_HISTORY_MANAGER.idFromName('default');
		const videoHistoryManager = env.VIDEO_HISTORY_MANAGER.get(vhmId);

		try {
			await videoHistoryManager.fetch('http://internal/clearExpired', { method: 'POST' });
			return jsonResponse({ success: true, message: 'Expired videos cleared' });
		} catch (error) {
			console.error('Error clearing expired videos:', error);
			return jsonResponse({
				success: false,
				message: 'Failed to clear expired videos',
				details: error.message
			}, 500);
		}
	});

	// Clear a specific user's videos (admin only)
	router.post('/api/videos/clearUser', withAuth, withAdmin, async (request, env) => {
		const vhmId = env.VIDEO_HISTORY_MANAGER.idFromName('default');
		const videoHistoryManager = env.VIDEO_HISTORY_MANAGER.get(vhmId);

		try {
			const { userId } = await request.json();
			if (!userId) {
				return jsonResponse({ success: false, message: 'userId is required' }, 400);
			}

			await videoHistoryManager.fetch('http://internal/clear', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});

			return jsonResponse({ success: true, message: `Videos cleared for user ${userId}` });
		} catch (error) {
			console.error('Error clearing user videos:', error);
			return jsonResponse({
				success: false,
				message: 'Failed to clear user videos',
				details: error.message
			}, 500);
		}
	});
}
