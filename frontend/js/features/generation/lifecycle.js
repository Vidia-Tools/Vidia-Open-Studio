// =============================================================================
// Generation: lifecycle.js (ST5)
// Slim, node-free run lifecycle: build the section-3 params payload, upload
// pending files into params.files.*, POST {generation_id, user_id, params} to
// /generate, monitor progress over WebSocket, display the result (with the
// resolved seed), and surface the failing stage from the error envelope.
// No graph prep, no node injection, no NODE map.
// =============================================================================

import {
    API_BASE,
    EXECUTED_FALLBACK_ENABLED,
    FALLBACK_T1_MS,
    STALL_T2_MS,
    RESTART_WORKER_ENABLED,
    RUNPOD_MODE,
} from '../../config/constants.js';
import { buildParams } from '../../core/workflow.js';
import * as store from '../../core/generation-store.js';
import * as state from '../../core/state.js';
import { sendGAEvent, GA_EVENT_CATEGORIES } from '../../analytics.js';
import { wsManager } from '../../core/websocket.js';
import { startAnimation, stopAnimation } from '../../ui/animations.js';
import { updateNotification, showToastNotification, handleFatalError } from '../../ui/helpers.js';
import { displayResult, clearResult, displayLocalOutputPath } from '../../ui/result-display.js';
import {
    setProgressBarState,
    setHeaderStartupProgress,
    hideHeaderStartupProgress,
} from '../../ui/progress.js';
import { updateCredits } from '../pricing.js';
import { MESSAGES } from '../../config/helper-messages.js';
import { createLogger } from '../../utils/logger.js';
import { getAllPendingFiles } from '../../ui/localFileStorage.js';
import { openGenericModal, closeGenericModal } from '../../ui/genericModal.js';
import { uploadPendingFiles } from './workflow-prep.js';
import { setButtonsDisabled } from './ui-updates.js';

const logDebug = createLogger('Generation:Lifecycle');

// Resolve the /generate endpoint: VITE_API_BASE (hosted backend) or the local
// app_server. Falls back to window.APP_CONFIG.BACKEND_URL for hosted markup.
function generateUrl() {
    const base = API_BASE || window.APP_CONFIG?.BACKEND_URL || '';
    return `${base}/generate`;
}

function animationElements() {
    return {
        resultContent: document.querySelector('.result-content'),
        resultArea: document.querySelector('.result-area'),
        animationContainer: document.querySelector('.animation-container'),
        waves: document.querySelectorAll('.wave'),
    };
}

/**
 * Local mode generation path. The local app_server POST /generate blocks until
 * the pipeline finishes and returns the output path, so there is no hosted
 * auth, WebSocket, R2 upload, health poll, or watchdog. The local output_file
 * is a filesystem path (not a browser-served URL); if it is not an http(s) URL
 * it is surfaced as text via displayLocalOutputPath instead of a <video>.
 * @param {string} type - 'preview' or 'full'
 * @param {Object} options
 * @param {number} options.cost - Credit cost (unused in local mode)
 * @param {string} options.generation_id - Pre-minted generation id
 */
async function runLocalGeneration(type, { cost = 0, generation_id } = {}) {
    // Local mode has no hosted R2 upload path; pending file inputs are not
    // wired here. Rely on params.files.* already set where available.
    const payload = buildParams(generation_id);

    sendGAEvent('generation_api_request_sent', {
        event_category: GA_EVENT_CATEGORIES.GENERATION_FUNNEL,
        event_label: `API Request - ${type}`,
        generation_type: type,
        generation_id,
    });

    state.setCurrentHelperText('Generating locally...');

    const response = await fetch(generateUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, type }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== 'success' || result.error) {
        const envelope = result.error
            ? result
            : { error: result.message || `Generate failed (${response.status})` };
        throw Object.assign(new Error(envelope.error), {
            stage: envelope.stage || result.stage,
            generation_id,
        });
    }

    const outputFile = result.output_file || null;
    const resolvedSeed = (result.resolved_seed !== undefined && result.resolved_seed !== null)
        ? result.resolved_seed
        : null;

    state.setRunDetails({
        generation_id: result.generation_id || generation_id,
        videoUrl: outputFile,
        resolved_seed: resolvedSeed,
    });
    state.setWorkflowCompleted(true);

    if (outputFile && /^https?:\/\//i.test(outputFile)) {
        displayResult(outputFile, resolvedSeed);
    } else {
        displayLocalOutputPath(outputFile, resolvedSeed);
    }

    sendGAEvent('generation_successful', {
        event_category: GA_EVENT_CATEGORIES.GENERATION_FUNNEL,
        event_label: `Generation Success - ${type}`,
        generation_type: type,
        generation_id,
        video_url: outputFile,
    });
}

