// Import dependencies
import { createLogger } from '../utils/logger.js';
import { MESSAGES } from '../config/helper-messages.js';
import * as state from '../core/state.js';
import { sendGAEvent, GA_EVENT_CATEGORIES } from '../analytics.js';

const logDebug = createLogger('Helpers');
import { applyStyles, DESELECT_BUTTON_STYLES } from './ui-style-constants.js';

/**
 * Centralized fatal error handler for consistent error display and UI cleanup
 * @param {Object|string} errorData - Error envelope or simple error message
 */
export function handleFatalError(errorData) {
    let userMessage = "An unexpected error occurred during generation.";
    let errorCode = null;
    let errorSource = null;
    
    // Process error data
    if (typeof errorData === 'string') {
        userMessage = errorData;
    } else if (errorData && typeof errorData === 'object') {
        // Worker pipeline errors arrive as {error, stage, generation_id}
        // (rp_handler.py relay), UI-originated ones as {message, code}.
        userMessage = errorData.message || errorData.error || userMessage;
        errorCode = errorData.code;
        errorSource = errorData.source;
        
        // Map error codes to user-friendly messages
        if (errorCode === 'timeout_error') {
            userMessage = "Generation stalled due to inactivity. This often happens with very long, high-resolution, or high-FPS videos. Try reducing video length, resolution, or frame rate.";
        } else if (errorCode === 'upload_error') {
            userMessage = "Upload failed. Please retry. Check your connection and file size limits.";
        } else if (errorCode === 'comfy_error') {
            userMessage = "Generation failed inside the model pipeline. Try a different style or lower settings.";
        } else if (errorCode === 'websocket_error') {
            userMessage = "Disconnected from server. We'll reconnect automatically. If it persists, retry.";
        } else if (errorCode === 'auth_error') {
            userMessage = "Authentication failed. Please login again.";
        } else if (errorCode === 'storage_error' || errorCode === 'email_error') {
            userMessage = "Result processing failed. We'll retry automatically. You'll receive an email when it's ready.";
        }

        // Append the failing pipeline step and generation id so users can
        // copy an actionable report instead of "it didn't work".
        const detailParts = [];
        if (errorData.stage) detailParts.push(`step: ${errorData.stage}`);
        if (errorData.generation_id) detailParts.push(`ID: ${errorData.generation_id}`);
        if (detailParts.length) userMessage += ` (${detailParts.join(', ')})`;
    }
    
    // Show persistent error toast and static notification
    showToastNotification(userMessage, 'error', { 
        autoHideDelay: 0, // Never auto-hide
        showSupport: true 
    });
    updateNotification(userMessage, true, true, 0); // Persistent static red banner
    
    // Stop UI animations and clear generating state
    state.setWorkflowCompleted(true);
    state.setIsGenerating(false);
    
    // Stop any active animations
    try {
        const { stopAnimation } = import('../ui/animations.js');
        stopAnimation?.({
            resultContent: document.querySelector('.result-content'),
            resultArea: document.querySelector('.result-area'),
            animationContainer: document.querySelector('.animation-container'),
            waves: document.querySelectorAll('.wave')
        });
    } catch (e) {
        // Animation module may not be available, that's OK
    }
    
    // Re-enable buttons
    const previewButton = document.getElementById('previewButton');
    const fullGenerationButton = document.getElementById('fullGenerationButton');
    if (previewButton && fullGenerationButton) {
        previewButton.disabled = false;
        fullGenerationButton.disabled = false;
        previewButton.textContent = MESSAGES.BUTTON.GENERATION.PREVIEW;
        fullGenerationButton.textContent = MESSAGES.BUTTON.GENERATION.FULL;
    }
    
    // Log for diagnostics
    logDebug('Fatal error handled:', {
        userMessage,
        errorCode,
        errorSource,
        originalError: errorData
    });
    
    // Send analytics event
    try {
        sendGAEvent('fatal_error_handled', {
            event_category: GA_EVENT_CATEGORIES.GENERATION_FUNNEL,
            event_label: 'Fatal Error Handler',
            error_code: errorCode || 'unknown',
            error_source: errorSource || 'unknown',
            error_message: userMessage.substring(0, 100)
        });
    } catch (e) {
        // Analytics may not be available, continue silently
    }

    // Actionable error UX (details + suggestions)
    try {
        showActionableError(errorCode || 'unknown', errorData?.generationID || null);
    } catch (e) {
        // Non-fatal if the helper fails
    }
}

