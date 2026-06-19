export class VidiaGenerationManager {
	constructor(state) {
		this.state = state;
	}

	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/api/vidiaGeneration' && request.method === 'POST') {
			const { userId, runId, status, completed, dateUpdated, dateCompleted, filename, fileSize, fileType, fileUrl, vidiaProduct } =
				await request.json();
			await this.saveVidiaGeneration({
				userId,
				runId,
				status,
				completed,
				dateUpdated,
				dateCompleted,
				filename,
				fileSize,
				fileType,
				fileUrl,
				vidiaProduct,
			});
			return new Response('Vidia generation saved successfully', { status: 200 });
		} else if (url.pathname === '/api/vidiaGeneration' && request.method === 'GET') {
			const { userId } = Object.fromEntries(url.searchParams);
			const generations = await this.getUserVidiaGeneration(userId);
			return new Response(JSON.stringify(generations), {
				headers: { 'Content-Type': 'application/json' },
			});
		}
		return new Response('Not found', { status: 404 });
	}

	async saveVidiaGeneration(generationObject) {
		const { userId } = generationObject;
		if (!userId) {
			console.error('[VidiaGenerationManager] Cannot save generation without userId');
			return;
		}
		// Store each generation in the user's array so retrieval by userId works
		const userGenerations = (await this.state.storage.get(userId)) || [];
		const generationEntry = {
			...generationObject,
			generationId: crypto.randomUUID(),
			dateCreated: Date.now(),
			expired: false,
		};
		userGenerations.push(generationEntry);
		await this.state.storage.put(userId, userGenerations);
	}

	async getUserVidiaGeneration(userId) {
		return (await this.state.storage.get(userId)) || [];
	}
}
