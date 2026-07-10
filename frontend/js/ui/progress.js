// Import dependencies
import { PROGRESS_CONFIG } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { MESSAGES } from '../config/helper-messages.js';
import * as state from '../core/state.js';
import { updateHelperTextDisplay, updateNotification } from './helpers.js';

const logDebug = createLogger('Progress');

// Module state to store DOM references and tracking
const progressState = {
    loadingProgress: null,    // DOM reference to progress bar container
    activeNodes: new Map(),   // Map to track active nodes and their segments
    totalNodes: 0,            // Total number of expected nodes
    isInitialized: false,     // Flag to prevent duplicate initialization
    
    // Stable segment mapping
    seenNodes: new Map(),     // Map nodeId → segment index for stable ordering
    nextSegmentIndex: 0,      // Next available segment index
    maxSegments: 6,           // Maximum number of segments to create (fixed rail to avoid layout jitter)
    idleCheckInterval: null,  // Interval id for idle status updates

    // UI overlay + state
    overlayEl: null,
    currentBarState: 'active' // 'starting' | 'reconnecting' | 'active' | 'failed'
};

// Initialize progress tracking
export function initializeProgressTracking() {
    if (progressState.isInitialized) {
        logDebug('Progress tracking already initialized');
        return;
    }
    
    // Get DOM references
    progressState.loadingProgress = document.querySelector('.loading-bar');
    if (!progressState.loadingProgress) {
        console.error('Failed to find loading-bar element');
        return;
    }
    
    // Determine how many nodes to track based on config
    const coreNodeCount = PROGRESS_CONFIG?.coreNodes?.length || 4;
    const optionalNodeCount = PROGRESS_CONFIG?.optionalNodes?.length || 2;
    progressState.totalNodes = coreNodeCount + optionalNodeCount;
    
    // Setup initial progress segments
    resetProgress({
        activeNodes: progressState.activeNodes,
        loadingProgress: progressState.loadingProgress,
        workflow: state.getWorkflow(),
        totalNodes: progressState.totalNodes
    });

    // Ensure overlay exists
    ensureOverlay();
    
    // Subscribe to progress events
    state.addProgressListener(handleNodeUpdate);
    
    // Handle workflow completed events
    const checkCompleted = setInterval(() => {
        if (state.getWorkflowCompleted()) {
            handleWorkflowCompleted();
            clearInterval(checkCompleted);
        }
    }, 500);


    // Start idle status updater (runs regardless of phase concurrency)
    if (!progressState.idleCheckInterval) {
        progressState.idleCheckInterval = setInterval(updateIdleStatuses, 5000);
    }
    
    progressState.isInitialized = true;
    logDebug('Progress tracking initialized:', {
        loadingProgress: progressState.loadingProgress,
        totalNodes: progressState.totalNodes
    });
}

function ensureOverlay() {
    if (!progressState.loadingProgress) return;
    // Screen readers announce the bar as a progressbar with a live value.
    progressState.loadingProgress.setAttribute('role', 'progressbar');
    progressState.loadingProgress.setAttribute('aria-valuemin', '0');
    progressState.loadingProgress.setAttribute('aria-valuemax', '100');
    if (!progressState.overlayEl) {
        const el = document.createElement('div');
        el.className = 'progress-overlay';
        el.style.display = 'none';
        el.setAttribute('aria-live', 'polite');
        progressState.loadingProgress.appendChild(el);
        progressState.overlayEl = el;
    }
}

/**
 * Toggle progress bar state classes and show status in result banner
 * @param {'starting'|'reconnecting'|'active'|'failed'} stateName
 */
