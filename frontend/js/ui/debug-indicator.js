/**
 * Global debug indicator module
 * Provides a visual indicator when debug mode is active
 */
import { isDebugMode } from '../config/index.js';

const DEBUG_INDICATOR_ID = 'globalDebugIndicator';

/**
 * Initialize the debug indicator
 * Should be called on page load
 */
export function initializeDebugIndicator() {
    // Check if debug mode is active
    const debugEnabled = isDebugMode();

    // Update UI based on debug state
    updateDebugIndicator(debugEnabled);
    
    // Log debug mode status - this will only show if debug is on
    console.log(`Debug mode: ${debugEnabled ? 'ENABLED' : 'disabled'}`);
    
    // Set up event listener for localStorage changes (for cross-tab sync)
    window.addEventListener('storage', (event) => {
        if (event.key === 'vidia_debug_mode') {
            const newState = event.newValue === 'true';
            updateDebugIndicator(newState);
        }
    });
    
    // Return controller methods
    return {
        update: updateDebugIndicator,
        isDebugActive: isDebugMode
    };
}

/**
 * Update the debug indicator based on debug mode state
 * @param {boolean} isActive - Whether debug mode is active
 */
function updateDebugIndicator(isActive) {
    // Remove existing indicator if any
    const existingIndicator = document.getElementById(DEBUG_INDICATOR_ID);
    if (existingIndicator) {
        existingIndicator.remove();
    }
    
    // If debug is active, create indicator
    if (isActive) {
        const indicator = document.createElement('div');
        indicator.id = DEBUG_INDICATOR_ID;
        indicator.style.position = 'fixed';
        indicator.style.bottom = '10px';
        indicator.style.right = '10px';
        indicator.style.backgroundColor = '#dc3545';
        indicator.style.color = 'white';
        indicator.style.padding = '5px 10px';
        indicator.style.borderRadius = '4px';
        indicator.style.fontSize = '12px';
        indicator.style.fontWeight = 'bold';
        indicator.style.zIndex = '9999';
        indicator.style.opacity = '0.8';
        indicator.textContent = 'DEBUG MODE';
        
        // Add click handler to hide (just visual convenience)
        indicator.style.cursor = 'pointer';
        indicator.title = 'Click to hide this indicator (debug mode will remain active)';
        indicator.addEventListener('click', () => {
            indicator.style.display = 'none';
        });
        
        document.body.appendChild(indicator);
    }
}
