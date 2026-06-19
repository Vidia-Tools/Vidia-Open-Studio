// =============================================================================
// Generation: ui-updates.js
// Preview compatibility checks, button state management, and initialization
// =============================================================================

import * as state from '../../core/state.js';
import { applyDisabledState } from '../../ui/ui-style-constants.js';
import { MESSAGES } from '../../config/helper-messages.js';
import { createLogger } from '../../utils/logger.js';

const logDebug = createLogger('Generation:UI');

/**
 * Checks if any features that are incompatible with preview mode are enabled.
 * Body replacement and face expression transfer cannot run in preview mode.
 * @returns {Object} Object containing whether any incompatible features are enabled and details
 */
function getPreviewIncompatibleFeatures() {
    const workflow = state.getWorkflow();
    
    // Use state.getElementState to directly check UI elements instead of workflow
    const bodyReplacementEnabled = state.getElementState('bodyReplacementToggle');
    
    // Check face expression transfer using UI element state
    const faceExpressionEnabled = state.getElementState('faceExpressionToggle');
    
    // Generate appropriate reason message based on enabled features
    let reason = "Preview unavailable when using advanced features.";
    if (bodyReplacementEnabled && faceExpressionEnabled) {
        reason = "Preview unavailable when Full Body Replacement and Face Expression Transfer are enabled.";
    } else if (bodyReplacementEnabled) {
        reason = "Preview unavailable when Full Body Replacement is enabled.";
    } else if (faceExpressionEnabled) {
        reason = "Preview unavailable when Face Expression Transfer is enabled.";
    }
    
    // Result with details for logging
    return {
        incompatible: bodyReplacementEnabled || faceExpressionEnabled,
        reason,
        features: {
            bodyReplacement: bodyReplacementEnabled,
            faceExpression: faceExpressionEnabled
        }
    };
}

/**
 * Updates preview button availability based on enabled features.
 * Disables the preview button when incompatible features are active.
 */
function updatePreviewButtonAvailability() {
    const previewButton = document.getElementById('previewButton');
    if (!previewButton) return;
    
    // Find the wrapper for the preview button
    const previewWrapper = document.querySelector('.preview-button-wrapper');
    if (!previewWrapper) return;
    
    // Check if any incompatible features are enabled
    const incompatibleFeatures = getPreviewIncompatibleFeatures();
    
    // Apply disabled state only to the preview button wrapper
    applyDisabledState(previewWrapper, incompatibleFeatures.incompatible, incompatibleFeatures.reason);
    
    // Directly disable the button element as well
    previewButton.disabled = incompatibleFeatures.incompatible;
    
    logDebug('Preview button availability updated', incompatibleFeatures);
}

/**
 * Set up listeners for feature changes that affect preview availability.
 * Watches body replacement and face expression toggles.
 */
export function initializePreviewCompatibilityObservers() {
    // Initial update
    updatePreviewButtonAvailability();
    
    // Update when full body replacement toggle changes
    const bodyReplacementToggle = document.getElementById('bodyReplacementToggle');
    if (bodyReplacementToggle) {
        bodyReplacementToggle.addEventListener('change', updatePreviewButtonAvailability);
    }
    
    // Update when face expression toggle changes
    const faceExpressionToggle = document.getElementById('faceExpressionToggle');
    if (faceExpressionToggle) {
        faceExpressionToggle.addEventListener('change', updatePreviewButtonAvailability);
    }
    
    logDebug('Preview compatibility observers initialized');
}

/**
 * Disable/enable generation buttons during generation.
 * Also updates button text to reflect current state.
 * @param {boolean} disabled - Whether buttons should be disabled
 */
export function setButtonsDisabled(disabled) {
    const previewButton = document.getElementById('previewButton');
    const fullGenerationButton = document.getElementById('fullGenerationButton');
    
    if (previewButton && fullGenerationButton) {
        previewButton.disabled = disabled;
        fullGenerationButton.disabled = disabled;
        
        // Update button text for each button individually
        previewButton.textContent = disabled ? MESSAGES.BUTTON.GENERATION.DISABLED : MESSAGES.BUTTON.GENERATION.PREVIEW;
        fullGenerationButton.textContent = disabled ? MESSAGES.BUTTON.GENERATION.DISABLED : MESSAGES.BUTTON.GENERATION.FULL;
        
        // Log button text update for debugging
        logDebug('Button text updated after generation', {
            previewButtonText: previewButton.textContent,
            fullGenerationButtonText: fullGenerationButton.textContent,
            disabled: disabled
        });
    }
}
