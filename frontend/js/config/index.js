// First, import all configurations
import { MODE } from './modes.js';
import { 
    API_ENDPOINT, DEBUG_MODE, DEV_MODE, RUNPOD_MODE,
    isDebugMode, setDebugMode,
    EXECUTED_FALLBACK_ENABLED, FALLBACK_T1_MS, STALL_T2_MS, RESTART_WORKER_ENABLED
} from './constants.js';
import { 
    PROGRESS_CONFIG, 
    GENERATION_MESSAGES, 
    NOTIFICATIONS 
} from './progress.js';

// Re-export all configurations
export { API_ENDPOINT, DEBUG_MODE, DEV_MODE, RUNPOD_MODE, EXECUTED_FALLBACK_ENABLED, FALLBACK_T1_MS, STALL_T2_MS, RESTART_WORKER_ENABLED };
export { isDebugMode, setDebugMode }; // Export debug mode functions
export { MODE };
export { 
    PROGRESS_CONFIG, 
    GENERATION_MESSAGES, 
    NOTIFICATIONS 
};

// Helper functions
export function isFeatureEnabled(featureName, mode) {
    return MODE[mode]?.features[featureName] || false;
}

export function getStyleDropdownBehavior(mode) {
    return MODE[mode]?.features.styleDropdown || {
        affectsModel: false,
        affectsPrompt: false
    };
}

export function getNotification(key) {
    return NOTIFICATIONS[key] || NOTIFICATIONS.error;
}

// Simple debug logging helper
export function logDebug(message, data) {
    if (isDebugMode()) {
        if (data) {
            console.log(message, data);
        } else {
            console.log(message);
        }
    }
}
