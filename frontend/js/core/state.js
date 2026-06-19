// Import configurations
import { DEBUG_MODE } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { MODE, getCurrentModeName } from '../config/modes.js';
import { sendGAEvent, GA_EVENT_CATEGORIES } from '../analytics.js';

const logDebug = createLogger('State');

/**
 * Vidia State Management System
 * 
 * This module provides a central state management solution with two primary patterns:
 * 
 * 1. Standard State Observation Pattern:
 *    - All state properties can be observed via the onChange(property, listener) method
 *    - Setters automatically notify listeners when property values change
 *    - Example: state.onChange('isGenerating', (value) => updateUI(value))
 * 
 * 2. Progress Tracking System:
 *    - A specialized system for tracking workflow execution progress
 *    - Uses addProgressListener(listener) for subscription
 *    - Provides detailed progress information for nodes and overall execution
 *    - Used primarily for updating progress indicators in the UI
 * 
 * When adding new state properties, follow these guidelines:
 * - Add a getter function that returns the current value
 * - Add a setter function that updates the value and notifies listeners
 * - Use notifyStateChange() in all setters to ensure observers are notified
 */

// State variables
let workflow = null;
let currentFile = null;
let currentMode = null;
let currentCredits = 1000;
let isGenerating = false;
let animationInterval = null;
let selectedLora = null;
let globalSeed = Math.floor(Math.random() * 1000000000);
let globalSteps = 20;
let currentFileKey = "";
let activeNodes = new Map();
let totalNodes = 0;
let currentNodeId = null;
let currentPromptId = null;
let workflowCompleted = false;
let generationPhase = 0;
let currentHelperText = null;
let forgeSubmode = 'reconstruct'; // Default forge submode

// Progress activity timestamp (used by watchdogs)
let lastProgressAt = 0;

// Style states
let styleImageSelected = false;
let faceImageSelected = false;

// State getters
export function getWorkflow() { return workflow; }
export function getCurrentFile() { return currentFile; }
export function getCurrentMode() {
    if (!currentMode) {
        const modeName = getCurrentModeName();
        logDebug(`Detected mode name: ${modeName}`);
        currentMode = MODE[modeName] || null;
        logDebug(`Resolved mode object:`, currentMode);
    }
    return currentMode;
}
export function getCurrentCredits() { return currentCredits; }
export function getIsGenerating() { return isGenerating; }
export function getSelectedLora() { return selectedLora; }
export function getGlobalSeed() { return globalSeed; }
export function getGlobalSteps() { return globalSteps; }
export function getCurrentFileKey() { return currentFileKey; }
export function getActiveNodes() { return activeNodes; }
export function getTotalNodes() { return totalNodes; }
export function getCurrentNodeId() { return currentNodeId; }
export function getCurrentPromptId() { return currentPromptId; }
export function getWorkflowCompleted() { return workflowCompleted; }
export function getGenerationPhase() { return generationPhase; }
export function getCurrentHelperText() { return currentHelperText; }
export function getStyleImageSelected() { return styleImageSelected; }
export function getFaceImageSelected() { return faceImageSelected; }
export function getAnimationInterval() { return animationInterval; }
export function getForgeSubmode() { return forgeSubmode; }
export function getLastProgressAt() { return lastProgressAt; }

// For RunPod integration - stores video URL with associated generationID
let currentRunDetails = null;

/**
 * Get current run details including video URL and generationID
 * @returns {Object|null} Run details object with { videoUrl, generationID } or null
 */
export function getRunDetails() { return currentRunDetails; }

/**
 * Set run details with video URL and generationID for tracking
 * @param {Object|null} details - Run details object with { videoUrl, generationID } or null to clear
 */
export function setRunDetails(details) { 
    currentRunDetails = details; 
    logDebug('Run details updated:', details);
    notifyStateChange('runDetails', details);
}

/**
 * Clear current run details (sets to null)
 */
export function clearRunDetails() {
    currentRunDetails = null;
    logDebug('Run details cleared');
    notifyStateChange('runDetails', null);
}

// State setters
export function setCurrentMode(mode) {
    currentMode = mode;
    logDebug('Current mode updated:', mode?.title);
    notifyStateChange('currentMode', mode);
}

export function setWorkflow(newWorkflow) {
    workflow = newWorkflow;
    logDebug('Workflow updated');
    notifyStateChange('workflow', newWorkflow);
}

export function setCurrentFile(file) {
    currentFile = file;
    logDebug('Current file updated:', file?.name);
    notifyStateChange('currentFile', file);
}

export function setCurrentCredits(amount) {
    currentCredits = amount;
    logDebug('Credits updated:', amount);
    notifyStateChange('currentCredits', amount);
}

export function setIsGenerating(value) {
    isGenerating = value;
    logDebug('Generation state:', value);
    notifyStateChange('isGenerating', value);
}

export function setSelectedLora(lora) {
    selectedLora = lora;
    logDebug('Selected LoRA updated:', lora);
    notifyStateChange('selectedLora', lora);
}

