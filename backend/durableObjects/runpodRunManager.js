export class RunpodRunManager {
	constructor(state) {
		this.state = state;
	}
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/registerRun') {
			const { userId, generation_id } = await request.json();
			await this.registerRun(userId, generation_id);
			return new Response('Run registered successfully');
		}

		if (url.pathname === '/getUsersRuns') {
			const userId = url.searchParams.get('userId');
			const runs = await this.getUsersRuns(userId);
			return new Response(JSON.stringify(runs), {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		if (url.pathname === '/getUsersRunsByStatus') {
			const userId = url.searchParams.get('userId');
			const status = url.searchParams.get('status');
			const runs = await this.getUsersRunsByStatus(userId, status);
			return new Response(JSON.stringify(runs), {
				headers: { 'Content-Type': 'application/json' },
			});
		}
		
		if (url.pathname === '/updateRunStatus' && request.method === 'POST') {
			const { generation_id, status, progress } = await request.json();
			await this.updateRunStatus(generation_id, status, progress);
			return new Response('Run status updated successfully');
		}
		
		if (url.pathname === '/getRunDetails') {
			const generation_id = url.searchParams.get('generation_id');
			if (!generation_id) {
				return new Response('Missing generation_id parameter', { status: 400 });
			}
			const runDetails = await this.getRunDetails(generation_id);
			if (!runDetails) {
				return new Response('Run not found', { status: 404 });
			}
			return new Response(JSON.stringify(runDetails), {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		return new Response('Not found', { status: 404 });
	}

	// This method is replaced by the enhanced version below that also maintains a mapping

	async getUsersRuns(userId) {
		return (await this.state.storage.get(userId)) || [];
	}

	async getUsersRunsByStatus(userId, status) {
		const runs = await this.getUsersRuns(userId);
		return runs.filter((run) => run.status === status);
	}

	/**
	 * Updates the status and progress information for a specific run
	 * @param {string} generation_id - The generation ID to update
	 * @param {string} status - The new status of the run ('pending', 'in_progress', 'completed', 'error')
	 * @param {Object} progress - Optional progress data including percentage, current step, etc.
	 * @returns {boolean} True if the generation was found and updated, false otherwise
	 */
	async updateRunStatus(generation_id, status, progress) {
		// We store a generation_idToUser mapping for efficient lookups
		const mapping = await this.state.storage.get('generation_idToUser') || {};
		const userId = mapping[generation_id];
		
		if (!userId) {
			console.error(`No user found for generation_id: ${generation_id}`);
			return false;
		}
		
		const userRuns = await this.state.storage.get(userId);
		if (!userRuns) {
			console.error(`No runs found for userId: ${userId}`);
			return false;
		}
		
		const runIndex = userRuns.findIndex(run => run.generation_id === generation_id);
		if (runIndex === -1) {
			console.error(`Generation ${generation_id} not found for user ${userId}`);
			return false;
		}
		
		// Update the run status
		userRuns[runIndex].status = status;
		
		// Set completion flags based on status
		if (status === 'completed') {
			userRuns[runIndex].completed = true;
			userRuns[runIndex].succeeded = true;
			userRuns[runIndex].executionTime = Date.now() - userRuns[runIndex].started;
			
			// Add expiration date (7 days from now)
			userRuns[runIndex].expirationDate = Date.now() + (7 * 24 * 60 * 60 * 1000);
			
			// Store video URL if available
			if (progress && progress.videoUrl) {
				userRuns[runIndex].videoUrl = progress.videoUrl;
			}
		} else if (status === 'error') {
			userRuns[runIndex].completed = true;
			userRuns[runIndex].succeeded = false;
			userRuns[runIndex].error = progress ? progress.error : 'Unknown error';
		}
		
		// Store any progress data
		if (progress) {
			userRuns[runIndex].progress = progress;
			userRuns[runIndex].lastUpdate = Date.now();
		}
		
		// Update the user's runs
		await this.state.storage.put(userId, userRuns);
		return true;
	}
	
	/**
	 * Get detailed information about a specific run
	 * @param {string} generation_id - The generation ID to retrieve
	 * @returns {Object|null} The run details or null if not found
	 */
	async getRunDetails(generation_id) {
		// Look up the userId from the mapping
		const mapping = await this.state.storage.get('generation_idToUser') || {};
		const userId = mapping[generation_id];
		
		if (!userId) {
			return null;
		}
		
		const userRuns = await this.state.storage.get(userId);
		if (!userRuns) {
			return null;
		}
		
		return userRuns.find(run => run.generation_id === generation_id) || null;
	}
	
	/**
	 * Registers a new generation run and maintains a generation_id to userId mapping
	 * for efficient lookups
	 * @param {string} userId - The user ID associated with this generation
	 * @param {string} generation_id - The unique generation identifier
	 */
	async registerRun(userId, generation_id) {
		// Get existing runs for this user or create new array
		const userRuns = (await this.state.storage.get(userId)) || [];

		const newRun = {
			userId,
			generation_id,
			status: 'pending',
			completed: false,
			workerId: null,
			started: Date.now(),
			succeeded: false,
			delayTime: 0,
			executionTime: 0,
		};

		userRuns.push(newRun);
		await this.state.storage.put(userId, userRuns);
		
		// Update the generation_id to userId mapping for efficient lookups
		const mapping = await this.state.storage.get('generation_idToUser') || {};
		mapping[generation_id] = userId;
		await this.state.storage.put('generation_idToUser', mapping);
	}
}