// Define which nodes trigger which messages
export const NODE_MESSAGE_MAP = {
    // Default mappings (for Trace/Evolve modes)
    default: {
        // Initial message (always shown first)
        initial: MESSAGES.HELPER.GENERATION.INITIALIZING,
        
        // Node-specific messages
        ['CHECKPOINT']: MESSAGES.HELPER.GENERATION.PHASES[0],
        ['CONTROLNET_OPENPOSE']: MESSAGES.HELPER.GENERATION.PHASES[1],
        ['CONTROLNET_DEPTH']: MESSAGES.HELPER.GENERATION.PHASES[1],
        ['SAMPLER']: MESSAGES.HELPER.GENERATION.PHASES[2],
        ['STYLE_LORA']: MESSAGES.HELPER.GENERATION.PHASES[3],
        ['STYLE_TRANSFER']: MESSAGES.HELPER.GENERATION.PHASES[3],
        ['DETAILER']: MESSAGES.HELPER.GENERATION.PHASES[4],
        ['RIFE']: MESSAGES.HELPER.GENERATION.PHASES[5],
        ['UPSCALER']: MESSAGES.HELPER.GENERATION.PHASES[6],
        ['VIDIA_SAVER']: MESSAGES.HELPER.GENERATION.PHASES[6],
        
        // Completion message
        final: MESSAGES.HELPER.GENERATION.FINALIZING
    },
    
    // Forge-specific mappings will be added later
    forge: {
        // This will be populated later
    }
};

// More options state
let currentCycle = [];
let shownPhrases = new Set();

// Get current prompt text
function getCurrentPrompt() {
    const subject = document.getElementById('mediumSubject').value;
    const background = document.getElementById('background').value;
    return background ? `${subject}, ${background} in the background` : subject;
}

// Get helper text based on element
function getHelperText(element) {
    const helperKey = element.getAttribute('data-helper');
    if (!helperKey) return MESSAGES.HELPER.DEFAULT;

    const messageOrObject = helperKey.split('.').reduce((obj, key) => obj?.[key], MESSAGES.HELPER);

    if (typeof messageOrObject === 'object' && messageOrObject !== null) {
        const toggleInput = element.querySelector('input[type="checkbox"]');
        if (toggleInput) {
            // For dynamic text that depends on a function, like the token counter
            if (toggleInput.id === 'autoImproveToggle' && !toggleInput.checked) {
                const tokenCount = getCurrentPrompt().trim().split(/\s+/).filter(Boolean).length;
                return messageOrObject.DISABLED(tokenCount);
            }
            return toggleInput.checked ? messageOrObject.ENABLED : messageOrObject.DISABLED;
        }
    }

    if (typeof messageOrObject === 'string') {
        return messageOrObject;
    }

    return MESSAGES.HELPER.DEFAULT;
}

/**
 * Setup helper text system with automatic UI updates on state changes
 * @param {HTMLElement} helperTextElement - The element where helper text will be displayed
 * @param {Array} elementsWithHelper - Array of elements that should trigger helper text on hover
 * @returns {Object} Configuration methods and cleanup function
 */
export function setupHelperText(helperTextElement, elementsWithHelper) {
    let preservedHelperText = MESSAGES.HELPER.DEFAULT;

    // Add state observer for currentHelperText
    const unsubscribe = state.onChange('currentHelperText', () => {
        updateHelperTextDisplay();
    });

    function resetHelperText() {
        state.setCurrentHelperText(preservedHelperText);
        // No need to call updateHelperTextDisplay() here as the observer will handle it
    }

    // Handle elements with helper text
    elementsWithHelper.forEach(element => {
        element.addEventListener('mouseenter', () => {
            if (!state.getIsGenerating()) {
                const helperContent = getHelperText(element);
                state.setCurrentHelperText(helperContent);
            }
        });

        element.addEventListener('mouseleave', () => {
            if (!state.getIsGenerating()) {
                resetHelperText();
            }
        });
    });

    // Initialize with default text
    resetHelperText();

    // Export function to update preserved text and unsubscribe method
    return {
        updatePreservedText: (text) => {
            preservedHelperText = text;
            resetHelperText();
        },
        unsubscribe // For cleanup when needed
    };
}

