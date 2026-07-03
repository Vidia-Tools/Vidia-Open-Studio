// Open Studio: the graph NODE-id map is retired. Stages are described by the
// pipeline manifest and controls/ JSON; the browser never references node IDs.
// (Was: js/config/constants.js NODE map -- REWRITE per modularization plan s7.)

// API and environment settings.
// VITE_API_BASE selects the backend (hosted) or local app_server URL at build
// time. URLs only, never keys (plan 8.1). Local mode points this at the
// localhost app_server target, e.g. http://127.0.0.1:8000 (worker/app_server.py).
export const API_BASE = import.meta.env?.VITE_API_BASE || '';
// DEV_MODE talks straight to a local ComfyUI /prompt endpoint (legacy dev path).
export const DEV_MODE = (import.meta.env?.VITE_DEV_MODE === 'true');
// RUNPOD_MODE = hosted backend relay vs local app_server. Default hosted.
export const RUNPOD_MODE = (import.meta.env?.VITE_RUNPOD_MODE ?? 'true') !== 'false';
export const API_ENDPOINT = DEV_MODE
    ? 'http://localhost:8188'
    : (API_BASE || `${window.location.protocol}//${window.location.host}`);

// Dynamic debug mode - check if admin or if explicitly enabled
const DEBUG_STORAGE_KEY = 'vidia_debug_mode';

// Exported as let so ES module live bindings update when debug mode changes.
// All code that modifies debug state MUST reassign DEBUG_MODE directly.
export let DEBUG_MODE = false;

// Initialize debug mode based on local storage and admin status
function initDebugMode() {
    try {
        // Check if debug mode is explicitly set in localStorage
        const storedDebugMode = localStorage.getItem(DEBUG_STORAGE_KEY);
        if (storedDebugMode === 'true') {
            DEBUG_MODE = true;
            console.log('Debug mode enabled via localStorage');
            return;
        }
        
        // Check if user is admin
        const sessionData = localStorage.getItem('vidiaUserSession');
        if (sessionData) {
            const session = JSON.parse(sessionData);
            if (session && session.user && session.user.email === (import.meta.env?.VITE_ADMIN_EMAIL || '')) {
                DEBUG_MODE = true;
                console.log('Debug mode automatically enabled for admin user');
                return;
            }
        }
        
        DEBUG_MODE = false;
    } catch (e) {
        console.error('Error initializing debug mode:', e);
        DEBUG_MODE = false;
    }
}

// Run initialization immediately
initDebugMode();

// Listen for auth state changes to update debug mode
document.addEventListener('authStateChanged', (event) => {
    initDebugMode();
});

// Getter for DEBUG_MODE to ensure it's always current
export function isDebugMode() {
    return DEBUG_MODE;
}

// Function to toggle debug mode (for admin panel)
export function setDebugMode(enabled) {
    localStorage.setItem(DEBUG_STORAGE_KEY, enabled ? 'true' : 'false');
    DEBUG_MODE = enabled;
    console.log(`Debug mode ${enabled ? 'enabled' : 'disabled'} manually`);
    return DEBUG_MODE;
}

// Frontend runtime flags and thresholds
export const EXECUTED_FALLBACK_ENABLED = true;      // Allow executed-with-URL fallback (guarded) in RUNPOD_MODE
export const FALLBACK_T1_MS = 120000;               // Wait 120s for videoReady before considering fallback
export const STALL_T2_MS = 600000;                  // 10 minutes without progress => consider worker restart
export const RESTART_WORKER_ENABLED = false;        // Disabled for v1: no real secured RunPod restart implementation exists yet. Re-enable only after a secured, rate-limited, authenticated restart path is built.