/**
 * Main generation handler. Builds the params payload, uploads pending files,
 * submits to the handler, then waits for completion via WebSocket.
 * @param {string} type - 'preview' or 'full'
 * @param {Object} options
 * @param {number} options.cost - Credit cost for this generation
 */
export async function handleGeneration(type, { cost = 0 } = {}) {
    if (state.getIsGenerating()) return;

    // Mint the canonical generation_id once (plan 10.1); it travels through
    // submit -> WS subscription -> result unchanged.
    const { generation_id } = buildParams();
    logDebug(`Minted generation_id: ${generation_id}`);

    // Auth gate (hosted only; local mode has no backend auth).
    const { isLoggedIn, getSession } = await import('../../session.js');
    if (RUNPOD_MODE && !isLoggedIn()) {
        showToastNotification('Please sign in to generate.', 'warning');
        return;
    }

    // Credit gate (hosted only; local mode has no credit system).
    if (RUNPOD_MODE && cost > state.getCurrentCredits()) {
        throw new Error(MESSAGES.NOTIFICATION.ERROR.INSUFFICIENT_CREDITS);
    }

    sendGAEvent('generation_attempted', {
        event_category: GA_EVENT_CATEGORIES.GENERATION_FUNNEL,
        event_label: `Generation Attempt - ${type}`,
        generation_type: type,
        generation_id,
    });

    // Begin run.
    state.setIsGenerating(true);
    state.resetProgress();
    state.clearRunDetails();
    state.setWorkflowCompleted(false);
    clearResult();
    setButtonsDisabled(true);
    try { setProgressBarState('starting'); } catch (_) {}
    updateNotification(MESSAGES.NOTIFICATION.GENERATION_TIME, true, false, 0);
    openGenericModal('This could take a while...', 'We will send you an email when your content is ready!', { isHtml: false });
    startAnimation(type, animationElements());

    try {
        // Local mode: complete directly from the blocking POST /generate
        // response. Skips hosted upload, WebSocket, health poll, and watchdogs.
        if (!RUNPOD_MODE) {
            await runLocalGeneration(type, { cost, generation_id });
            return;
        }

        // Upload pending files; workflow-prep records params.files.* by slot.
        const pendingFiles = await getAllPendingFiles();
        if (pendingFiles.length > 0) {
            state.setCurrentHelperText(`Uploading ${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''}...`);
            await uploadPendingFiles(pendingFiles, generation_id, (progress, fileType) => {
                state.setCurrentHelperText(`Uploading ${fileType}: ${Math.round(progress)}%`);
            });
        }

        // Build the final payload AFTER uploads so params.files.* is populated.
        const payload = buildParams(generation_id);
        const sessionData = getSession();
        const headers = { 'Content-Type': 'application/json' };
        if (sessionData?.token) headers['Authorization'] = `Bearer ${sessionData.token}`;

        // Subscribe to progress before submit so no events are missed.
        wsManager.connect(generation_id);
        state.setCurrentHelperText('Connecting to server...');

        sendGAEvent('generation_api_request_sent', {
            event_category: GA_EVENT_CATEGORIES.GENERATION_FUNNEL,
            event_label: `API Request - ${type}`,
            generation_type: type,
            generation_id,
        });

        const response = await fetch(generateUrl(), {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...payload, type }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false || result.error) {
            const envelope = result.error ? result : { error: result.message || `Submit failed (${response.status})` };
            throw Object.assign(new Error(envelope.error), { stage: envelope.stage, generation_id });
        }

        // Watchdog (a): backend health poll loop. GET /api/vidiaGeneration/status every
        // 2s x 60 via API_BASE. Transitions the bar from 'starting' -> 'active' and
        // surfaces a confirmed backend 'failed' job immediately. Fire-and-forget; it
        // self-terminates on active/failed or after 60 polls (~2min). The hosted
        // backend reads the canonical snake_case generation_id query param.
        (async () => {
            const POLL_MS = 2000;
            const MAX_POLLS = 60;
            for (let i = 0; i < MAX_POLLS; i++) {
                try {
                    const resp = await fetch(`${API_BASE}/api/vidiaGeneration/status?generation_id=${encodeURIComponent(generation_id)}`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        const health = data?.health || 'unhealthy';
                        const jobStatus = data?.job?.status || null;
                        if (jobStatus === 'failed') {
                            try { setProgressBarState('failed'); } catch (_) {}
                            updateNotification('Connection to worker lost. Generation canceled or failed.', true, true, 0);
                            try { hideHeaderStartupProgress(); } catch (_) {}
                            state.setIsGenerating(false);
                            setButtonsDisabled(false);
                            showToastNotification('Worker became unavailable. Please retry.', 'error');
                            return;
                        }
                        if (health === 'starting') {
                            try { setProgressBarState('starting'); } catch (_) {}
                            updateNotification('Worker starting...', true, false, 0);
                            const p = typeof data?.startupProgressPercent === 'number' ? data.startupProgressPercent : 5;
                            try { setHeaderStartupProgress(p); } catch (_) {}
                        } else if (health === 'ok') {
                            if (wsManager.connectionState === 'reconnecting') {
                                try { setProgressBarState('reconnecting'); } catch (_) {}
                            } else {
                                try { setProgressBarState('active'); } catch (_) {}
                                try { hideHeaderStartupProgress(); } catch (_) {}
                                break;
                            }
                        } else {
                            logDebug('Health poll: unhealthy (waiting for backend to resolve)', { i, health });
                        }
                    } else {
                        logDebug('Health poll request failed', { status: resp.status });
                    }
                } catch (e) {
                    logDebug('Health poll error', { error: e?.message });
                }
                await new Promise(r => setTimeout(r, POLL_MS));
            }
        })();

        // Wait for the authoritative completion signal (videoReady) for this id.
        // The 120min MAX_WAIT_MS loop is kept as the outer completion wait. Inside it
        // run watchdog (b) executed-with-URL HEAD fallback and watchdog (c) stall +
        // restartWorker, both gated by constants.js flags.
        const MAX_WAIT_MS = 120 * 60 * 1000;
        let waited = 0;
        let executedSeenAt = null;
        let restartAttempted = false;
        let fallbackReadyUrl = null;
        while (waited < MAX_WAIT_MS) {
            const run = state.getRunDetails();
            const isCompleted = state.getWorkflowCompleted();
            if (isCompleted && run?.generation_id === generation_id && run?.videoUrl) break;

            // Watchdog (b): executed-with-URL HEAD fallback. If the run has a videoUrl
            // for this id but videoReady never fires, wait FALLBACK_T1_MS then HEAD-check
            // the exports URL; accept it as ready on a 2xx.
            if (EXECUTED_FALLBACK_ENABLED && run?.generation_id === generation_id && run?.videoUrl && !isCompleted) {
                if (!executedSeenAt) {
                    executedSeenAt = Date.now();
                    logDebug('Executed snapshot with URL observed; starting fallback timer', { url: run.videoUrl });
                }
                if ((Date.now() - executedSeenAt) >= FALLBACK_T1_MS) {
                    try {
                        const headResp = await fetch(run.videoUrl, { method: 'HEAD' });
                        if (headResp.ok) {
                            fallbackReadyUrl = run.videoUrl;
                            state.setWorkflowCompleted(true);
                            state.setIsGenerating(false);
                            showToastNotification('Your video is ready!', 'success', { autoHideDelay: 3000 });
                            logDebug('Fallback completion accepted after HEAD check', { url: fallbackReadyUrl });
                            break;
                        }
                    } catch (e) {
                        logDebug('HEAD check failed during fallback attempt', { error: e?.message });
                    }
                }
            }

            // Watchdog (c): stall watchdog + restartWorker. After STALL_T2_MS without
            // progress, POST /api/runpod/restartWorker once. The hosted backend reads
            // the canonical snake_case generation_id body field. Disabled for v1 via
            // RESTART_WORKER_ENABLED in constants.js until a real secured restart
            // implementation exists.
            if (RESTART_WORKER_ENABLED && !restartAttempted) {
                const last = state.getLastProgressAt?.() || 0;
                if (last && (Date.now() - last) >= STALL_T2_MS) {
                    restartAttempted = true;
                    showToastNotification('Worker inactive, attempting restart...', 'warning', { autoHideDelay: 5000 });
                    try {
                        const { getSession } = await import('../../session.js');
                        const sd = getSession();
                        const h = sd?.token ? { 'Authorization': `Bearer ${sd.token}` } : {};
                        const resp = await fetch(`${API_BASE}/api/runpod/restartWorker`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...h },
                            body: JSON.stringify({ generation_id }),
                        });
                        if (!resp.ok) throw new Error(`Restart failed (${resp.status})`);
                        showToastNotification('Worker restarted. Monitoring progress...', 'info', { autoHideDelay: 4000 });
                        logDebug('Restart worker request sent successfully');
                    } catch (e) {
                        handleFatalError({
                            code: 'timeout_error',
                            message: 'Generation stalled. Please try reducing input length or settings.',
                            source: 'generation',
                            generation_id,
                            stage: 'worker_restart_failed',
                        });
                        break;
                    }
                }
            }

            await new Promise(r => setTimeout(r, 1000));
            waited += 1000;
        }

        const finalRun = state.getRunDetails();
        const videoUrlCandidate = (finalRun?.generation_id === generation_id && finalRun?.videoUrl)
            ? finalRun.videoUrl
            : fallbackReadyUrl;
        if (!videoUrlCandidate) {
            throw new Error('Video not ready in time. Please try again.');
        }

        displayResult(videoUrlCandidate, finalRun?.resolved_seed);
        updateCredits(state.getCurrentCredits() - cost);
        sendGAEvent('generation_successful', {
            event_category: GA_EVENT_CATEGORIES.GENERATION_FUNNEL,
            event_label: `Generation Success - ${type}`,
            generation_type: type,
            generation_id,
            video_url: videoUrlCandidate,
        });
    } catch (error) {
        // Surface the failing stage from the {error, generation_id, stage} envelope.
        const stageSuffix = error.stage ? ` (stage: ${error.stage})` : '';
        sendGAEvent('generation_failed_process', {
            event_category: GA_EVENT_CATEGORIES.GENERATION_FUNNEL,
            event_label: `Process Failure - ${type}`,
            generation_type: type,
            generation_id,
            error_message: error.message || 'Unknown processing error',
            failed_stage: error.stage || null,
        });
        console.error('Generation error:', error);
        handleFatalError({
            code: 'generation_error',
            message: `${error.message || 'Unknown processing error'}${stageSuffix}`,
            source: 'generation',
            generation_id,
            stage: error.stage || null,
        });
        closeGenericModal();
        return;
    } finally {
        if (state.getIsGenerating()) state.setIsGenerating(false);
        setButtonsDisabled(false);
        try { stopAnimation(animationElements()); } catch (_) {}
        closeGenericModal();
    }
}