/**
 * Update helper text display with support for progress indicators
 * Handles both simple text updates and progress percentage displays
 */
function updateHelperTextDisplay() {
    const helperTextElement = document.getElementById('helperText');
    if (!helperTextElement) return;
    
    const currentText = state.getCurrentHelperText();
    
    // Check if this is a progress percentage message (like "Uploading video: 45%")
    const progressMatch = currentText.match(/(.*?):\s*(\d+)%$/);
    
    if (progressMatch) {
        // Extract message and percentage
        const [, message, percentStr] = progressMatch;
        const percent = parseInt(percentStr, 10);
        
        // Create progress bar HTML
        const progressHTML = `
            <div class="progress-message">${message}:</div>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${percent}%"></div>
                <div class="progress-percentage">${percent}%</div>
            </div>
        `;
        
        helperTextElement.innerHTML = progressHTML;
    } else {
        // Regular text message without progress bar
        helperTextElement.innerHTML = currentText;
    }
    
    logDebug('Helper text updated:', currentText);
}

// Track the timeout for the result area notification
let resultNotificationTimeout = null;

// Track active toast notifications and their timeouts
let activeToastNotifications = [];

/**
 * Update the static notification in the result area
 * @param {string} text - The notification message
 * @param {boolean} visible - Whether to show the notification
 * @param {boolean} isError - Whether this is an error notification
 * @param {number} autoHideDelay - Milliseconds to wait before auto-hiding (0 for no auto-hide)
 */
export function updateNotification(text, visible = true, isError = false, autoHideDelay = 5000) {
    const notification = document.querySelector('.result-notification');
    if (!notification) return;
    
    // Clear any existing timeout
    if (resultNotificationTimeout) {
        clearTimeout(resultNotificationTimeout);
        resultNotificationTimeout = null;
    }
    
    notification.querySelector('span').innerHTML = text;
    notification.classList.toggle('visible', visible);
    notification.classList.toggle('error', isError);

    if (visible && text) { // Only send event if notification is shown and has text
        sendGAEvent('static_notification_shown', {
            event_category: GA_EVENT_CATEGORIES.UI_INTERACTION,
            event_label: 'Static Result Notification',
            notification_message: text.substring(0, 100), // Truncate long messages
            is_error: isError
        });
    }
    
    // Add close button if it doesn't already exist
    let closeButton = notification.querySelector('.notification-close');
    if (!closeButton && visible) {
        closeButton = document.createElement('div');
        closeButton.className = 'notification-close';
        closeButton.textContent = '×';
        
        // Apply styles
        applyStyles(closeButton, DESELECT_BUTTON_STYLES);
        
        // Position for notification context
        closeButton.style.top = '50%';
        closeButton.style.transform = 'translateY(-50%)';
        closeButton.style.right = '10px';
        
        // Add click handler to hide notification
        closeButton.addEventListener('click', function() {
            notification.classList.remove('visible');
        });
        
        notification.appendChild(closeButton);
    }
    
    // Remove close button if hiding notification
    if (!visible && closeButton) {
        closeButton.remove();
    }
    
    logDebug('Result notification updated:', text);
    
    // Static notifications no longer auto-hide
    // They remain visible until explicitly hidden or replaced by another notification
}

/**
 * Creates and shows a toast notification in the top right
 * @param {string} text - The notification message
 * @param {string} type - Notification type ('info', 'error', 'success', 'warning')
 * @param {Object} options - Additional options for the notification
 * @param {number} options.autoHideDelay - Milliseconds before auto-hiding (0 for no auto-hide)
 * @param {boolean} options.showSupport - Whether to show a support button (for errors only)
 * @param {Array} options.actions - Array of action buttons to add
 * @returns {Object} Reference to the created notification with its ID
 */
