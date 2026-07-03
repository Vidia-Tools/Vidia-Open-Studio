// Import the global config (sets window.APP_CONFIG) before anything that reads it.
import './config.js';
// Import VidiaApp class
import { VidiaApp } from './core/app.js';

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new VidiaApp();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        document.getElementById('helperText').innerHTML = 'Error: Failed to initialize app. Please refresh the page and try again.';
    }
});
