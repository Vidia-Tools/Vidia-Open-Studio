// Import dependencies
import { DEBUG_MODE } from '../config/index.js';
import { createAndInject } from './ui-factory-utilities.js';
import * as state from '../core/state.js';
import { getCurrentModeName } from '../config/modes.js';
import { getColorPreference } from './theme.js';
import * as store from '../core/generation-store.js';

/**
 * Feature warning configuration - declare incompatible-feature pairs here.
 * Dev-friendly: add an entry to surface a new conflict. Each entry reads the
 * generation store features and anchors its warning under a manifest control.
 * - id: unique id
 * - features: [{ id, getState, containerQuery? }] (getState reads the store)
 * - condition(states): true when the warning should show
 * - message / severity
 *   - 'caution': soft yellow advisory (non-blocking)
 *   - 'warning': red advisory (non-blocking)
 *   - 'error':   red AND blocks generation (lifecycle.js calls getActiveErrors()
 *     pre-submit and aborts the run if any fire; future error rules block
 *     automatically with no extra wiring)
 */
const FEATURE_CONFLICTS = [
    {
        id: 'detailer-face-conflict',
        features: [
            { id: 'faceSwap', getState: () => !!store.getFeatures().faceSwap },
            {
                id: 'detailer',
                getState: () => !!store.getFeatures().detailer,
                containerQuery: () => document.getElementById('ctl_detailer')?.closest('.advanced-setting'),
            },
        ],
        condition: (states) => states.faceSwap && states.detailer,
        message: 'Detailer may override face replacement effects. For better results, try reducing the detailer strength or turning it off.',
        severity: 'warning'
    },
    {
        id: 'body-subject-conflict',
        features: [
            {
                id: 'bodyReplacement',
                elementId: 'bodyReplacementToggle',
                getState: (el) => el?.checked || false,
                containerQuery: () => document.getElementById('bodyReplacementToggle')?.closest('.advanced-setting')
            },
            {
                id: 'subjectBiped',
                elementId: 'subjectSelect',
                getState: (el) => parseInt(el?.value || '0') === 1,
                containerQuery: () => document.getElementById('subjectSelectContainer')
            },
            {
                id: 'forgeReconstruct',
                getState: () => getCurrentModeName() === 'forge' && state.getForgeSubmode() === 'reconstruct',
                // No container needed as this is just a state check
            }
        ],
        condition: (states) => states.bodyReplacement && states.subjectBiped && states.forgeReconstruct,
        message: 'When "Person or Biped" subject type is selected with Body Replacement, results may not match expectations since it uses OpenPose. For best results with Body Replacement, try using the "General" subject type.',
        severity: 'caution'
    },
    {
        // Envision: Body Replacement discards the replaced body's appearance
        // when Pose is the only active guidance, because pose extraction keeps
        // only the skeleton. Anchor under the fullBodyReplace control.
        id: 'envision-body-pose-only',
        features: [
            {
                id: 'fullBodyReplace',
                getState: () => !!store.getFeatures().fullBodyReplace,
                containerQuery: () => document.getElementById('ctl_fullBodyReplace')?.closest('.advanced-setting'),
            },
            {
                id: 'envisionMethod',
                getState: () => store.getMethod() === 'envision',
            },
            {
                id: 'controlGuide',
                getState: () => store.getParam('control_guide') === true,
            },
            {
                id: 'usePose',
                getState: () => store.getParam('use_pose') === true,
            },
            {
                id: 'useDepth',
                getState: () => store.getParam('use_depth') === true,
            },
            {
                id: 'useCanny',
                getState: () => store.getParam('use_canny') === true,
            },
        ],
        condition: (states) =>
            states.envisionMethod && states.fullBodyReplace && states.controlGuide
            && states.usePose && !states.useDepth && !states.useCanny,
        message: 'Body Replacement has no visible effect with Pose-only guidance: pose extraction keeps only the skeleton, so the replaced body\'s appearance is discarded. Add Depth or Edge guidance, or turn off Control Guidance to use the raw video.',
        severity: 'warning'
    },
    {
        // Envision: Control Guidance toggle is on but no control type is
        // selected. This is a hard error: the worker would run with no
        // guidance signal, wasting a credit. Anchor under the Control
        // Guidance parent toggle (ctl_control_guide).
        id: 'envision-control-none-selected',
        features: [
            {
                id: 'envisionMethod',
                getState: () => store.getMethod() === 'envision',
            },
            {
                id: 'controlGuide',
                getState: () => store.getParam('control_guide') === true,
                containerQuery: () => document.getElementById('ctl_control_guide')?.closest('.advanced-setting'),
            },
            {
                id: 'usePose',
                getState: () => store.getParam('use_pose') === true,
            },
            {
                id: 'useDepth',
                getState: () => store.getParam('use_depth') === true,
            },
            {
                id: 'useCanny',
                getState: () => store.getParam('use_canny') === true,
            },
        ],
        condition: (states) =>
            states.envisionMethod && states.controlGuide
            && !states.usePose && !states.useDepth && !states.useCanny,
        message: 'Control Guidance is on but no control is selected. Check at least one control, or turn off Control Guidance to use your raw video.',
        severity: 'error'
    }
];