export function showToastNotification(text, type = 'info', options = {}) {
    const { 
        autoHideDelay = type === 'error' ? 8000 : 5000,
        showSupport = type === 'error',
        actions = []
    } = options;
    
    // Create container if it doesn't exist
    let container = document.getElementById('notificationsContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notificationsContainer';
        container.className = 'notifications-container';
        document.body.appendChild(container);
    }
    
    // Generate unique ID for this notification
    const notificationId = 'toast-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `toast-notification ${type}`;
    notification.id = notificationId;
    
    // Add appropriate icon based on type
    let iconSvg = '';
    if (type === 'error') {
        iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#ff4136" stroke-width="2" fill="none">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>`;
    } else if (type === 'success') {
        iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--primary-color)" stroke-width="2" fill="none">
            <path d="M20 6L9 17l-5-5"></path>
        </svg>`;
    } else if (type === 'warning') {
        iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--tertiary-color)" stroke-width="2" fill="none">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>`;
    } else {
        iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--secondary-color)" stroke-width="2" fill="none">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>`;
    }
    
    // Prepare actions HTML
    let actionsHtml = '';
    if (showSupport && type === 'error') {
        actionsHtml += `<button class="support-button" onclick="window.open('https://discord.gg/A29AUr7A6U', '_blank')">Get Support</button>`;
    }
    
    if (actions.length > 0) {
        actions.forEach(action => {
            actionsHtml += `<button class="notification-action">${action.text}</button>`;
        });
    }
    
    // Create the notification content
    notification.innerHTML = `
        <div class="notification-icon">${iconSvg}</div>
        <div class="notification-content">
            <div class="notification-message">${text}</div>
            ${actionsHtml ? `<div class="notification-actions">${actionsHtml}</div>` : ''}
        </div>
    `;
    
    // Create close button
    const closeButton = document.createElement('div');
    closeButton.className = 'notification-close';
    closeButton.textContent = '×';
    
    // Apply styles 
    applyStyles(closeButton, DESELECT_BUTTON_STYLES);
    
    // Add click handler to hide notification
    closeButton.addEventListener('click', () => removeToastNotification(notificationId));
    
    notification.appendChild(closeButton);
    
    // Add to container
    container.appendChild(notification);
    
    // Force reflow to trigger animation
    notification.offsetHeight;
    
    // Make visible with animation
    setTimeout(() => {
        notification.classList.add('visible');
    }, 10);
    
    // Add action event listeners if provided
    if (actions.length > 0) {
        const actionButtons = notification.querySelectorAll('.notification-action');
        actions.forEach((action, index) => {
            if (actionButtons[index] && action.callback) {
                actionButtons[index].addEventListener('click', () => {
                    action.callback();
                    // Optionally close the notification after action
                    if (action.closeOnClick !== false) {
                        removeToastNotification(notificationId);
                    }
                });
            }
        });
    }
    
    // Track this notification
    const notificationData = {
        id: notificationId,
        element: notification,
        timeout: null
    };
    
    activeToastNotifications.push(notificationData);
    
    // Set auto-hide timeout if needed
    if (autoHideDelay > 0) {
        notificationData.timeout = setTimeout(() => {
            removeToastNotification(notificationId);
        }, autoHideDelay);
    }

    sendGAEvent('toast_notification_shown', {
        event_category: GA_EVENT_CATEGORIES.UI_INTERACTION,
        event_label: 'Toast Notification',
        notification_type: type,
        notification_message: text.substring(0, 100), // Truncate long messages
        has_actions: actions.length > 0,
        has_support_button: showSupport && type === 'error'
    });
    
    logDebug('Toast notification shown:', { text, type });
    
    // Return notification reference for potential future manipulation
    return notificationData;
}

/**
 * Removes a specific toast notification by ID
 * @param {string} notificationId - The ID of the notification to remove
 */
function removeToastNotification(notificationId) {
    const index = activeToastNotifications.findIndex(n => n.id === notificationId);
    if (index !== -1) {
        const notification = activeToastNotifications[index];
        
        // Clear timeout if it exists
        if (notification.timeout) {
            clearTimeout(notification.timeout);
        }
        
        // Animate out
        notification.element.classList.remove('visible');
        
        // Remove after animation completes
        setTimeout(() => {
            if (notification.element.parentNode) {
                notification.element.parentNode.removeChild(notification.element);
            }
            
            // Remove from tracking array
            activeToastNotifications.splice(index, 1);
        }, 300); // Match transition duration
        
        logDebug('Toast notification removed:', notificationId);
    }
}

