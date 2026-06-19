// Import dependencies
import { createLogger } from '../utils/logger.js';

const logDebug = createLogger('Theme');

// Theme storage key
const STORAGE_KEY = 'theme-preference';

// Theme state
const theme = {
    value: getColorPreference()
};

// Initialize theme system
export function initializeTheme() {
    // Set early so no page flashes / CSS is made aware
    reflectPreference();
    
    // Set up theme toggle
    const themeToggle = document.querySelector('#theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', onClick);
    }
    
    // Sync with system changes
    window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', ({matches:isDark}) => {
            theme.value = isDark ? 'dark' : 'light';
            setPreference();
        });
    
    logDebug('Theme system initialized');
}

// Get stored or system preference
export function getColorPreference() {
    if (localStorage.getItem(STORAGE_KEY)) {
        return localStorage.getItem(STORAGE_KEY);
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

// Handle theme toggle click
function onClick() {
    // Flip current value
    theme.value = theme.value === 'light' ? 'dark' : 'light';
    setPreference();
    logDebug('Theme toggled:', theme.value);
}

// Save and apply preference
function setPreference() {
    localStorage.setItem(STORAGE_KEY, theme.value);
    reflectPreference();
}

// Apply theme to document
function reflectPreference() {
    document.firstElementChild.setAttribute('data-theme', theme.value);
    document.querySelector('#theme-toggle')?.setAttribute('aria-label', theme.value);
    logDebug('Theme applied:', theme.value);
}