export function setProgressBarState(stateName) {
    if (!progressState.loadingProgress) {
        progressState.loadingProgress = document.querySelector('.loading-bar');
    }
    if (!progressState.loadingProgress) return;

    ensureOverlay();

    const bar = progressState.loadingProgress;
    const cls = bar.classList;

    cls.remove('progress--starting', 'progress--reconnecting', 'progress--active', 'progress--failed');
    cls.add(`progress--${stateName}`);
    progressState.currentBarState = stateName;

    // Hide overlay text and use the result banner instead
    if (progressState.overlayEl) {
        progressState.overlayEl.style.display = 'none';
    }

    // Route status text to the prominent result banner
    if (stateName === 'starting') {
        updateNotification('Worker starting…', true, false, 0);
    } else if (stateName === 'reconnecting') {
        updateNotification('Reconnecting…', true, false, 0);
    } else if (stateName === 'failed') {
        updateNotification('Connection to worker lost. Please retry.', true, true, 0);
    } else if (stateName === 'active') {
        // Restore the normal generation time estimate banner
        updateNotification(MESSAGES.NOTIFICATION.GENERATION_TIME, true, false, 0);
    }

    logDebug('Progress bar state set', stateName);
}

// Map a manifest stage name to a readable label (falls back to the raw name).
function prettyStage(stageName) {
    const found = (PROGRESS_CONFIG?.stages || []).find(s => s.stage === stageName);
    return found?.description || stageName;
}

/**
 * Per-stage progress display (plan 7). Shows the stage name + N/total fed from
 * the worker StageRelay (stageName/stageIndex/stageTotal on relayed events).
 * @param {{stageName?:string, stageIndex?:number, stageTotal?:number}} stage
 */
export function setStageProgress({ stageName, stageIndex, stageTotal } = {}) {
    ensureOverlay();
    // Retain the active stage so per-step progress events (which carry no
    // stage metadata of their own once rendered) can refresh the same label
    // with a live percent instead of overwriting it.
    if (progressState.currentStage?.stageName !== stageName) {
        progressState.stagePercent = null;
    }
    progressState.currentStage = { stageName, stageIndex, stageTotal };
    renderStageText();
    renderStageRail();
    logDebug('Stage progress', { stageName, stageIndex, stageTotal });
}

/**
 * Render the stage overlay text from the retained stage + latest within-stage
 * percent, e.g. "Generating frames (2/5) - 43%".
 * @returns {void}
 */
function renderStageText() {
    const { stageName, stageIndex, stageTotal } = progressState.currentStage || {};
    const label = stageName ? prettyStage(stageName) : 'Working';
    const counter = (stageIndex != null && stageTotal != null) ? ` (${stageIndex}/${stageTotal})` : '';
    const pct = progressState.stagePercent;
    const pctText = (pct != null && pct > 0 && pct < 100) ? ` - ${Math.round(pct)}%` : '';
    const text = `${label}${counter}${pctText}`;

    if (progressState.overlayEl) {
        progressState.overlayEl.textContent = text;
        progressState.overlayEl.style.display = 'block';
    }
    state.setCurrentHelperText(text);
    updateHelperTextDisplay();
}

/**
 * Render the segment rail deterministically from stage metadata so the bar
 * always fills left to right. Overall progress is
 * (completed stages + within-stage percent) / total stages, mapped across the
 * fixed segments. Kept monotonic so late events never move the bar backwards.
 * @returns {boolean} true when stage metadata drove the rail
 */
function renderStageRail() {
    const { stageIndex, stageTotal } = progressState.currentStage || {};
    if (!stageIndex || !stageTotal || !progressState.loadingProgress) return false;
    const segments = progressState.loadingProgress.querySelectorAll('.progress-segment');
    if (!segments.length) return false;

    const pct = Math.min(Math.max(progressState.stagePercent || 0, 0), 100);
    let overall = ((stageIndex - 1) + pct / 100) / stageTotal;
    overall = Math.max(overall, progressState.overallProgress || 0);
    progressState.overallProgress = overall;
    progressState.loadingProgress.setAttribute('aria-valuenow', String(Math.round(overall * 100)));

    segments.forEach((seg, i) => {
        const fill = seg.querySelector('.segment-fill');
        if (!fill) return;
        const segStart = i / segments.length;
        const segEnd = (i + 1) / segments.length;
        const frac = Math.max(0, Math.min(1, (overall - segStart) / (segEnd - segStart)));
        fill.style.width = `${frac * 100}%`;
        fill.classList.toggle('completed', frac >= 1);
        fill.classList.toggle('active', frac > 0 && frac < 1);
        if (frac > 0) fill.classList.remove('idle');
    });
    return true;
}

