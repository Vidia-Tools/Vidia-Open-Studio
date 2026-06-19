export class VideoHistoryManager {
	constructor(state) {
		this.state = state;
		
		// Schedule daily cleanup alarm (24 hours)
		const now = Date.now();
		this.state.storage.setAlarm(now + 24 * 60 * 60 * 1000);
	}
	
	// Alarm handler - runs when the alarm fires
	async alarm() {
		console.log("Running scheduled cleanup of expired videos");
		await this.clearExpiredVideos();
		
		// Reschedule the alarm for the next day
		const now = Date.now();
		this.state.storage.setAlarm(now + 24 * 60 * 60 * 1000);
	}

	async fetch(request) {
		const url = new URL(request.url);
		const method = request.method;

		// Store a video for a user
		if (url.pathname === '/store' && method === 'POST') {
			const { userId, videoUrl, title = 'Video Generation', generation_id = null } = await request.json();
			
			if (!userId || !videoUrl) {
				return new Response(JSON.stringify({ 
					success: false, 
					message: 'Missing required fields'
				}), { 
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			
			await this.storeVideo(userId, videoUrl, title, generation_id);
			return new Response(JSON.stringify({ 
				success: true, 
				message: 'Video stored successfully'
			}), { 
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Get all videos for a user
		if (url.pathname === '/list' && method === 'GET') {
			const userId = url.searchParams.get('userId');
			
			if (!userId) {
				return new Response(JSON.stringify({ 
					success: false, 
					message: 'Missing userId parameter'
				}), { 
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			
			const videos = await this.getUserVideos(userId);
			return new Response(JSON.stringify({ 
				success: true,
				videos 
			}), {
				headers: { 'Content-Type': 'application/json' },
			});
		}
		
		// Get video by generation_id
		if (url.pathname === '/byGeneration' && method === 'GET') {
			const generation_id = url.searchParams.get('generation_id');
			
			if (!generation_id) {
				return new Response(JSON.stringify({ 
					success: false, 
					message: 'Missing generation_id parameter'
				}), { 
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			
			const video = await this.getVideoByGenerationID(generation_id);
			
			if (!video) {
				return new Response(JSON.stringify({ 
					success: false, 
					message: 'No video found for this generation_id'
				}), { 
					status: 404,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			
			return new Response(JSON.stringify({ 
				success: true,
				video 
			}), {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Clear all videos for a user (admin function)
		if (url.pathname === '/clear' && method === 'POST') {
			const { userId } = await request.json();
			
			if (!userId) {
				return new Response('Missing userId parameter', { status: 400 });
			}
			
			await this.clearUserVideos(userId);
			return new Response('User videos cleared successfully');
		}

		// Clear expired videos (can be run on a schedule)
		if (url.pathname === '/clearExpired' && method === 'POST') {
			await this.clearExpiredVideos();
			return new Response('Expired videos cleared successfully');
		}

		return new Response('Not found', { status: 404 });
	}

	/**
	 * Store a video URL for a user
	 * @param {string} userId - User ID
	 * @param {string} videoUrl - URL to the video
	 * @param {string} title - Optional title for the video
	 * @param {string} generation_id - Optional ID linking to the specific generation
	 */
	async storeVideo(userId, videoUrl, title = 'Video Generation', generation_id = null) {
		// Get existing videos for this user or create new array
		const userVideos = await this.getUserVideos(userId);
		
		// Add the new video with metadata
		const now = Date.now();
		const expirationDate = now + (7 * 24 * 60 * 60 * 1000); // 7 days from now
		
		const videoEntry = {
			videoUrl,
			title,
			createdAt: now,
			expirationDate
		};
		
		// Add generation_id if provided
		if (generation_id) {
			videoEntry.generation_id = generation_id;
			
			// Also store a direct mapping from generation_id to videoUrl for quick lookup
			await this.state.storage.put(`generation:${generation_id}:video`, {
				videoUrl,
				userId,
				createdAt: now,
				expirationDate
			});
			
			console.log(`Stored generation mapping: ${generation_id} -> video for user ${userId}`);
		}
		
		userVideos.push(videoEntry);
		
		// Save back to storage
		await this.state.storage.put(userId, userVideos);
		
		console.log(`Stored video for user ${userId}: ${videoUrl}${generation_id ? ` (generation_id: ${generation_id})` : ''}`);
	}

	/**
	 * Get all non-expired videos for a user
	 * Also performs cleanup of expired videos when called
	 * @param {string} userId - User ID
	 * @returns {Array} Array of video objects
	 */
	async getUserVideos(userId) {
		// Get videos from storage
		const allVideos = await this.state.storage.get(userId) || [];
		
		// Filter out expired videos
		const now = Date.now();
		const activeVideos = allVideos.filter(video => 
			video.expirationDate > now
		);
		
		// If we found expired videos, remove them from storage
		if (activeVideos.length < allVideos.length) {
			console.log(`Auto-cleaned ${allVideos.length - activeVideos.length} expired videos for user ${userId}`);
			
			// If no active videos remain, delete the entire entry
			if (activeVideos.length === 0) {
				await this.state.storage.delete(userId);
			} else {
				// Otherwise, store the filtered list
				await this.state.storage.put(userId, activeVideos);
			}
		}
		
		// Sort by creation date (newest first)
		activeVideos.sort((a, b) => b.createdAt - a.createdAt);
		
		return activeVideos;
	}

	/**
	 * Clear all videos for a user
	 * @param {string} userId - User ID
	 */
	async clearUserVideos(userId) {
		await this.state.storage.delete(userId);
		console.log(`Cleared all videos for user ${userId}`);
	}

	/**
	 * Clear all expired videos across all users
	 * This is a more intensive operation that should be run periodically
	 */
	/**
	 * Get a video by its generation_id
	 * @param {string} generation_id - The unique generation ID
	 * @returns {Object|null} Video entry or null if not found
	 */
	async getVideoByGenerationID(generation_id) {
		// Look up the video using the generation mapping
		const videoData = await this.state.storage.get(`generation:${generation_id}:video`);
		
		if (!videoData) {
			console.log(`No video found for generation_id: ${generation_id}`);
			return null;
		}
		
		console.log(`Found video for generation_id: ${generation_id}`);
		return videoData;
	}

	async clearExpiredVideos() {
		// Get all user IDs
		const userIds = await this.state.storage.list()
			.then(list => Array.from(list.keys()).filter(key => !key.startsWith('generation:')));
		
		// Process each user
		const now = Date.now();
		let totalCleared = 0;
		
		for (const userId of userIds) {
			const allVideos = await this.state.storage.get(userId) || [];
			const activeVideos = allVideos.filter(video => video.expirationDate > now);
			
			// If we filtered any out, update storage
			if (activeVideos.length < allVideos.length) {
				// Keep track of expired videos that had generation_ids to clean up those mappings too
				const expiredVideos = allVideos.filter(video => video.expirationDate <= now);
				
				// Clean up generation mappings for expired videos
				for (const video of expiredVideos) {
					if (video.generation_id) {
						await this.state.storage.delete(`generation:${video.generation_id}:video`);
						console.log(`Cleaned up expired generation mapping: ${video.generation_id}`);
					}
				}
				
				totalCleared += (allVideos.length - activeVideos.length);
				
				if (activeVideos.length === 0) {
					// No videos left, remove the entry
					await this.state.storage.delete(userId);
				} else {
					// Save the filtered list
					await this.state.storage.put(userId, activeVideos);
				}
			}
		}
		
		console.log(`Cleared ${totalCleared} expired videos`);
	}
}