/**
 * Show an error toast notification with longer timeout and support button
 * @param {string} errorMessage - The error message to display
 * @param {Object} options - Additional options for the notification
 */
export function showErrorNotification(errorMessage, options = {}) {
    showToastNotification(errorMessage, 'error', {
        autoHideDelay: 8000,
        showSupport: true,
        ...options
    });
    logDebug('Error notification shown:', errorMessage);
}

/**
 * Test function to show all notification types for demonstration purposes
 * Used for debugging and previewing notification styles
 */
export function showNotificationExamples() {
    showToastNotification('This is an info notification', 'info');
    
    setTimeout(() => {
        showToastNotification('This is a success notification', 'success');
    }, 1000);
    
    setTimeout(() => {
        showToastNotification('This is a warning notification', 'warning');
    }, 2000);
    
    setTimeout(() => {
        showErrorNotification('This is an error notification with support');
    }, 3000);
    
    setTimeout(() => {
        updateNotification('This is a static result area notification');
    }, 4000);
}

/**
 * Show actionable error UI with Details (generationID + Copy) and Suggestions
 * @param {string} code
 * @param {string|null} generationID
 */
export function showActionableError(code, generationID) {
    // Build suggestions by code (non-invasive tips)
    const suggestions = [];
    if (code === 'timeout_error') {
        suggestions.push('Reduce video length/resolution/FPS and try again');
        suggestions.push('Keep the tab open while generating');
    } else if (code === 'websocket_error') {
        suggestions.push('Reload the page to re-establish connection');
        suggestions.push('Check your internet connection or VPN');
    } else if (code === 'comfy_error') {
        suggestions.push('Try a different style or lower settings');
        suggestions.push('Try again with default options first');
    } else if (code === 'upload_error') {
        suggestions.push('Retry the upload and confirm file size limits');
        suggestions.push('Prefer MP4/H.264 and smaller resolutions for previews');
    } else {
        suggestions.push('Retry with simpler settings');
        suggestions.push('Contact support if it repeats');
    }

    // Toast with Details action (copy genID)
    const actions = [];
    if (generationID) {
        actions.push({
            text: 'Copy Generation ID',
            callback: () => {
                try {
                    navigator.clipboard.writeText(generationID);
                    showToastNotification('Generation ID copied', 'success', { autoHideDelay: 2500, showSupport: false });
                } catch (e) {
                    showToastNotification(`Generation ID: ${generationID}`, 'info', { autoHideDelay: 6000, showSupport: false });
                }
            }
        });
    }
    actions.push({
        text: 'Get Support',
        callback: () => window.open('https://discord.gg/A29AUr7A6U', '_blank'),
        closeOnClick: false
    });

    showToastNotification(
        generationID ? `Error (${code}). Details available.` : `Error (${code}).`,
        'error',
        { autoHideDelay: 0, showSupport: false, actions }
    );

    // Banner with suggestions list (concise)
    const tips = `Suggestions: ${suggestions.join(' • ')}`;
    updateNotification(tips, true, true, 0);
}

// Update button text
export function updateButtonText(button, type, state) {
    if (!button || !MESSAGES.BUTTON[type]) return;
    
    button.textContent = MESSAGES.BUTTON[type][state];
    logDebug(`Button text updated: ${type}.${state}`);
}

// Generation status updates - simplified for direct node events
export function updateGenerationStatus(isLast = false) {
    if (isLast) {
        // Final phase
        state.setCurrentHelperText(MESSAGES.HELPER.GENERATION.FINALIZING);
    } else {
        // Reset to initial state
        state.setGenerationPhase(0);
        state.setCurrentHelperText(MESSAGES.HELPER.GENERATION.INITIALIZING);
    }
    updateHelperTextDisplay();
}

