// Import dependencies
import { DEBUG_MODE } from '../config/index.js';

// Initialize debug UI
export function initializeDebugUI() {
    const debugSection = document.getElementById('debug');
    if (debugSection) {
        debugSection.style.display = DEBUG_MODE ? 'block' : 'none';
    }
    logDebug('Debug UI initialized');
}

// Debug logging
function logDebug(message, data) {
    if (DEBUG_MODE) {
        if (data !== undefined) {
            console.log(`[Debug UI] ${message}`, data);
        } else {
            console.log(`[Debug UI] ${message}`);
        }
    }
}
