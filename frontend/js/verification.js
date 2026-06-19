import { setSession } from "./session.js";
import { showToastNotification } from "./ui/helpers.js";
import { sendGAEvent, GA_EVENT_CATEGORIES } from './analytics.js';
import { DEBUG_MODE } from './config/index.js';

/**
 * Handle verification of magic links
 * This script runs automatically when the page loads to check for tokens in the URL
 */
// Flag to track verification in progress
let isVerifying = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Check if this verification has already been processed to avoid double processing
  if (localStorage.getItem('verification_processed')) {
    const timestamp = parseInt(localStorage.getItem('verification_processed'));
    // Only consider it processed if it happened in the last minute
    if (Date.now() - timestamp < 60000) {
      return;
    }
    localStorage.removeItem('verification_processed');
  }

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  
  if (token && !isVerifying) {
    isVerifying = true;
    sendGAEvent('magic_link_verification_attempt', {
        event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
        event_label: 'Magic Link Verification',
        token_present_in_url: true
    });
    // Show loading notification
    showToastNotification("Verifying your login...", "info");
    
    try {
      const response = await fetch(`${window.APP_CONFIG.BACKEND_URL}/api/auth/verify-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "verify-token" })
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Set session
        setSession(result);

        const userIdForProp = result.user?.id || result.userId || result.user_id || null;
        const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        sendGAEvent('magic_link_verification_successful', {
            event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
            event_label: 'Magic Link Verification',
            user_id: userIdForProp || 'unknown', // For the event param
            settings_restored: !!(result.settingsId && localStorage.getItem(`vidia_settings_${result.settingsId}`))
        });

        if (typeof gtag === 'function') {
            gtag('set', 'user_properties', { 
                'last_login_date': currentDate 
            });
            if (DEBUG_MODE) {
                console.log('[Verification - UserProp] Set last_login_date:', currentDate);
            }
            // Assuming backend sends 'isNewUser: true' for new accounts via magic link
            if (result.isNewUser === true) { 
                gtag('set', 'user_properties', { 
                    'account_creation_date': currentDate,
                    // Potentially set other initial user properties here
                });
                if (DEBUG_MODE) {
                    console.log('[Verification - UserProp] Set account_creation_date for new user:', currentDate);
                }
            }
        }
        
        // Show success notification
        showToastNotification("Successfully signed in!", "success");
        
        // Restore generation if settingsId exists
        if (result.settingsId) {
          const savedSettings = localStorage.getItem(`vidia_settings_${result.settingsId}`);
          if (savedSettings) {
            try {
              // Parse saved settings
              const settings = JSON.parse(savedSettings);
              
              // Automatically continue generation with saved settings
              const { handleGeneration } = await import('./features/generation/index.js');
              
              // Wait a moment to ensure everything is loaded
              setTimeout(() => {
                // Restart the generation process with saved settings
                handleGeneration(settings.type, {
                  workflow: settings.workflow,
                  cost: settings.cost,
                  clientId: settings.clientId
                });
                
                showToastNotification("Continuing your video generation...", "success");
              }, 1000);
              
              // Clean up
              localStorage.removeItem(`vidia_settings_${result.settingsId}`);
            } catch (error) {
              console.error("Error restoring generation:", error);
              showToastNotification("Could not continue generation automatically", "error");
            }
          }
        }
        
        // Get the current URL parameters
        const currentParams = new URLSearchParams(window.location.search);
        const currentMode = currentParams.get('mode') || result.mode || 'trace';
        
        // Mark this verification as processed to prevent loops
        localStorage.setItem('verification_processed', Date.now().toString());
        
        // Save mode to localStorage as a backup
        localStorage.setItem('vidia_mode', currentMode);
        
        // Use window.location.replace to avoid adding to browser history
        // and prevent potential redirect chains that might strip parameters
        if (window.location.pathname.includes('dashboard')) {
          // Already on dashboard, reload the page to apply the mode
          // Use replace to avoid adding a new history entry
          window.location.replace(`/dashboard.html?mode=${currentMode}`);
          
          // Fallback - if the page doesn't redirect in 500ms, reload
          setTimeout(() => {
            // Check if the mode is in the URL
            if (!window.location.search.includes('mode=')) {
              console.log('Forcing reload to ensure mode parameter is present');
              window.location.replace(`/dashboard.html?mode=${currentMode}`);
            }
          }, 500);
        } else {
          // On another page, redirect to dashboard with appropriate mode
          window.location.replace(`/dashboard.html?mode=${currentMode}`);
        }
      } else {
        showToastNotification(result.message || "Invalid or expired link", "error");
        // Remove token from URL, preserve other parameters
        currentParams.delete('token');
        history.replaceState(null, '', `${window.location.pathname}?${currentParams.toString()}`);
        sendGAEvent('magic_link_verification_failed', {
            event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
            event_label: 'Magic Link Verification',
            failure_reason: result.message || 'Invalid or expired link (server)',
            status_code: response.status
        });
      }
    } catch (error) {
      console.error("Error verifying token:", error);
      showToastNotification("Failed to verify login link", "error");
      sendGAEvent('magic_link_verification_failed', {
        event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
        event_label: 'Magic Link Verification',
        failure_reason: 'Network or client-side error during verification',
        error_message: error.message
      });
      
      // Remove token from URL, preserve other parameters
      const params = new URLSearchParams(window.location.search);
      params.delete('token');
      history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    }
  }
});