// Initialize helper text subscription to node events
export function initializeHelperTracking() {
    // Track the last node we saw to avoid duplicate updates
    let lastNodeSeen = null;
    let messageIndex = 0;
    
    // Subscribe to progress events
    return state.addProgressListener(event => {
        // Handle reset event 
        if (event.type === 'reset') {
            lastNodeSeen = null;
            messageIndex = 0;
            return;
        }
        
        const { nodeId, currentNode } = event;
        
        // Only update text if this is the active node and different from the last one
        if (nodeId === currentNode && nodeId !== lastNodeSeen) {
            lastNodeSeen = nodeId;
            
            // Get the current mode
            const currentMode = state.getCurrentMode();
            const modeName = currentMode?.title?.toLowerCase() || 'default';
            const modeMap = NODE_MESSAGE_MAP[modeName] || NODE_MESSAGE_MAP.default;
            
            // If node has a specific message, use it
            if (modeMap[nodeId]) {
                state.setCurrentHelperText(modeMap[nodeId]);
                updateHelperTextDisplay();
            } 
            // Otherwise, just use the next message in sequence
            else if (messageIndex < MESSAGES.HELPER.GENERATION.PHASES.length) {
                state.setCurrentHelperText(MESSAGES.HELPER.GENERATION.PHASES[messageIndex]);
                messageIndex = (messageIndex + 1) % MESSAGES.HELPER.GENERATION.PHASES.length;
                updateHelperTextDisplay();
            }
        }
    });
}

/**
 * Highlights an element for a specified duration.
 * @param {string} elementId - The ID of the element to highlight.
 * @param {number} duration - The duration of the highlight in milliseconds.
 */
export function highlightElement(elementId, duration = 3000) {
    const element = document.getElementById(elementId);
    if (element) {
        const container = element.closest('.advanced-setting') || element;
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
        container.classList.add('highlight-glow');
        setTimeout(() => {
            container.classList.remove('highlight-glow');
        }, duration);
    }
}

/**
 * Update the label of a toggle element based on its checked state
 * @param {HTMLElement} toggleElement - The toggle element (checkbox)
 */
export function updateToggleLabel(toggleElement) {
    const label = toggleElement.parentElement.nextElementSibling;
    if (label) {
        label.textContent = toggleElement.checked ? 'On' : 'Off';
        logDebug('Toggle label updated:', toggleElement.id);
    }
}

/**
 * Toggle the visibility of a hint element
 * @param {Event} event - The click event from the hint icon
 */
export function toggleHint(event) {
    const advancedSetting = event.target.closest('.advanced-setting');
    const hintElement = advancedSetting.querySelector('.setting-hint');
    if (hintElement) {
        if (!advancedSetting.dataset.hintInitialized) {
            hintElement.style.display = 'none';
            advancedSetting.dataset.hintInitialized = 'true';
        }
        const isNowVisible = hintElement.style.display === 'none';
        hintElement.style.display = isNowVisible ? 'block' : 'none';
        
        const hintLabelElement = advancedSetting.querySelector('.advanced-setting-label');
        // Attempt to get a more specific label, fallback to a generic one
        let hintTopic = 'Unknown Hint';
        if (hintLabelElement) {
            // Clean up the text content to get a more usable label
            const labelText = hintLabelElement.cloneNode(true); // Clone to avoid modifying original
            const hintIconInLabel = labelText.querySelector('.hint-icon');
            if (hintIconInLabel) hintIconInLabel.remove(); // Remove the icon itself from the label
            hintTopic = labelText.textContent?.trim().replace(/\s\s+/g, ' ') || 'Unnamed Hint';
        }


        sendGAEvent('hint_toggled', {
            event_category: GA_EVENT_CATEGORIES.UI_INTERACTION,
            event_label: 'Hint System',
            hint_topic: hintTopic.substring(0, 100),
            hint_status: isNowVisible ? 'shown' : 'hidden'
        });
        logDebug('Hint toggled:', hintTopic, isNowVisible ? 'shown' : 'hidden');
    }
}

/**
 * Initialize hint system for advanced settings
 */
export function initializeHintSystem() {
    // Bind hint toggle to all hint icons
    document.querySelectorAll('.hint-icon').forEach(icon => {
        icon.addEventListener('click', toggleHint);
    });

    // Initialize hint states (hidden by default)
    document.querySelectorAll('.advanced-setting').forEach(setting => {
        const hintElement = setting.querySelector('.setting-hint');
        if (hintElement) {
            hintElement.style.display = 'none';
        }
    });
    
    logDebug('Hint system initialized');
}

