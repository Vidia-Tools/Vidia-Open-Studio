import runpodSdk from 'runpod-sdk';

/**
 * Resolve the RunPod endpoint ID for a plan from environment config.
 * @param {string} plan - Plan tier ('basic' | 'standard' | 'pro')
 * @param {Object} env - Worker environment bindings
 * @returns {string} RunPod serverless endpoint ID
 */
const endpointIdForPlan = (plan, env) => {
	switch (plan) {
		case 'standard':
			return env.RUNPOD_STANDARD_ENDPOINT_ID;
		case 'pro':
			return env.RUNPOD_PRO_ENDPOINT_ID;
		case 'basic':
		default:
			return env.RUNPOD_BASIC_ENDPOINT_ID;
	}
};

// Function to pause execution for a specified time
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runEndpointAsync = async (plan, payload, userId, env) => {
	try {
		const runpod = runpodSdk(env.RUNPOD_API_KEY);
		const endpointId = endpointIdForPlan(plan, env);
		const endpoint = runpod.endpoint(endpointId);
		// Wrap payload in input field for RunPod's expected format
		const response = await endpoint.run({ input: payload });
		console.log(response);
		const { id, status } = response;

		// Get the Durable Object instance
		const runManagerId = env.RUNPOD_RUN_MANAGER.idFromName('default');
		const runManager = env.RUNPOD_RUN_MANAGER.get(runManagerId);

		// Register the run - uses generation_id to match RunpodRunManager's expected parameter name
		await runManager.fetch('http://fake/registerRun', {
			method: 'POST',
			body: JSON.stringify({ userId, generation_id: id }),
		});
		
		// Return the response object so the worker can access the id
		return response;
	} catch (e) {
		console.log(e);
		// Return error object so the worker can handle it properly
		return { 
			error: true, 
			message: e.message || 'An error occurred during RunPod request'
		};
	}
};

const runEndpointSync = async (plan, payload, env) => {
	const runpod = runpodSdk(env.RUNPOD_API_KEY);
	const endpointId = endpointIdForPlan(plan, env);
	const endpoint = runpod.endpoint(endpointId);
	return endpoint.run({ input: payload });
};

const runEndpointAsyncWithResults = async (plan, payload, userId, env) => {
	const runpod = runpodSdk(env.RUNPOD_API_KEY);
	const endpointId = endpointIdForPlan(plan, env);
	const endpoint = runpod.endpoint(endpointId);
	const result = await endpoint.run({ input: payload });
	console.log(result);
	console.log('run response');
	console.log(result);

	const { id } = result;
	for (let i = 0; i < 20; i++) {
		// Increase or decrease the loop count as necessary
		const statusResult = await endpoint.status(id);
		console.log('status response');
		console.log(statusResult);

		if (statusResult.status === 'COMPLETED' || statusResult.status === 'FAILED') {
			// Once completed or failed, log the final status and break the loop
			if (statusResult.status === 'COMPLETED') {
				console.log('Operation completed successfully.');
				console.log(statusResult.output);
				return statusResult.output;
			} else {
				console.log('Operation failed.');
				console.log(statusResult);
			}
			break;
		}

		// Wait for a bit before checking the status again
		await sleep(5000);
	}
};

const pollAsyncRunStatus = async (plan, runId, env) => {
	const runpod = runpodSdk(env.RUNPOD_API_KEY);
	const endpointId = endpointIdForPlan(plan, env);
	const endpoint = runpod.endpoint(endpointId);
	const status = await endpoint.status(runId);
	return status;
};

export { runEndpointAsync, runEndpointSync, runEndpointAsyncWithResults, pollAsyncRunStatus };