// Handle node progress updates from state
function handleNodeUpdate(event) {
    if (!progressState.isInitialized) {
        logDebug('Progress tracking not initialized - ignoring update');
        return;
    }
    
    // Handle reset event
    if (event.type === 'reset') {
        progressState.currentStage = null;
        progressState.stagePercent = null;
        progressState.overallProgress = 0;
        resetProgress({
            activeNodes: progressState.activeNodes,
            loadingProgress: progressState.loadingProgress,
            workflow: state.getWorkflow(),
            totalNodes: progressState.totalNodes
        });
        return;
    }
    
    // Regular node update
    const { nodeId, value, max } = event;
    updateNodeProgress(nodeId, value, max, {
        activeNodes: progressState.activeNodes,
        loadingProgress: progressState.loadingProgress
    });
}

// Create fill element for a segment
function createFillElement(segment) {
    const fill = document.createElement('div');
    fill.className = 'segment-fill';
    segment.appendChild(fill);
    return fill;
}

/**
 * Periodically mark segments as idle if they haven't received updates recently.
 * This provides a clear signal without fabricating progress.
 */
function updateIdleStatuses() {
    const now = Date.now();
    progressState.activeNodes.forEach((data) => {
        const fill = data.element?.querySelector?.('.segment-fill');
        if (!fill) return;
        if (data.status === 'completed') {
            fill.classList.remove('idle');
            fill.classList.remove('active');
            return;
        }
        // Consider idle if no update for 15s
        const isIdle = !data.lastUpdate || (now - data.lastUpdate) > 15000;
        if (isIdle && data.status !== 'active') {
            fill.classList.add('idle');
            fill.classList.remove('active');
        } else if (!isIdle && data.status !== 'completed') {
            fill.classList.remove('idle');
        }
    });
}

