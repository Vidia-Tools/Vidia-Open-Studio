// Front/Vidia_App/js/analytics.js

import { DEBUG_MODE } from './config/index.js';
import { getSession } from './session.js';
import { getCurrentMode } from './core/state.js';

const GA_MEASUREMENT_ID = import.meta.env?.VITE_GA_MEASUREMENT_ID || '';

/**
 * Loads gtag.js and configures GA4. No-op when VITE_GA_MEASUREMENT_ID is unset,
 * so forks without a GA property send no analytics.
 */
export function initAnalytics() {
    if (!GA_MEASUREMENT_ID) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID);
}

export const GA_EVENT_CATEGORIES = Object.freeze({
    USER_LIFECYCLE: 'User Lifecycle',
    CORE_FEATURE: 'Core Feature Interaction',
    UI_INTERACTION: 'UI Interaction',
    GENERATION_FUNNEL: 'Generation Funnel',
    TUTORIAL: 'Tutorial Onboarding',
    ERROR_TRACKING: 'Error Tracking',
    NAVIGATION: 'Navigation',
    ENGAGEMENT: 'Engagement',
    FILE_MANAGEMENT: 'File Management',
    SETTINGS_CONFIGURATION: 'Settings Configuration'
});

/**
 * Sends an event to Google Analytics 4.
 * Automatically enriches event parameters with common data.
 *
 * @param {string} eventName - The name of the event (e.g., 'login_successful', 'file_upload_started').
 * @param {Object} eventParams - Custom parameters for the event.
 *                               It's recommended to include 'event_category'.
 *                               'event_label' can also be useful for further classification.
 */
export function sendGAEvent(eventName, eventParams = {}) {
    if (typeof gtag !== 'function') {
        if (DEBUG_MODE) {
            console.warn('[Analytics] gtag function not found. Event not sent:', eventName, eventParams);
        }
        return;
    }

    const session = getSession();
    // Attempt to get user ID from common session structures
    const userId = session?.user?.id || session?.userId || session?.user_id || null;

    const mode = getCurrentMode();
    const appMode = mode?.title?.toLowerCase() || 'unknown';

    const enrichedParams = {
        // user_id: userId, // GA4 uses user_id set via config. If needed for specific event parameter, uncomment.
        app_mode: appMode,
        event_timestamp: new Date().toISOString(), // GA4 collects timestamps, but can be useful for custom analysis
        ...eventParams,
    };

    // Ensure critical parameters like user_id are correctly associated if not automatically handled by gtag config
    // For GA4, user_id is typically set once via gtag('config', 'GA_MEASUREMENT_ID', {'user_id': 'USER_ID'});
    // and then automatically associated with all subsequent events for that user.
    // If your session management sets this up, direct inclusion in every event might be redundant for user_id.
    // However, including it here ensures it's available if that global config isn't set or for specific needs.
    if (userId) {
        enrichedParams.user_identifier = userId; // Using a custom parameter name to avoid conflict if GA's user_id is set differently
    }


    // Remove null/undefined values from params
    for (const key in enrichedParams) {
        if (enrichedParams[key] === null || enrichedParams[key] === undefined) {
            delete enrichedParams[key];
        }
    }

    if (DEBUG_MODE) {
        console.log(`[Analytics] Sending GA Event: "${eventName}"`, enrichedParams);
    }

    try {
        gtag('event', eventName, enrichedParams);
    } catch (error) {
        if (DEBUG_MODE) {
            console.error('[Analytics] Error sending GA event:', {
                eventNameSent: eventName,
                paramsSent: enrichedParams,
                errorDetails: error
            });
        }
    }
}