/**
 * Initialize advanced dropdown functionality
 */
export function initializeAdvancedDropdown() {
    const dropdown = document.querySelector('.advanced-dropdown');
    if (!dropdown) {
        logDebug('Advanced dropdown not found');
        return;
    }
    
    const header = dropdown.querySelector('.advanced-dropdown-header');
    if (!header) {
        logDebug('Advanced dropdown header not found');
        return;
    }
    
    // Set initial state (collapsed)
    dropdown.classList.remove('expanded');
    
    // Add click event listener to toggle the dropdown
    header.addEventListener('click', () => {
        const isNowExpanded = !dropdown.classList.contains('expanded');
        dropdown.classList.toggle('expanded');
        
        const dropdownLabelElement = header.querySelector('.advanced-dropdown-title');
        const dropdownLabel = dropdownLabelElement?.textContent?.trim() || 'Unknown Dropdown';

        sendGAEvent('advanced_dropdown_toggled', {
            event_category: GA_EVENT_CATEGORIES.UI_INTERACTION,
            event_label: 'Advanced Settings Interaction',
            dropdown_name: dropdownLabel.substring(0,100),
            dropdown_status: isNowExpanded ? 'expanded' : 'collapsed'
        });
        logDebug('Advanced dropdown toggled:', dropdownLabel, isNowExpanded ? 'expanded' : 'collapsed');
    });
    
    logDebug('Advanced dropdown initialized');
}

// Export functions that other modules need
export {
    updateHelperTextDisplay,
    getHelperText
};

// More options text cycling
export function initializeMoreOptions(button) {
    setMaxWidth(button);
    startNewCycle();
    changeMoreOptionsText();
    return setInterval(changeMoreOptionsText, 3000);
}

function startNewCycle() {
    currentCycle = ["More Options", ...MESSAGES.BUTTON.MORE_OPTIONS.slice(1)];
    shuffleArray(currentCycle.slice(1));
    shownPhrases.clear();
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function setMaxWidth(button) {
    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    
    // Copy button's font properties for accurate width calculation
    const buttonStyle = window.getComputedStyle(button);
    tempSpan.style.fontFamily = buttonStyle.fontFamily;
    tempSpan.style.fontSize = buttonStyle.fontSize;
    tempSpan.style.fontWeight = buttonStyle.fontWeight;
    
    document.body.appendChild(tempSpan);

    let maxWidth = 0;
    MESSAGES.BUTTON.MORE_OPTIONS.forEach(text => {
        tempSpan.textContent = text;
        const width = tempSpan.offsetWidth;
        if (width > maxWidth) {
            maxWidth = width;
        }
    });

    document.body.removeChild(tempSpan);
    
    // Add more padding (60px instead of 40px) and set both width and minWidth
    const finalWidth = `${maxWidth + 60}px`;
    button.style.width = finalWidth;
    button.style.minWidth = finalWidth;
    
    // Apply the same properties to the text element
    const textElement = document.getElementById('moreOptionsText');
    if (textElement) {
        textElement.style.whiteSpace = 'nowrap';
        textElement.style.overflow = 'hidden';
        textElement.style.textOverflow = 'ellipsis';
    }
}

function changeMoreOptionsText() {
    const moreOptionsElement = document.getElementById('moreOptionsText');
    moreOptionsElement.style.opacity = '0';
    
    setTimeout(() => {
        let nextPhrase;
        if (shownPhrases.size === 0) {
            nextPhrase = "More Options";
        } else if (shownPhrases.size === MESSAGES.BUTTON.MORE_OPTIONS.length - 1) {
            startNewCycle();
            nextPhrase = "More Options";
        } else {
            do {
                nextPhrase = currentCycle[Math.floor(Math.random() * currentCycle.length)];
            } while (shownPhrases.has(nextPhrase) || nextPhrase === "More Options");
        }
        
        moreOptionsElement.textContent = nextPhrase;
        moreOptionsElement.style.opacity = '1';
        shownPhrases.add(nextPhrase);
    }, 1500);
}