export function updateGlobalSeed() {
    globalSeed = Math.floor(Math.random() * 1000000000);
    logDebug('Global seed updated:', globalSeed);
    notifyStateChange('globalSeed', globalSeed);
}

export function setGlobalSteps(steps) {
    globalSteps = steps;
    logDebug('Global steps updated:', steps);
    notifyStateChange('globalSteps', steps);
}

export function setCurrentFileKey(key) {
    currentFileKey = key;
    logDebug('File key updated:', key);
    notifyStateChange('currentFileKey', key);
}

export function setTotalNodes(count) {
    totalNodes = count;
    logDebug('Total nodes updated:', count);
    notifyStateChange('totalNodes', count);
}

export function setCurrentNodeId(nodeId) {
    currentNodeId = nodeId;
    logDebug('Current node updated:', nodeId);
    notifyStateChange('currentNodeId', nodeId);
}

export function setCurrentPromptId(promptId) {
    currentPromptId = promptId;
    logDebug('Current prompt ID updated:', promptId);
    notifyStateChange('currentPromptId', promptId);
}

export function setWorkflowCompleted(completed) {
    workflowCompleted = completed;
    logDebug('Workflow completed:', completed);
    notifyStateChange('workflowCompleted', completed);
}

export function setGenerationPhase(phase) {
    generationPhase = phase;
    logDebug('Generation phase updated:', phase);
    notifyStateChange('generationPhase', phase);
}

export function setCurrentHelperText(text) {
    currentHelperText = text;
    logDebug('Helper text updated:', text);
    notifyStateChange('currentHelperText', text);
}

export function setStyleImageSelected(selected) {
    styleImageSelected = selected;
    logDebug('Style image selected:', selected);
    notifyStateChange('styleImageSelected', selected);
}

export function setFaceImageSelected(selected) {
    faceImageSelected = selected;
    logDebug('Face image selected:', selected);
    notifyStateChange('faceImageSelected', selected);
}

export function setAnimationInterval(interval) {
    animationInterval = interval;
    logDebug('Animation interval updated');
    notifyStateChange('animationInterval', interval);
}

export function setForgeSubmode(submode) {
    forgeSubmode = submode;
    logDebug('Forge submode updated:', submode);
    notifyStateChange('forgeSubmode', submode);
}

// Node progress tracking reset
export function resetProgress() {
    activeNodes.clear();
    totalNodes = 0;
    currentNodeId = null;
    generationPhase = 0;
    lastProgressAt = Date.now();
    logDebug('Progress reset');
    
    // Notify listeners about the reset
    progressListeners.forEach(listener => {
        try {
            listener({ 
                type: 'reset'
            });
        } catch (err) {
            console.error('Error in progress listener:', err);
        }
    });
}

// Event system for state observation
const stateListeners = new Map();
const progressListeners = new Set();

/**
 * Subscribe to changes in a specific state property
 * @param {string} property - The state property to observe (e.g., 'currentMode', 'selectedLora')
 * @param {Function} listener - Function to call when the state property changes
 * @returns {Function} Unsubscribe function to remove the listener
 */
export function onChange(property, listener) {
    if (!stateListeners.has(property)) {
        stateListeners.set(property, new Set());
    }
    
    stateListeners.get(property).add(listener);
    logDebug(`State listener added for ${property}, total:`, stateListeners.get(property).size);
    
    return () => {
        const listeners = stateListeners.get(property);
        if (listeners) {
            listeners.delete(listener);
            logDebug(`State listener removed for ${property}, remaining:`, listeners.size);
        }
    };
}

/**
 * Notify listeners about a state change
 * @param {string} property - The state property that changed
 * @param {any} value - The new value of the property
 * @private
 */