// Update progress for a specific node
export function updateNodeProgress(nodeId, value, max, { activeNodes, loadingProgress }) {
    // Any incoming progress implies the bar is active
    if (progressState.currentBarState !== 'active') {
        setProgressBarState('active');
    }
    // Live within-stage percent shown next to the stage label.
    if (max > 0) {
        progressState.stagePercent = (value / max) * 100;
        renderStageText();
    }
    // When stage metadata exists (hosted modular pipeline), the rail is
    // rendered from stage progress; node-arrival segment mapping filled
    // segments out of visual order because each stage brings new node ids.
    if (renderStageRail()) {
        return;
    }
    // Synthesize a nodeId if we don't have one (getting null from server)
    const effectiveNodeId = nodeId || `synthetic-node-${progressState.nextSegmentIndex}`;
    
    // Check if this is the first time we've seen this nodeId
    if (!progressState.seenNodes.has(effectiveNodeId)) {
        // Assign this nodeId to the next available segment index
        const segmentIndex = progressState.nextSegmentIndex;
        progressState.seenNodes.set(effectiveNodeId, segmentIndex);
        progressState.nextSegmentIndex++;
        
        logDebug(`New nodeId detected: ${effectiveNodeId} assigned to segment ${segmentIndex}`);
        
        // Update helper text when we encounter a new node (represents progress phases)
        if (segmentIndex > 0) { // Don't update on very first node
            updateGenerationStatus();
        }
    }
    
    // Get the stable segment index for this nodeId
    const segmentIndex = progressState.seenNodes.get(effectiveNodeId);
    const segments = loadingProgress.querySelectorAll('.progress-segment');
    
    // Get or create the target segment
    let targetSegment = segments[segmentIndex];
    
    // Create segment if it doesn't exist yet
    if (!targetSegment) {
        // Do not append new segments after reset to avoid layout jitter.
        // Map any late/extra nodes to the last segment as an aggregator.
        if (segments.length === 0) {
            // Safety: recreate fixed rail if missing
            for (let i = 0; i < progressState.maxSegments; i++) {
                const seg = document.createElement('div');
                seg.className = 'progress-segment';
                const fillSeg = document.createElement('div');
                fillSeg.className = 'segment-fill';
                seg.appendChild(fillSeg);
                loadingProgress.appendChild(seg);
            }
        }
        targetSegment = loadingProgress.querySelectorAll('.progress-segment')[progressState.maxSegments - 1];
        logDebug(`Mapped nodeId ${effectiveNodeId} to aggregator segment at index ${progressState.maxSegments - 1}`);
    }
    
    // Ensure segment has a fill element
    if (!targetSegment.querySelector('.segment-fill')) {
        const fill = document.createElement('div');
        fill.className = 'segment-fill';
        targetSegment.appendChild(fill);
    }
    
    // Store or update node data in activeNodes map
    if (!activeNodes.has(effectiveNodeId)) {
        activeNodes.set(effectiveNodeId, {
            element: targetSegment,
            value: 0,
            max: max,
            status: 'pending',
            segmentIndex: segmentIndex,
            lastUpdate: Date.now()
        });
        
        logDebug(`Registered nodeId ${effectiveNodeId} to segment ${segmentIndex}`, { 
            nodeId: effectiveNodeId,
            segmentIndex,
            totalSegments: segments.length
        });
    }

    const nodeData = activeNodes.get(effectiveNodeId);
    
    // Update progress data
    nodeData.value = value;
    nodeData.max = max;
    nodeData.lastUpdate = Date.now();
    
    // Calculate progress percentage
    const progress = Math.min((value / max) * 100, 100); // Ensure never exceeds 100%
    
    // Get fill element and update
    const fill = nodeData.element.querySelector('.segment-fill');
    
    // Update status and styling
    if (value >= max) {
        // Completed state
        fill.classList.add('completed');
        fill.classList.remove('active');
        fill.classList.remove('idle');
        nodeData.status = 'completed';
        logDebug(`Node ${effectiveNodeId} completed at segment ${segmentIndex}`);
    } else if (effectiveNodeId === state.getCurrentNodeId()) {
        // Active state - remove completed class if it was previously completed
        fill.classList.remove('completed');
        fill.classList.add('active');
        fill.classList.remove('idle');
        nodeData.status = 'active';
    } else {
        fill.classList.remove('active');
        nodeData.status = 'pending';
    }
    
    // Always update the width
    fill.style.width = `${progress}%`;
    
    logDebug(`Updated progress for ${effectiveNodeId}: ${value}/${max} (${progress.toFixed(1)}%) at segment ${segmentIndex}`);
}

// Reset progress tracking
export function resetProgress({ activeNodes, loadingProgress, workflow, totalNodes }) {
    activeNodes.clear();
    loadingProgress.innerHTML = '';
    state.setCurrentNodeId(null);
    
    // Reset stable segment mapping
    progressState.seenNodes.clear();
    progressState.nextSegmentIndex = 0;
    
    // Reset old phase tracking (kept for compatibility)
    progressState.currentMax = 0;
    progressState.currentProcessCompleted = false;
    progressState.phaseCounter = 0;
    
    // Create fixed number of segments to start with (avoid reflow)
    if (workflow) {
        const initialSegmentCount = progressState.maxSegments;
        
        for (let i = 0; i < initialSegmentCount; i++) {
            const segment = document.createElement('div');
            segment.className = 'progress-segment';
            
            // Create fill element
            const fill = document.createElement('div');
            fill.className = 'segment-fill';
            segment.appendChild(fill);
            
            loadingProgress.appendChild(segment);
        }
        
        logDebug(`Reset progress: cleared ${progressState.seenNodes.size} node mappings, created ${initialSegmentCount} initial segments`);
    }
}

