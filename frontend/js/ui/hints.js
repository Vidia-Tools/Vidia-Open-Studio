// Import dependencies
import { createLogger } from '../utils/logger.js';

const logDebug = createLogger('Hints');

// Initialize all hints as hidden
export function initializeHints() {
    document.querySelectorAll('.advanced-setting').forEach(setting => {
        const hintElement = setting.querySelector('.setting-hint');
        if (hintElement) {
            hintElement.style.display = 'none';
            setting.dataset.hintInitialized = 'true';
        }
    });
    
    logDebug('Hints initialized');
}

// Toggle hint visibility
export function toggleHint(event) {
    const advancedSetting = event.target.closest('.advanced-setting');
    const hintElement = advancedSetting.querySelector('.setting-hint');
    if (hintElement) {
        // Check computed style instead of just inline style
        const currentDisplay = window.getComputedStyle(hintElement).display;
        hintElement.style.display = currentDisplay === 'none' ? 'block' : 'none';
        logDebug(`Hint toggled: ${hintElement.style.display}`);
    }
}