function notifyStateChange(property, value) {
    const listeners = stateListeners.get(property);
    if (listeners) {
        listeners.forEach(listener => {
            try {
                listener(value);
            } catch (err) {
                console.error(`Error in state listener for ${property}:`, err);
            }
        });
    }

    // Send GA events for specific state changes
    try {
        switch (property) {
            case 'isGenerating':
                if (value === true) {
                    sendGAEvent('generation_process_started', {
                        event_category: GA_EVENT_CATEGORIES.GENERATION_FUNNEL,
                        event_label: 'Generation Status Change'
                    });
                } else {
                    // More specific events for success/failure/cancel should be triggered
                    // directly from the generation logic (e.g., in generation.js)
                    // This one can signify the overall process ending from a state perspective.
                    sendGAEvent('generation_process_ended', {
                        event_category: GA_EVENT_CATEGORIES.GENERATION_FUNNEL,
                        event_label: 'Generation Status Change'
                    });
                }
                break;
            case 'currentMode':
                if (value && value.title) {
                    const modeName = value.title.toLowerCase();
                    sendGAEvent('mode_selected_in_dashboard', { // Differentiate from initial menu selection
                        event_category: GA_EVENT_CATEGORIES.NAVIGATION,
                        event_label: 'Dashboard Mode Change',
                        selected_mode: modeName
                    });
                    if (typeof gtag === 'function') {
                        gtag('set', 'user_properties', { 'last_active_app_mode': modeName });
                        if (DEBUG_MODE) {
                            console.log('[State - UserProp] Set last_active_app_mode:', modeName);
                        }
                    }
                }
                break;
            case 'selectedLora':
                if (value) {
                    sendGAEvent('lora_selected_from_state', { // Can be more specific if source is known
                        event_category: GA_EVENT_CATEGORIES.CORE_FEATURE,
                        event_label: 'LoRA Interaction',
                        lora_name: value // Assuming 'value' is the LoRA name string
                    });
                } else {
                    sendGAEvent('lora_deselected_from_state', {
                        event_category: GA_EVENT_CATEGORIES.CORE_FEATURE,
                        event_label: 'LoRA Interaction'
                    });
                }
                break;
            case 'forgeSubmode':
                if (value) {
                    sendGAEvent('forge_submode_changed', {
                        event_category: GA_EVENT_CATEGORIES.CORE_FEATURE,
                        event_label: 'Forge Mode Configuration',
                        submode: value
                    });
                }
                break;
            case 'currentCredits':
                // This event is broad. More specific credit change events (purchase, deduction, refund)
                // should be triggered from their respective logic points.
                // However, tracking the balance update itself can be useful.
                sendGAEvent('credits_balance_updated_in_state', {
                    event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE, // Or a dedicated 'Monetization' category
                    event_label: 'Credit Balance Change',
                    new_balance: value
                    // Consider adding 'change_reason' if it can be passed to setCurrentCredits
                });
                break;
            // Add more cases here for other state properties as needed
        }
    } catch (gaError) {
        if (DEBUG_MODE) {
            console.error('[State - GA] Error sending GA event from notifyStateChange:', {
                property: property,
                value: value,
                error: gaError
            });
        }
    }
}

/**
 * Add a listener to be notified of progress updates
 * @param {Function} listener - Function to call when progress updates
 * @returns {Function} Unsubscribe function to remove the listener
 */
export function addProgressListener(listener) {
    progressListeners.add(listener);
    logDebug('Progress listener added, total:', progressListeners.size);
    return () => {
        progressListeners.delete(listener);
        logDebug('Progress listener removed, remaining:', progressListeners.size);
    };
}

// Modified updateNodeProgress to notify listeners
export function updateNodeProgress(nodeId, value, max) {
    if (!activeNodes.has(nodeId)) {
        activeNodes.set(nodeId, { value: 0, max: max });
        logDebug(`New node progress tracking:`, { nodeId, max });
    }
    
    const node = activeNodes.get(nodeId);
    node.value = value;
    node.max = max;
    lastProgressAt = Date.now();
    logDebug(`Node progress updated:`, { nodeId, value, max });
    
    // Notify listeners
    progressListeners.forEach(listener => {
        try {
            listener({
                nodeId,
                value,
                max,
                currentNode: currentNodeId
            });
        } catch (err) {
            console.error('Error in progress listener:', err);
        }
    });
}

/**
 * Get the current state of any DOM element
 * 
 * This function provides the UI equivalent of the standard state getters,
 * allowing direct access to the state of any UI element based on its type.
 * 
 * @param {string|HTMLElement} element - Element ID or element reference
 * @returns {*} The element's current state value based on element type:
 *   - Checkbox/radio: boolean (checked state)
 *   - Select/input: value as string
 *   - Image: boolean (if loaded & visible)
 *   - Canvas with point data attributes: object with point counts
 *   - Other elements: value or innerText
 */
export function getElementState(element) {
    // Resolve element reference
    const el = typeof element === 'string' ? document.getElementById(element) : element;
    if (!el) return null;
    
    // Handle different element types
    if (el.tagName === 'INPUT') {
        if (el.type === 'checkbox' || el.type === 'radio') {
            return el.checked;
        }
        return el.value;
    } 
    
    if (el.tagName === 'SELECT') {
        return el.value;
    }
    
    if (el.tagName === 'IMG') {
        return el.src && 
               el.src !== '' && 
               !el.src.endsWith('#') && 
               el.style.display !== 'none' &&
               el.naturalWidth > 0;
    }
    
    if (el.tagName === 'CANVAS') {
        // For canvas elements with our data attributes system
        if ('greenPointsCount' in el.dataset || 'redPointsCount' in el.dataset || 'totalPointsCount' in el.dataset) {
            return {
                greenPoints: parseInt(el.dataset.greenPointsCount || '0'),
                redPoints: parseInt(el.dataset.redPointsCount || '0'),
                totalPoints: parseInt(el.dataset.totalPointsCount || '0')
            };
        }
        return null;
    }
    
    // Default for other elements
    return el.value !== undefined ? el.value : 
           (el.innerText !== undefined ? el.innerText.trim() : null);
}