// Update generation status message
export function updateGenerationStatus(isLast = false) {
    const phase = state.getGenerationPhase();
    
    if (phase === 0) {
        state.setCurrentHelperText(MESSAGES.HELPER.GENERATION.INITIALIZING);
        updateHelperTextDisplay();
        state.setGenerationPhase(phase + 1);
    } else if (isLast) {
        state.setCurrentHelperText(MESSAGES.HELPER.GENERATION.FINALIZING);
        updateHelperTextDisplay();
    } else {
        const index = (phase - 1) % MESSAGES.HELPER.GENERATION.PHASES.length;
        state.setCurrentHelperText(MESSAGES.HELPER.GENERATION.PHASES[index]);
        updateHelperTextDisplay();
        state.setGenerationPhase(phase + 1);
    }
}

// Show/hide notification
export function showNotification(text, visible = true) {
    const notification = document.querySelector('.result-notification');
    if (notification) {
        notification.querySelector('span').innerHTML = text;
        notification.classList.toggle('visible', visible);
        logDebug('Notification updated:', text);
    }
}

/**
 * Handle workflow completion - fill any incomplete segments when result displays
 * This is the fallback the user requested to restore
 */
function handleWorkflowCompleted() {
    logDebug('Handling workflow completion - checking for incomplete segments');
    
    // Force complete any incomplete segments when result displays
    progressState.activeNodes.forEach((data, nodeId) => {
        if (data.value < data.max) {
            logDebug(`Completing incomplete segment for node ${nodeId}: ${data.value}/${data.max}`);
            updateNodeProgress(nodeId, data.max, data.max, {
                activeNodes: progressState.activeNodes,
                loadingProgress: progressState.loadingProgress
            });
        }
    });
    
    // Fill any empty segments that were never used
    const segments = progressState.loadingProgress.querySelectorAll('.progress-segment');
    segments.forEach((segment, index) => {
        const fill = segment.querySelector('.segment-fill');
        if (fill && !fill.classList.contains('completed')) {
            fill.style.width = '100%';
            fill.classList.add('completed');
            fill.classList.remove('active', 'idle');
            logDebug(`Filled unused segment at index ${index}`);
        }
    });
    
    logDebug('Workflow completion handling finished - all segments should be complete');
}

/**
 * Header startup progress bar (thin bar at top of the app)
 */
let headerProgressEl = null;
let headerProgressFill = null;
let headerProgressAnimTimer = null;
let headerProgressDisplayed = 0;  // what we are showing
let headerProgressReported = 0;   // backend-confirmed milestone

function ensureHeaderStartupProgressEl() {
    // Anchor to the result banner container and place the bar at its bottom
    const banner = document.querySelector('.result-notification');
    if (!banner) {
        // Fallback: create a fixed top bar only if banner isn't available yet
        if (!headerProgressEl) {
            headerProgressEl = document.createElement('div');
            headerProgressEl.id = 'startupHeaderProgress';
            headerProgressEl.style.position = 'fixed';
            headerProgressEl.style.top = '0';
            headerProgressEl.style.left = '0';
            headerProgressEl.style.width = '100%';
            headerProgressEl.style.height = '3px';
            headerProgressEl.style.zIndex = '1000';
            headerProgressEl.style.pointerEvents = 'none';
            headerProgressEl.style.background = 'transparent';
            headerProgressEl.style.display = 'none';
            headerProgressFill = document.createElement('div');
            headerProgressFill.className = 'startup-header-progress__fill';
            headerProgressFill.style.height = '100%';
            headerProgressFill.style.width = '0%';
            headerProgressFill.style.transition = 'width 300ms ease';
            // Brand purple (fallback to CSS var if defined)
        headerProgressFill.style.background = 'var(--brand-purple, #7A37FF)';
            headerProgressEl.appendChild(headerProgressFill);
            document.body.appendChild(headerProgressEl);
        }
        return;
    }

    // Ensure banner can host absolutely positioned child
    const cs = getComputedStyle(banner);
    if (cs.position === 'static') {
        banner.style.position = 'relative';
    }

    // Create the bar inside the banner if it does not exist
    if (!headerProgressEl || headerProgressEl.parentElement !== banner) {
        headerProgressEl = document.createElement('div');
        headerProgressEl.id = 'startupHeaderProgress';
        headerProgressEl.style.position = 'absolute';
        headerProgressEl.style.left = '0';
        headerProgressEl.style.bottom = '0';
        headerProgressEl.style.width = '100%';
        headerProgressEl.style.height = '3px';
        headerProgressEl.style.zIndex = '2'; // Above banner background, below any overlay text if needed
        headerProgressEl.style.pointerEvents = 'none';
        headerProgressEl.style.background = 'transparent';
        headerProgressEl.style.display = 'none';

        headerProgressFill = document.createElement('div');
        headerProgressFill.className = 'startup-header-progress__fill';
        headerProgressFill.style.height = '100%';
        headerProgressFill.style.width = '0%';
        headerProgressFill.style.transition = 'width 300ms ease';
        // Brand purple (fallback to CSS var if defined)
        headerProgressFill.style.background = 'var(--brand-purple, #7A37FF)';

        headerProgressEl.appendChild(headerProgressFill);
        banner.appendChild(headerProgressEl);
    }
}

