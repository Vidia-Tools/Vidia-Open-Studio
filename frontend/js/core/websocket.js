// Import configurations and modules
import { DEBUG_MODE, DEV_MODE, RUNPOD_MODE } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { MESSAGES } from '../config/helper-messages.js';
import * as state from './state.js';
// Import standard notification functions
import { showToastNotification, showErrorNotification, updateNotification, handleFatalError } from '../ui/helpers.js';
import { setProgressBarState, hideHeaderStartupProgress, setStageProgress } from '../ui/progress.js';
import { startAnimation, stopAnimation } from '../ui/animations.js';

const logDebug = createLogger('WebSocket');

// Connection states
const CONNECTION_STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    FAILED: 'failed'
};

function getAnimationElements() {
    return {
        resultContent: document.querySelector('.result-content'),
        resultArea: document.querySelector('.result-area'),
        animationContainer: document.querySelector('.animation-container'),
        waves: document.querySelectorAll('.wave')
    };
}

class WebSocketManager {
    constructor() {
        this.socket = null;
        this.pingInterval = null;
        this.clientId = null;
        this.connectedClientId = null; // Track which generation_id the current socket is connected to
        this.wsUrl = null;
        
        // Flag to track if we've received any progress updates
        this.hasReceivedProgress = false;
        
        // Reconnection settings
        this.connectionState = CONNECTION_STATES.DISCONNECTED;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectTimeout = null;
        this.baseReconnectDelay = 1000; // Start with 1 second delay
        this.maxReconnectDelay = 30000; // Max 30 second delay between attempts
        
        // Heartbeat tracking for job cancellation detection
        this.lastHeartbeatAt = 0;
        this.heartbeatWatchdog = null;
        // 2026-07-06: raised from 10s; 10s fired falsely during long sampling gaps
        this.heartbeatTimeout = 60000;

        // Banner state guards (avoid duplicate updates)
        this.bannerSetActive = false;
        this.bannerSetComplete = false;
        this.bannerSetFailure = false;
    }

    /**
     * Get the generation_id that the current socket is connected to
     * @returns {string|null} The connected generation_id or null if not connected
     */
    getConnectedClientId() {
        return this.connectedClientId;
    }

    connect(clientId) {
        // If we have an existing socket and this is a different clientId, close it first
        if (this.clientId !== clientId && this.socket) {
            logDebug(`Switching from clientId ${this.clientId} to ${clientId}, closing existing socket`);
            this.disconnect();
        }
        
        // Only reset state if this is a new clientId (new generation)
        if (this.clientId !== clientId) {
            this.clientId = clientId;
            this.connectedClientId = null; // Clear connected client ID for new generation
            this.reconnectAttempts = 0;
            this.hasReceivedProgress = false; // Reset progress flag only for new generation
            // Reset banner guards for new generation
            this.bannerSetActive = false;
            this.bannerSetComplete = false;
            this.bannerSetFailure = false;
        } else {
            // Same clientId - this is a reconnection, preserve progress state
            this.reconnectAttempts = 0;
            // Keep hasReceivedProgress and connectedClientId as is - don't reset them
        }
        this.setConnectionState(CONNECTION_STATES.CONNECTING);
        
        // Different WebSocket endpoint when using RunPod
        if (DEV_MODE) {
            this.wsUrl = `ws://localhost:8188/ws?clientId=${clientId}`;
        } else if (RUNPOD_MODE) {
            // Use our Cloudflare WebSocket proxy for RunPod
            // Convert the BACKEND_URL to a WebSocket URL
            const backendUrl = window.APP_CONFIG.BACKEND_URL;
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsBackendUrl = backendUrl.replace(/^https?:/, wsProtocol);
            this.wsUrl = `${wsBackendUrl}/ws?clientId=${clientId}`;
        } else {
            // Default ComfyUI WebSocket URL
            this.wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws?clientId=${clientId}`;
        }
        
        this.attemptConnection();
    }
    
    attemptConnection() {
        try {
            logDebug('Attempting WebSocket connection to: ' + this.wsUrl);
            
            // No need to show connection attempts to users for initial connection
            if (this.reconnectAttempts > 0) {
                showToastNotification(`Reconnecting to server... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'info');
            }
            