/**
 * Get theme-aware colors for warnings based on severity and current theme
 * @param {string} severity - The severity level ('warning' or 'caution')
 * @returns {Object} Colors object with bg, border, icon, and text properties
 */
function getThemeAwareColors(severity) {
    // Detect current theme
    const isDarkMode = getColorPreference() === 'dark';
    
    if (isDarkMode) {
        // Dark mode colors
        if (severity === 'error') {
            return {
                bg: '#3A1617',
                border: '#ff4136',
                icon: '#ff4136',
                text: '#f8f8f8'
            }; // Dark red, same family as warning but uses prod error red
        }
        return severity === 'warning'
            ? { 
                bg: '#3A1617', 
                border: '#ff6b6b', 
                icon: '#ff6b6b',
                text: '#f8f8f8'
              }  // Dark red tones for warnings
            : { 
                bg: '#332911', 
                border: '#ffcc29', 
                icon: '#ffcc29',
                text: '#f8f8f8' 
              }; // Dark amber tones for cautions
    } else {
        // Light mode colors
        if (severity === 'error') {
            return {
                bg: '#FFEBE6',
                border: '#ff4136',
                icon: '#ff4136',
                text: '#222222'
            }; // Prod error red (#ff4136 from style.css .toast-notification.error)
        }
        return severity === 'warning'
            ? { 
                bg: '#FFEBE6', 
                border: '#ff512f', 
                icon: '#ff512f',
                text: '#222222'
              }  // Red tones for warnings
            : { 
                bg: '#FFF9E6', 
                border: '#ffae00', 
                icon: '#ffae00',
                text: '#222222'
              }; // Yellow tones for cautions
    }
}

// Warning HTML Template for inline styling
const getWarningTemplate = (message, severity) => {
    // Get theme-aware colors
    const colors = getThemeAwareColors(severity);
    
    return `
    <div style="display: flex; align-items: center; margin-right: 10px;">
        <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: ${colors.icon};">
            <path d="M12 2L1 21h22L12 2zm0 3.5L19.5 19h-15L12 5.5z"/>
            <path d="M12 16a1 1 0 100 2 1 1 0 000-2zm0-7a1 1 0 00-1 1v4a1 1 0 002 0v-4a1 1 0 00-1-1z"/>
        </svg>
    </div>
    <div style="flex: 1; font-size: 0.9rem; line-height: 1.3; color: ${colors.text};">${message}</div>
`;
};

/**
 * Initialize the feature warning system
 */
export function initializeFeatureWarnings() {
    // Set up event listeners
    setupWarningEventListeners();
    
    // Initial update
    updateWarnings();
    
    logDebug('Feature warnings initialized');
}

/**
 * Set up event listeners for warnings. Manifest controls write the generation
 * store on input/change, which bubbles to the #osControls mount; re-evaluate
 * conflicts on every such change.
 */
function setupWarningEventListeners() {
    const mount = document.getElementById('osControls');
    if (mount) {
        mount.addEventListener('change', updateWarnings);
        mount.addEventListener('input', updateWarnings);
    }
    logDebug('Warning event listeners set up');
}

/**
 * Update all feature conflict warnings
 */
export function updateWarnings() {
    // Process each conflict definition
    FEATURE_CONFLICTS.forEach(conflict => {
        // Get current state for each feature in this conflict
        const states = {};
        const containers = [];
        
        // Evaluate all feature states
        conflict.features.forEach(feature => {
            // Get element if ID is provided
            const element = feature.elementId ? document.getElementById(feature.elementId) : null;
            
            // Get feature state
            states[feature.id] = feature.getState(element);
            
            // Get container if available
            if (feature.containerQuery) {
                const container = feature.containerQuery();
                if (container) {
                    containers.push(container);
                }
            }
        });
        
        // Check if warning should be shown
        const shouldShow = conflict.condition(states);
        
        // Update each container's warning
        containers.forEach((container, index) => {
            // Create a unique ID for this warning instance
            const warningType = `${conflict.id}-${index}`;
            
            updateWarning(
                warningType,
                container,
                shouldShow,
                conflict.message,
                conflict.severity
            );
        });
        
        // Log the state evaluation
        logDebug(`Evaluated conflict ${conflict.id}:`, {
            states,
            shouldShow,
            containersFound: containers.length
        });
    });
}

/**
 * Return all currently-firing error-severity rules (severity === 'error').
 * lifecycle.js calls this pre-submit and blocks the run if any are active,
 * so future error rules block generation automatically with no extra wiring.
 * @returns {Array<{id: string, message: string}>} Firing error rules
 */
export function getActiveErrors() {
    return FEATURE_CONFLICTS
        .filter(conflict => conflict.severity === 'error')
        .map(conflict => {
            const states = {};
            conflict.features.forEach(feature => {
                const element = feature.elementId ? document.getElementById(feature.elementId) : null;
                states[feature.id] = feature.getState(element);
            });
            return { id: conflict.id, message: conflict.message, firing: conflict.condition(states) };
        })
        .filter(rule => rule.firing);
}

