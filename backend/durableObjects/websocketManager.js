/**
 * WebSocket Manager Durable Object
 * 
 * This Durable Object manages WebSocket connections between clients and the server,
 * providing real-time progress updates for RunPod jobs.
 */

export class WebSocketManager {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.sessions = new Map(); // Maps generation_id to set of websocket connections
		this.jobs = new Map(); // Maps generation_id to job information
		// Per-pod startup timestamps (loaded lazily when needed)
		this.podStarting = new Map(); // Map<podId, lastStartingAt>
		// Global last startup heartbeat time (used to drive "starting" without pod identity)
		this.lastStartupAt = 0;
		// Startup progress meta (percent and step) from last startup heartbeat
		this.lastStartupPercent = 0;
		this.lastStartupStep = null;
	}

    async fetch(request) {
        const url = new URL(request.url);

        // WebSocket connection endpoint
        if (url.pathname === '/ws' || url.pathname === '/api/ws') {
            // Handle client WebSocket connections with generation_id
            const generation_id = url.searchParams.get('clientId'); // Keep parameter name for compatibility
            if (!generation_id) {
                return new Response('Missing generation_id parameter', { status: 400 });
            }

            // Upgrade HTTP request to a WebSocket connection
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            await this.handleSession(server, generation_id);
            return new Response(null, {
                status: 101,
                webSocket: client
            });
        }

        // Endpoint for RunPod to post progress updates
        if (url.pathname === '/progress' && request.method === 'POST') {
            const data = await request.json();
            const { generation_id, eventType, progressData } = data;
            
            // Find job info for this generation_id
            const jobInfo = this.jobs.get(generation_id);
            if (!jobInfo) {
                return new Response('Unknown generation_id', { status: 404 });
            }

            // Handle lightweight generation heartbeats and broadcast to clients
            if (eventType === 'heartbeat') {
                jobInfo.lastHeartbeatAt = Date.now();
                jobInfo.lastUpdate = Date.now();
                
                // Set podId from progressData if provided and not already set (kept harmless; not used for health)
                if (progressData?.podId && !jobInfo.podId) {
                    jobInfo.podId = progressData.podId;
                    console.log(`Set podId for generation ${generation_id}: ${progressData.podId}`);
                }
                
                this.jobs.set(generation_id, jobInfo);
                
                // Broadcast heartbeat to connected clients so frontend watchdog works
                this.broadcastToClient(generation_id, {
                    type: 'heartbeat',
                    data: progressData
                });

                // Light prune on heartbeat path
                this.prune();
                
                return new Response('Heartbeat update received');
            }

            // Map RunPod event types to ComfyUI-compatible event types
            let eventMapping = {
                'executing': 'executing',
                'progress': 'progress',
                'completed': 'executed',
                'error': 'error' // Route all errors to a single handler
            };

            // Use the mapped event type or the original if not found
            const mappedType = eventMapping[eventType] || eventType;

            // Forward progress to connected generation websocket(s)
            // For videoReady events, include the generation_id in the data
            if (eventType === 'videoReady') {
                this.broadcastToClient(generation_id, {
                    type: mappedType,
                    data: {
                        ...progressData,
                        generation_id: generation_id  // Include generation_id for frontend verification
                    }
                });
            } else {
                this.broadcastToClient(generation_id, {
                    type: mappedType,
                    data: progressData
                });
            }

            // Update job status in our internal state
            jobInfo.lastUpdate = Date.now();
            jobInfo.status = (eventType === 'completed' || eventType === 'executed' || eventType === 'videoReady') ? 'completed' : 'in_progress';
            jobInfo.progress = progressData;
            if ((eventType === 'executed' || eventType === 'videoReady') && progressData && progressData.videoUrl) {
                jobInfo.videoUrl = progressData.videoUrl;
            }
            this.jobs.set(generation_id, jobInfo);

            if (eventType === 'videoReady') {
                console.log(`Job ${generation_id} marked completed via videoReady; heartbeat monitoring will now ignore this job`);
            }

            // Also update in the RunPod Run Manager
            try {
                const runManagerId = this.env.RUNPOD_RUN_MANAGER.idFromName('default');
                const runManager = this.env.RUNPOD_RUN_MANAGER.get(runManagerId);
                
                // Update status in the Run Manager - include userId from stored job info
                const isCompleted = eventType === 'completed' || eventType === 'videoReady';
                await runManager.fetch('http://fake/updateRunStatus', {
                    method: 'POST',
                    body: JSON.stringify({
                        generation_id: generation_id,
                        userId: jobInfo.userId, // Include userId from stored job info
                        status: isCompleted ? 'completed' : 'in_progress',
                        progress: progressData
                    })
                });
                
            } catch (error) {
                console.error('Error updating RunPod Run Manager:', error);
            }

            return new Response('Progress update received');
        }

        // Register a new job
        if (url.pathname === '/registerJob' && request.method === 'POST') {
            // Get job data, preferring generation_id over clientId if available
            const data = await request.json();
            const generation_id = data.generation_id || data.clientId;
            const userId = data.userId;
            
            if (!generation_id) {
                return new Response('Missing generation_id parameter', { status: 400 });
            }

            // Store job information
            this.jobs.set(generation_id, {
                generation_id,
                userId,
                status: 'pending',
                startTime: Date.now(),
                lastUpdate: Date.now(),
                lastHeartbeatAt: null,
                progress: null
            });

            // Store the mapping between generation_id and userId in durable storage
            if (userId) {
                await this.state.storage.put(`generation:${generation_id}:userId`, userId);
                
                // Also add to user's list of generations
                let userGenerations = await this.state.storage.get(`user:${userId}:generations`) || [];
                if (!Array.isArray(userGenerations)) {
                    userGenerations = [];
                }
                userGenerations.push(generation_id);
                await this.state.storage.put(`user:${userId}:generations`, userGenerations);
                
                console.log(`Stored generation mapping: ${generation_id} -> ${userId}`);
            }

            console.log(`Registered job for generation_id: ${generation_id}`);

            // If client is connected, send initial status
            this.broadcastToClient(generation_id, {
                type: 'status',
                data: {
                    status: {
                        exec_info: {
                            queue_remaining: 1
                        }
                    }
                }
            });

            return new Response('Job registered');
        }

        // Get status of a job
        if (url.pathname === '/jobStatus' && request.method === 'GET') {
            const generation_id = url.searchParams.get('generation_id');
            if (!generation_id) {
                return new Response('Missing generation_id', { status: 400 });
            }

            const jobInfo = this.jobs.get(generation_id);
            if (!jobInfo) {
                return new Response('Unknown generation_id', { status: 404 });
            }

            return new Response(JSON.stringify(jobInfo), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Store pod-level starting heartbeat (from Docker start.sh)
        if (url.pathname === '/podHeartbeat' && request.method === 'POST') {
            try {
                const body = await request.json();
                const { status, timestamp, podId, percent, step } = body || {};
                
                if (status === 'starting') {
                    const ts = typeof timestamp === 'number' ? timestamp : Date.now();
                    
                    // Store per-pod starting timestamp (for diagnostics/pruning)
                    if (podId) {
                        this.podStarting.set(podId, ts);
                        await this.state.storage.put(`pod:${podId}:lastStartingAt`, ts);
                    }
                    
                    // Update global last startup heartbeat seen (authoritative for "starting")
                    this.lastStartupAt = ts;
                    if (typeof percent === 'number') this.lastStartupPercent = Math.max(0, Math.min(95, percent));
                    if (typeof step === 'string') this.lastStartupStep = step;
                    
                    console.log(`Startup heartbeat received at ${new Date(ts).toISOString()}${podId ? ` (pod ${podId})` : ''}${typeof percent === 'number' ? ` [${this.lastStartupPercent}% - ${this.lastStartupStep || 'step'}]` : ''}`);
                }
                
                // Light prune on every call
                this.prune();
                
                return new Response(JSON.stringify({ success: true }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ success: false, message: 'Invalid heartbeat payload' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // Return health-related timestamps with job snapshot for a generation
        if (url.pathname === '/getHealth' && request.method === 'GET') {
            const generation_id = url.searchParams.get('generation_id');
            if (!generation_id) {
                return new Response(JSON.stringify({ 
                    success: false, 
                    message: 'Missing generation_id' 
                }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }

            const jobInfo = this.jobs.get(generation_id) || null;
            
            // Compute health for this specific generation using only heartbeats and timing
            const now = Date.now();
            const HEARTBEAT_STALE_MS = 8000;   // generation heartbeat considered fresh within 8s
            const STARTING_WINDOW_MS = 45000;  // startup heartbeat considered recent within 45s
            const STARTUP_SILENCE_FAIL_MS = 15000;     // fail if startup heartbeats stop for 15s before generation starts
            const GENERATION_SILENCE_FAIL_MS = 20000;  // fail if generation heartbeat stalls for 20s after it started
            
            let health = 'unhealthy';
            const lastStartupAt = this.lastStartupAt || null;

            if (jobInfo) {
                const heartbeatFresh = !!jobInfo.lastHeartbeatAt && (now - jobInfo.lastHeartbeatAt) <= HEARTBEAT_STALE_MS;
                const jobCompleted = jobInfo.status === 'completed';
                const hasProgress = !!jobInfo.progress;

                // Treat startup as recent only if it occurred after this job began, and is within window
                const startupRecentForThisJob = !!lastStartupAt &&
                    lastStartupAt >= (jobInfo.startTime || 0) &&
                    (now - lastStartupAt) <= STARTING_WINDOW_MS;

                // Primary health classification
                if (jobCompleted || heartbeatFresh || hasProgress) {
                    health = 'ok';
                } else if (startupRecentForThisJob && !hasProgress) {
                    health = 'starting';
                } else {
                    health = 'unhealthy';
                }

                // Termination side-effects (mark failed and notify) when silence windows are exceeded
                if (!jobCompleted && jobInfo.status !== 'failed') {
                    // Generation-phase death: had heartbeat before, now stalled
                    if (jobInfo.lastHeartbeatAt && (now - jobInfo.lastHeartbeatAt) >= GENERATION_SILENCE_FAIL_MS) {
                        await this.jobFailAndBroadcast(generation_id, 'generation heartbeat lost');
                    }
                    // Startup-phase death: saw startup for this job, never saw generation heartbeat/progress, and startup went silent
                    else if (!hasProgress && !jobInfo.lastHeartbeatAt && !!lastStartupAt &&
                             lastStartupAt >= (jobInfo.startTime || 0) && (now - lastStartupAt) >= STARTUP_SILENCE_FAIL_MS) {
                        await this.jobFailAndBroadcast(generation_id, 'startup heartbeat stopped before generation');
                    }
                }
            }

            // Light prune on every call
            this.prune();

            return new Response(JSON.stringify({
                success: true,
                job: jobInfo,
                health: health,
                lastHeartbeatAt: jobInfo?.lastHeartbeatAt || null,
                // Keep response key name for compatibility; provide global startup heartbeat time
                lastStartingAtForPod: lastStartupAt,
                // New: report startup progress meta when starting applies
                startupProgressPercent: health === 'starting' ? (this.lastStartupPercent || 0) : 0,
                startupProgressStep: health === 'starting' ? (this.lastStartupStep || null) : null
            }), { headers: { 'Content-Type': 'application/json' } });
        }
        
        // Endpoint to get userId from generationId
        if (url.pathname === '/getUserIDForGeneration') {
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
            
            // Try to get from durable storage first
            let userID = await this.state.storage.get(`generation:${generation_id}:userId`);
            
            // If not found in storage, try in-memory jobs map
            if (!userID) {
                const jobInfo = this.jobs.get(generation_id);
                if (jobInfo && jobInfo.userId) {
                    userID = jobInfo.userId;
                }
            }
            
            if (!userID) {
                return new Response(JSON.stringify({ 
                    success: false, 
                    message: 'GenerationID not found' 
                }), { 
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            return new Response(JSON.stringify({ 
                success: true, 
                userID 
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Get job information by generation_id
        if (url.pathname === '/getJob' && request.method === 'GET') {
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
            
            // Try to get from in-memory jobs map first
            const jobInfo = this.jobs.get(generation_id);
            if (jobInfo) {
                return new Response(JSON.stringify({ 
                    success: true, 
                    job: jobInfo 
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            // If not found in memory, try to reconstruct from storage
            const userId = await this.state.storage.get(`generation:${generation_id}:userId`);
            if (userId) {
                return new Response(JSON.stringify({ 
                    success: true, 
                    job: {
                        generation_id,
                        userId,
                        status: 'unknown',
                        startTime: null,
                        lastUpdate: null,
                        progress: null
                    }
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            return new Response(JSON.stringify({ 
                success: false, 
                message: 'Job not found' 
            }), { 
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Endpoint removed - no backward compatibility needed

        return new Response('Not found', { status: 404 });
    }

    // Handle a WebSocket session
    async handleSession(webSocket, generation_id) {
        webSocket.accept();

        // Store the WebSocket
        if (!this.sessions.has(generation_id)) {
            this.sessions.set(generation_id, new Set());
        }
        this.sessions.get(generation_id).add(webSocket);

        // Check if there's an existing job for this generation_id
        const jobInfo = this.jobs.get(generation_id);
        if (jobInfo) {
            // This is a reconnection, send the full current state
            console.log(`WebSocket reconnection detected for generation_id: ${generation_id}, status: ${jobInfo.status}`);
            
            const stateSnapshot = {
                type: 'reconnect',
                data: {
                    generation_id: generation_id,
                    status: jobInfo.status,
                    progress: jobInfo.progress, // The last known progress
                    videoUrl: jobInfo.status === 'completed' ? jobInfo.videoUrl : null, // Send URL if completed
                    error: jobInfo.status === 'failed' ? jobInfo.error : null, // Send error if failed
                    timestamp: Date.now()
                }
            };
            
            webSocket.send(JSON.stringify(stateSnapshot));
            console.log('Sent full state snapshot on reconnection:', stateSnapshot);
        }

        // Handle messages and connection close
        webSocket.addEventListener('message', async (msg) => {
            try {
                // Handle any client messages (e.g., pings)
                const data = JSON.parse(msg.data);
                if (data.type === 'ping') {
                    webSocket.send(JSON.stringify({ type: 'pong' }));
                }
            } catch (error) {
                console.error('Error handling WebSocket message', error);
            }
        });

        webSocket.addEventListener('close', () => {
            // Remove the WebSocket from sessions
            const sessions = this.sessions.get(generation_id);
            if (sessions) {
                sessions.delete(webSocket);
                if (sessions.size === 0) {
                    this.sessions.delete(generation_id);
                }
            }
        });

        // Start heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
            try {
                webSocket.send(JSON.stringify({ type: 'ping' }));
            } catch (error) {
                clearInterval(heartbeat);
            }
        }, 30000);

        // Send initial connection confirmation
        webSocket.send(JSON.stringify({
            type: 'connected',
            data: { generation_id }
        }));
    }

    // Broadcast a message to all sessions for a generation
    broadcastToClient(generation_id, message) {
        const sessions = this.sessions.get(generation_id);
        if (!sessions) return;

        const messageString = JSON.stringify(message);
        sessions.forEach((ws) => {
            try {
                ws.send(messageString);
            } catch (error) {
                console.error('Error sending WebSocket message', error);
            }
        });
    }

    /**
     * Mark a job as failed and notify listeners immediately.
     * This is used when heartbeat silence indicates worker termination.
     */
    async jobFailAndBroadcast(generation_id, reason) {
        const jobInfo = this.jobs.get(generation_id);
        if (!jobInfo || jobInfo.status === 'failed') return;

        jobInfo.status = 'failed';
        jobInfo.error = reason || 'job failed';
        jobInfo.lastUpdate = Date.now();
        this.jobs.set(generation_id, jobInfo);

        // Notify clients
        this.broadcastToClient(generation_id, {
            type: 'error',
            data: { code: 'terminated', message: reason, terminated: true }
        });

        // Update status in the Run Manager (best-effort)
        try {
            const runManagerId = this.env.RUNPOD_RUN_MANAGER.idFromName('default');
            const runManager = this.env.RUNPOD_RUN_MANAGER.get(runManagerId);
            await runManager.fetch('http://fake/updateRunStatus', {
                method: 'POST',
                body: JSON.stringify({
                    generation_id,
                    userId: jobInfo.userId || null,
                    status: 'failed',
                    progress: null
                })
            });
        } catch (error) {
            console.error('Error updating RunPod Run Manager (failed):', error);
        }
    }

    /**
     * Prune stale in-memory data to avoid unbounded growth.
     * - Remove per-pod startup entries older than 5 minutes.
     * - Remove completed/failed jobs with no sessions older than 30 minutes.
     */
    prune() {
        const now = Date.now();
        const STARTUP_RETAIN_MS = 5 * 60 * 1000; // 5 minutes
        const JOB_RETAIN_MS = 30 * 60 * 1000;    // 30 minutes

        // Prune per-pod startup entries
        try {
            for (const [pid, ts] of this.podStarting) {
                if (typeof ts === 'number' && (now - ts) > STARTUP_RETAIN_MS) {
                    this.podStarting.delete(pid);
                }
            }
        } catch (e) {
            // ignore prune errors
        }

        // Prune completed/failed jobs with no sessions after retention
        try {
            for (const [genId, job] of this.jobs) {
                if (!job) continue;
                const status = job.status;
                const last = job.lastUpdate || 0;
                const hasSessions = this.sessions.has(genId) && this.sessions.get(genId)?.size > 0;
                if ((status === 'completed' || status === 'failed') && !hasSessions && (now - last) > JOB_RETAIN_MS) {
                    this.jobs.delete(genId);
                }
            }
        } catch (e) {
            // ignore prune errors
        }
    }
}