            this.socket = new WebSocket(this.wsUrl);
            this.setupListeners();
        } catch (error) {
            logDebug('WebSocket connection error:', error);
            this.handleConnectionFailure();
        }
    }
    
    handleConnectionFailure() {
        // Post-completion or idle: no retries, no banners
        if (state.getWorkflowCompleted() || !state.getIsGenerating()) {
            this.setConnectionState(CONNECTION_STATES.DISCONNECTED);
            return;
        }

        this.reconnectAttempts++;
        
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
            const delay = Math.min(
                this.baseReconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
                this.maxReconnectDelay
            );
            
            this.setConnectionState(CONNECTION_STATES.RECONNECTING);
            try { setProgressBarState('reconnecting'); } catch (_) {}
            
            // Only show notification after multiple failures to avoid spam
            if (this.reconnectAttempts > 1) {
                showToastNotification(
                    `Connection lost. Retrying in ${Math.round(delay/1000)}s (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 
                    'warning'
                );
            }
            
            logDebug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => {
                if (this.connectionState !== CONNECTION_STATES.CONNECTED) {
                    this.attemptConnection();
                }
            }, delay);
        } else {
            this.setConnectionState(CONNECTION_STATES.FAILED);
            
            // Show error notification for connection failure
            showErrorNotification(
                'Unable to connect to server. Progress updates may not work correctly. Please try reloading the page.',
                { autoHideDelay: 0, showSupport: true }
            );
            
            // Set progress bar to failed when reconnection is exhausted
            try { setProgressBarState('failed'); } catch (_) {}
            
            // Clear generating state if still active
            if (state.getIsGenerating()) {
                state.setIsGenerating(false);
            }
            
            logDebug('Max reconnection attempts reached, giving up');
        }
    }

    setupListeners() {
        this.socket.addEventListener('open', this.handleOpen.bind(this));
        this.socket.addEventListener('message', this.handleMessage.bind(this));
        this.socket.addEventListener('error', this.handleError.bind(this));
        this.socket.addEventListener('close', this.handleClose.bind(this));
    }

    handleOpen(event) {
        logDebug(`Connected to server for generation_id: ${this.clientId}`);
        this.setConnectionState(CONNECTION_STATES.CONNECTED);
        // On successful (re)connect, we can mark bar active
        try { setProgressBarState('active'); } catch (_) {}
        
        // Set the connected client ID to track which generation this socket is for
        this.connectedClientId = this.clientId;
        
        // Defer heartbeat watchdog until first liveness event
        
        // Show success notification if this was a reconnection
        if (this.reconnectAttempts > 0) {
            showToastNotification('Server connection restored', 'success', {
                autoHideDelay: 3000
            });
        }
        
        // Reset reconnection attempts on successful connection
        this.reconnectAttempts = 0;
        
        // Start sending pings every 30 seconds
        this.pingInterval = setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'ping' }));
                logDebug('Ping sent');
            }
        }, 30000);
    }

    handleMessage(event) {
        // Handle binary messages (previews)
        if (!(typeof event.data === 'string')) {
            logDebug("Received preview data");
            return;
        }

        // Handle text messages
        const data = JSON.parse(event.data);
        
        if (DEBUG_MODE && data.type !== 'status') {
            logDebug("WebSocket message:", data);
        }

        switch (data.type) {
            case 'ping':
                this.socket.send(JSON.stringify({ type: 'pong' }));
                break;
                
            case 'pong':
                logDebug('Pong received');
                break;
                
            case 'executing':
                this.handleExecuting(data.data);
                break;
            
            case 'progress':
                this.handleProgress(data.data);
                break;

            case 'executed':
                this.handleExecuted(data.data);
                break;

            case 'error':
                this.handleWorkflowError(data.data);
                break;
                
            case 'reconnect':
                this.handleReconnect(data.data);
                break;
                
            case 'heartbeat':
                this.handleHeartbeat(data.data);
                break;
                
            case 'status':
                // Status updates are informational only - don't use for completion logic
                if (data.data && data.data.status) {
                    logDebug('Status update received', data.data.status);
                    // Store videoUrl if available with generation_id, but don't mark as completed
                    if (data.data.videoUrl) {
                        state.setRunDetails({ videoUrl: data.data.videoUrl, generation_id: this.connectedClientId });
                    }
                }
                break;
            case 'videoReady':
                this.handleVideoReady(data.data);
                break;
                
            case 'connected':
                // Our WebSocketManager sends this when a client connects
                logDebug('Connection established with WebSocket server');
                break;
        }
    }

    handleReconnect(reconnectData) {
        logDebug('Handling reconnect state snapshot', reconnectData);
        showToastNotification('Reconnected to generation.', 'success', { autoHideDelay: 3000 });

        // Restore state based on the snapshot
        if (reconnectData.status === 'completed') {
            logDebug('Reconnected to a completed job.');
            // For RUNPOD_MODE, only set runDetails and let generation.js handle display
            if (reconnectData.videoUrl) {
                state.setRunDetails({ videoUrl: reconnectData.videoUrl, generation_id: this.connectedClientId });
            }
            if (!RUNPOD_MODE) {
                state.setWorkflowCompleted(true);
            } else if (reconnectData.videoUrl) {
                // Completed video must render after a reload via lifecycle's existing wait path
                state.setWorkflowCompleted(true);
                state.setIsGenerating(false);
            }
        } else if (reconnectData.status === 'failed') {
            logDebug('Reconnected to a failed job.');
            state.setWorkflowCompleted(true); // Mark workflow as "done" on error
            state.setIsGenerating(false); // Clear generating state
            showErrorNotification(reconnectData.error || 'The job failed while you were disconnected.');
        } else if (reconnectData.status === 'in_progress' || reconnectData.status === 'pending') {
            logDebug('Reconnected to a job in progress.');
            this.hasReceivedProgress = true; // We have the state, so mark as received.
            if (reconnectData.progress) {
                // Restore the exact progress from the snapshot
                setTimeout(() => { // Add a small delay for UI to catch up
                    state.updateNodeProgress(reconnectData.progress.node, reconnectData.progress.value, reconnectData.progress.max);
                }, 200);
            }
        }
    }

    /**
     * Handle videoReady event - the authoritative completion signal from backend
     * @param {Object} data - Video ready data containing generation_id, videoUrl, resolved_seed
     */
    handleVideoReady(data) {
        logDebug('VideoReady event received:', data);

        // Verify this event is for the connected generation (accept either key inbound).
        const gid = data.generation_id || data.generationID;
        if (!gid || gid !== this.connectedClientId) {
            logDebug(`VideoReady generation_id mismatch: received ${gid}, expected ${this.connectedClientId}`);
            return;
        }

        // Set run details (incl. resolved_seed, plan 10.5.5) and mark as completed.
        if (data.videoUrl) {
            state.setRunDetails({ videoUrl: data.videoUrl, generation_id: gid, resolved_seed: data.resolved_seed });
            logDebug(`VideoReady: Set runDetails for ${gid}`, { videoUrl: data.videoUrl, resolved_seed: data.resolved_seed });
        }
        
        // Mark workflow as completed and clear generating state
        state.setWorkflowCompleted(true);
        state.setIsGenerating(false);
        // Ensure startup loader is hidden on completion
        try { hideHeaderStartupProgress(); } catch (_) {}
        
        // Show success notification
        showToastNotification('Your video is ready!', 'success', { autoHideDelay: 3000 });

        // Persistent expiry banner until next generation
        if (RUNPOD_MODE && !this.bannerSetComplete) {
            updateNotification('Video link will expire in 7 days', true, false, 0);
            this.bannerSetComplete = true;
        }
        
        logDebug('VideoReady: Marked workflow as completed and cleared generating state');
    }

    handleExecuting(execData) {
        if (execData.node) {
            try { setProgressBarState('active'); } catch (_) {}
            // Hide startup loader on first liveness (executing)
            try { hideHeaderStartupProgress(); } catch (_) {}
            
            // Treat executing as liveness for the heartbeat watchdog
            this.lastHeartbeatAt = Date.now();
            if (!this.heartbeatWatchdog) {
                this.startHeartbeatWatchdog();
            }
            // On first liveness, set persistent estimate banner
            if (RUNPOD_MODE && !this.bannerSetActive) {
                updateNotification(MESSAGES.NOTIFICATION.GENERATION_TIME, true, false, 0);
                this.bannerSetActive = true;
            }
            
            // Node started executing
            state.setCurrentNodeId(execData.node);
            
            // Update any existing nodes to show new active node
            const activeNodes = state.getActiveNodes();
            activeNodes.forEach((data, nodeId) => {
                state.updateNodeProgress(nodeId, data.value, data.max);
            });
        } else if (execData.node === null && execData.prompt_id === state.getCurrentPromptId()) {
            // For local ComfyUI mode, mark workflow complete when execution finishes
            // For RunPod mode, wait for videoReady event
            if (!RUNPOD_MODE) {
                state.setWorkflowCompleted(true);
                
                // Mark all remaining segments as complete
                const activeNodes = state.getActiveNodes();
                activeNodes.forEach((data, nodeId) => {
                    if (data.value < data.max) {
                        state.updateNodeProgress(nodeId, data.max, data.max);
                    }
                });
            }
            logDebug(`Workflow execution finished (RUNPOD_MODE: ${RUNPOD_MODE})`);
        }
    }

    handleProgress(progressData) {
        // Mark that we've received at least one progress update
        this.hasReceivedProgress = true;
        logDebug('Progress update received, marked hasReceivedProgress = true');
        
        // Treat progress as liveness for the heartbeat watchdog
        this.lastHeartbeatAt = Date.now();
        if (!this.heartbeatWatchdog) {
            this.startHeartbeatWatchdog();
        }
        // On first liveness, set persistent estimate banner
        if (RUNPOD_MODE && !this.bannerSetActive && !state.getWorkflowCompleted()) {
            updateNotification(MESSAGES.NOTIFICATION.GENERATION_TIME, true, false, 0);
            this.bannerSetActive = true;
        }
        // Hide startup loader once we have liveness/progress
        try { hideHeaderStartupProgress(); } catch (_) {}
        // Resume full animation after reconnect
        if (!state.getWorkflowCompleted()) {
            try { startAnimation('full', getAnimationElements()); } catch (_) {}
        }
        
        try { setProgressBarState('active'); } catch (_) {}
        // Per-stage progress (plan 7): the worker StageRelay rides stage fields on
        // relayed progress events. Show the stage name + N/total instead of one bar.
        if (progressData.stageName || progressData.stageTotal) {
            try {
                setStageProgress({
                    stageName: progressData.stageName,
                    stageIndex: progressData.stageIndex,
                    stageTotal: progressData.stageTotal,
                });
            } catch (_) {}
        }
        state.updateNodeProgress(progressData.node, progressData.value, progressData.max);
    }

    handleExecuted(execData) {
        logDebug('Workflow execution completed', execData);
        
        // For local ComfyUI mode, mark workflow complete when executed
        // For RunPod mode, this just means ComfyUI finished - wait for videoReady event
        if (!RUNPOD_MODE) {
            state.setWorkflowCompleted(true);
            
            // Mark all remaining segments as complete
            const activeNodes = state.getActiveNodes();
            activeNodes.forEach((data, nodeId) => {
                if (data.value < data.max) {
                    state.updateNodeProgress(nodeId, data.max, data.max);
                }
            });
        }
        
        // Always store videoUrl if available with generation_id (for both modes)
        if (execData && execData.videoUrl) {
            state.setRunDetails({ videoUrl: execData.videoUrl, generation_id: this.connectedClientId });
        }
        
        logDebug(`handleExecuted completed (RUNPOD_MODE: ${RUNPOD_MODE})`);
    }

    handleWorkflowError(errorData) {
        // Guard: ignore errors arriving after video was already delivered successfully.
        // When the RunPod worker shuts down post-completion, the backend may send a
        // "terminated" error even though the generation succeeded. Silently drop it.
        if (state.getWorkflowCompleted()) {
            console.log('[WebSocket] Ignoring post-completion error:', errorData);
            return;
        }

        console.error('Workflow error received:', errorData);
        
        // Use centralized fatal error handler for consistent UI cleanup and messaging
        try { setProgressBarState('failed'); } catch (_) {}
        // Ensure startup loader is hidden on failure
        try { hideHeaderStartupProgress(); } catch (_) {}
        handleFatalError({
            ...errorData,
            source: 'websocket',
            generation_id: this.connectedClientId
        });

        // Persistent failure banner until next generation
        if (RUNPOD_MODE && !this.bannerSetFailure) {
            updateNotification('Connection to worker lost. Generation canceled or failed.', true, true, 0);
            this.bannerSetFailure = true;
        }
        // Stop waves on failure
        try { stopAnimation(getAnimationElements()); } catch (_) {}
        
        logDebug('Workflow error handled via centralized fatal error handler');
    }

    handleError(error) {
        console.error('WebSocket error:', error);
        // Don't show error notification here, as the close handler will be called after an error
        // and will handle the reconnection and notification logic
    }

    handleClose(event) {
        logDebug('WebSocket connection closed:', {
            wasClean: event.wasClean,
            code: event.code,
            reason: event.reason
        });
        
        // Clear ping interval
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        // Clear heartbeat watchdog
        this.stopHeartbeatWatchdog();
        
        // Only attempt reconnection if we're not deliberately disconnecting
        // and we're not already in the FAILED state
        if (this.connectionState !== CONNECTION_STATES.DISCONNECTED && 
            this.connectionState !== CONNECTION_STATES.FAILED) {
            
            // If the connection was closed cleanly with code 1000, don't reconnect
            if (event.wasClean && event.code === 1000) {
                this.setConnectionState(CONNECTION_STATES.DISCONNECTED);
            } else {
                // Post-completion pod shutdown: keep the displayed result, no reconnect UI
                if (state.getWorkflowCompleted() || !state.getIsGenerating()) {
                    this.setConnectionState(CONNECTION_STATES.DISCONNECTED);
                    return;
                }
                // Handle unexpected disconnection
                this.setConnectionState(CONNECTION_STATES.RECONNECTING);
                try { setProgressBarState('reconnecting'); } catch (_) {}
                try { startAnimation('connecting', getAnimationElements()); } catch (_) {}
                
                // Show a warning for unexpected disconnections, but only if we were previously connected
                if (this.connectionState === CONNECTION_STATES.CONNECTED) {
                    showToastNotification('Server connection lost. Attempting to reconnect...', 'warning');
                }
                
                this.handleConnectionFailure();
            }
        }
    }

    disconnect() {
        // Only attempt disconnection if we have a socket
        if (this.socket) {
            this.setConnectionState(CONNECTION_STATES.DISCONNECTED);
            this.socket.close();
            this.socket = null;
        }
        
        // Clear ping interval
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        // Clear heartbeat watchdog
        this.stopHeartbeatWatchdog();
        
        // Clear any pending reconnection
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        logDebug('WebSocket disconnected');
    }

    handleHeartbeat(heartbeatData) {
        // Update last heartbeat timestamp
        this.lastHeartbeatAt = Date.now();

        // Start watchdog on first liveness
        if (!this.heartbeatWatchdog) {
            this.startHeartbeatWatchdog();
        }

        // On first liveness, set persistent estimate banner
        if (RUNPOD_MODE && !this.bannerSetActive && !state.getWorkflowCompleted()) {
            updateNotification(MESSAGES.NOTIFICATION.GENERATION_TIME, true, false, 0);
            this.bannerSetActive = true;
        }

        // Hide startup loader on heartbeat liveness
        try { hideHeaderStartupProgress(); } catch (_) {}
        // Resume full animation after reconnect
        if (!state.getWorkflowCompleted()) {
            try { startAnimation('full', getAnimationElements()); } catch (_) {}
        }
        
        logDebug('Heartbeat received, timestamp updated');
    }

    startHeartbeatWatchdog() {
        // Clear any existing watchdog
        this.stopHeartbeatWatchdog();
        
        // Start watchdog timer - check every 2 seconds
        this.heartbeatWatchdog = setInterval(() => {
            // Only check if we're actively generating
            if (state.getIsGenerating()) {
                const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatAt;
                
                if (timeSinceLastHeartbeat > this.heartbeatTimeout) {
                    logDebug(`Heartbeat timeout detected: ${timeSinceLastHeartbeat}ms since last heartbeat`);
                    
                    // Set progress bar to failed
                    try { setProgressBarState('failed'); } catch (_) {}
                    
                    // Clear generating state
                    state.setIsGenerating(false);
                    
                    // Use same persistent banner as handleWorkflowError (:478)
                    updateNotification('Connection to worker lost. Generation canceled or failed.', true, true, 0);
                    // Stop waves on watchdog failure
                    try { stopAnimation(getAnimationElements()); } catch (_) {}
                    
                    // Stop the watchdog
                    this.stopHeartbeatWatchdog();
                }
            }
        }, 2000); // Check every 2 seconds
        
        logDebug('Heartbeat watchdog started');
    }

    stopHeartbeatWatchdog() {
        if (this.heartbeatWatchdog) {
            clearInterval(this.heartbeatWatchdog);
            this.heartbeatWatchdog = null;
            logDebug('Heartbeat watchdog stopped');
        }
    }
    
    // Connection state management
    setConnectionState(state) {
        if (this.connectionState !== state) {
            logDebug(`Connection state changed: ${this.connectionState} -> ${state}`);
            this.connectionState = state;
            
            // Notify state for UI updates if needed
            // You can implement custom logic here to update UI elements
            document.body.setAttribute('data-ws-state', state);
        }
    }
}

// Create and export singleton instance
export const wsManager = new WebSocketManager();