/**
 * Compute the cap (nextMilestone - 1) for smoothing based on current reported milestone.
 * Milestones: 25 -> 50 -> 70 -> 90. We smooth up to 49/69/89 respectively.
 */
function getSmoothingCapFor(reported) {
    if (reported < 25) return 24;   // shouldn't happen; safety
    if (reported < 50) return 49;
    if (reported < 70) return 69;
    if (reported < 90) return 89;
    // At or beyond 90, do not smooth further; hold at reported
    return reported;
}

/**
 * Update the header startup progress bar (reported milestone 0–95)
 * Smoothing rule: animate towards nextMilestone-1; snap to reported when it increases.
 */
export function setHeaderStartupProgress(percent = 5) {
    ensureHeaderStartupProgressEl();
    const reported = Math.max(0, Math.min(95, Number(percent) || 0));
    headerProgressEl.style.display = 'block';

    // Snap forward if backend milestone increased
    if (reported > headerProgressReported) {
        headerProgressReported = reported;
        if (reported > headerProgressDisplayed) {
            headerProgressDisplayed = reported; // snap to confirmed milestone
        }
    }

    // Determine smoothing cap based on current milestone window
    const cap = getSmoothingCapFor(headerProgressReported);

    // Start/continue smoothing timer
    if (headerProgressAnimTimer) {
        // will use existing timer loop
    } else {
        headerProgressAnimTimer = setInterval(() => {
            // Ease only if we have room to smooth and health is still starting (caller controls visibility)
            const target = Math.min(cap, 95);
            if (headerProgressDisplayed < target) {
                // Gentle ease toward target (never exceed target)
                const delta = Math.max(0.2, (target - headerProgressDisplayed) * 0.1);
                headerProgressDisplayed = Math.min(target, headerProgressDisplayed + delta);
            }
            // Snap to new reported if reported moved ahead (e.g., 49 -> 50)
            if (headerProgressDisplayed < headerProgressReported) {
                headerProgressDisplayed = headerProgressReported;
            }
            // Apply style
            headerProgressFill.style.width = `${headerProgressDisplayed}%`;
        }, 120);
    }

    // Ensure width reflects any immediate snap
    headerProgressFill.style.width = `${headerProgressDisplayed}%`;
}

/**
 * Hide the header startup progress bar
 */
export function hideHeaderStartupProgress() {
    if (headerProgressAnimTimer) {
        clearInterval(headerProgressAnimTimer);
        headerProgressAnimTimer = null;
    }
    headerProgressDisplayed = 0;
    headerProgressReported = 0;
    if (headerProgressEl) {
        headerProgressEl.style.display = 'none';
        if (headerProgressFill) headerProgressFill.style.width = '0%';
    }
}

