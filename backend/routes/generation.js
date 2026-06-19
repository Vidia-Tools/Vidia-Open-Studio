/**
 * Generation status routes - FE-facing status and pod heartbeat, plus DO forwarding
 */
import { jsonResponse } from '../utils/response.js';
import { withCallbackSecret } from '../middleware/callback-secret.js';

export function generationRoutes(router) {
	// Generation status - single source of truth for the frontend
	router.get('/api/vidiaGeneration/status', async (request, env) => {
		try {
			const generation_id = new URL(request.url).searchParams.get('generation_id');
			if (!generation_id) {
				return jsonResponse({ success: false, message: 'generation_id parameter is required' }, 400);
			}

			const wsManagerId = env.WEBSOCKET_MANAGER.idFromName('default');
			const wsManager = env.WEBSOCKET_MANAGER.get(wsManagerId);

			const healthResp = await wsManager.fetch(`http://fake/getHealth?generation_id=${encodeURIComponent(generation_id)}`);
			if (!healthResp.ok) {
				return jsonResponse({ success: false, message: 'Job not found' }, healthResp.status);
			}
			const healthData = await healthResp.json();

			return jsonResponse({
				success: true,
				job: healthData.job,
				health: healthData.health,
				lastHeartbeatAt: healthData.lastHeartbeatAt,
				lastStartingAtForPod: healthData.lastStartingAtForPod,
				startupProgressPercent: healthData.startupProgressPercent,
				startupProgressStep: healthData.startupProgressStep
			});
		} catch (error) {
			console.error('Status endpoint error:', error);
			return jsonResponse({ success: false, message: 'Failed to get status' }, 500);
		}
	});

	// Pod startup heartbeat from Docker start.sh
	router.post('/api/vidiaGeneration/podHeartbeat', withCallbackSecret, async (request, env) => {
		console.log('Pod heartbeat endpoint hit');
		try {
			const wsManagerId = env.WEBSOCKET_MANAGER.idFromName('default');
			const wsManager = env.WEBSOCKET_MANAGER.get(wsManagerId);

			const body = await request.json().catch(() => ({}));
			const resp = await wsManager.fetch('http://fake/podHeartbeat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!resp.ok) {
				return jsonResponse({ success: false, message: 'Failed to record pod heartbeat' }, resp.status);
			}
			return jsonResponse({ success: true });
		} catch (error) {
			console.error('PodHeartbeat endpoint error:', error);
			return jsonResponse({ success: false, message: 'Failed to process pod heartbeat' }, 500);
		}
	});

	// Forward remaining vidiaGeneration endpoints to the DO
	router.all('/api/vidiaGeneration/*', async (request, env) => {
		const id = env.VIDIA_GENERATION_MANAGER.idFromName('default');
		const vidiaGenerationManager = env.VIDIA_GENERATION_MANAGER.get(id);
		return vidiaGenerationManager.fetch(request);
	});
}