/**
 * Generate a stable container identifier string 
 * @param {HTMLElement} container - The container element
 * @returns {string} A stable identifier string
 */
function getStableContainerId(container) {
    // Use ID if available
    if (container.id) {
        return `id-${container.id}`;
    }
    
    // Otherwise use a combination of attributes that should be stable
    const classes = container.className.split(' ').join('-');
    const tagName = container.tagName.toLowerCase();
    const childCount = container.children.length;
    
    // Include the position path to make it more unique
    let positionPath = '';
    let parent = container.parentNode;
    let depth = 0;
    while (parent && parent.tagName && depth < 3) {
        const siblings = Array.from(parent.children);
        const index = siblings.indexOf(depth === 0 ? container : parent);
        positionPath = `${parent.tagName.toLowerCase()}-${index}-${positionPath}`;
        parent = parent.parentNode;
        depth++;
    }
    
    return `pos-${positionPath}-${tagName}-${classes}-${childCount}`;
}

/**
 * Find and remove existing warnings for a container
 * @param {HTMLElement} targetContainer - The container to remove warnings from
 */
function removeExistingWarnings(targetContainer) {
    // Look for warnings after this container that have our data attributes
    const warnings = document.querySelectorAll('[data-feature-warning="true"]');
    
    // Check all warnings to see if they belong to this container
    Array.from(warnings).forEach(warning => {
        const warningContainerId = warning.getAttribute('data-container-id');
        const stableId = getStableContainerId(targetContainer);
        
        // If this warning is right after our container, remove it
        if (warning.previousElementSibling === targetContainer || 
            warningContainerId === stableId) {
            
            warning.remove();
            
            logDebug(`Removed warning by DOM traversal:`, { 
                warningId: warning.id,
                containerId: stableId
            });
        }
    });
}

/**
 * Update a specific warning
 * @param {string} warningType - Type of warning
 * @param {HTMLElement} targetContainer - Container to inject the warning into
 * @param {boolean} shouldShow - Whether to show the warning
 * @param {string} message - Warning message
 * @param {string} severity - Warning severity ('warning', 'caution', 'info')
 */
function updateWarning(warningType, targetContainer, shouldShow, message, severity) {
    // Exit if target container doesn't exist
    if (!targetContainer) {
        logDebug(`Target container for ${warningType} warning not found`);
        return;
    }
    
    // Generate a stable ID for this specific container
    const stableId = getStableContainerId(targetContainer);
    const warningId = `${warningType}-${stableId}`;
    
    // Always try to clean up existing warnings for this container
    removeExistingWarnings(targetContainer);
    
    // Check if warning already exists for this container by ID (should be more reliable now)
    const existingWarning = document.getElementById(warningId);
    
    // Warning should be hidden
    if (!shouldShow) {
        if (existingWarning) {
            existingWarning.remove();
            logDebug(`Removed warning by ID: ${warningId}`, { 
                container: targetContainer,
                warningType
            });
        }
        return;
    }
    
    // Warning already exists, no need to recreate it
    if (existingWarning) {
        return;
    }
    
    // Get theme-aware colors for the warning
    const colors = getThemeAwareColors(severity);
    
    // Create a warning wrapper with inline styles
    const warningWrapper = document.createElement('div');
    warningWrapper.id = warningId;
    warningWrapper.className = 'feature-warning' + (severity === 'error' ? ' feature-warning-error' : ''); // Add a class for easier selection + red variant marker for errors
    
    // Add data attributes for easier identification and removal
    warningWrapper.setAttribute('data-feature-warning', 'true');
    warningWrapper.setAttribute('data-warning-type', warningType);
    warningWrapper.setAttribute('data-container-id', stableId);
    
    // Apply all styles inline
    Object.assign(warningWrapper.style, {
        position: 'relative',
        marginTop: '10px',
        marginBottom: '10px',
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        borderRadius: '5px',
        backgroundColor: colors.bg,
        borderLeft: `3px solid ${colors.border}`,
        fontSize: '0.9rem',
        lineHeight: '1.3'
    });
    
    // Set warning HTML using our template function
    warningWrapper.innerHTML = getWarningTemplate(message, severity);
    
    // Insert the warning after the target container
    targetContainer.parentNode.insertBefore(warningWrapper, targetContainer.nextSibling);
    
    logDebug(`Added warning ${warningId} to ${stableId}`, {
        container: targetContainer,
        message,
        severity,
        warningType
    });
}

/**
 * Debug logging
 * @param {string} message - Debug message
 * @param {Object} [data] - Optional data to log
 */
function logDebug(message, data) {
    if (DEBUG_MODE) {
        if (data !== undefined) {
            console.log(`[FeatureWarnings] ${message}`, data);
        } else {
            console.log(`[FeatureWarnings] ${message}`);
        }
    }
}
