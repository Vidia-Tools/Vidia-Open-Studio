import {setSession} from "../session.js";
import {showToastNotification} from "../ui/helpers.js";
import { createLogger } from '../utils/logger.js';
import * as modesCfg from "../config/modes.js";
import { sendGAEvent, GA_EVENT_CATEGORIES } from '../analytics.js';

const logDebug = createLogger('Auth');

// Turnstile state management
let widgetId = null;
let tokenPromise = null;
let lastToken = null;
let lastTokenAt = 0;
let isExecuting = false;
let isSubmitting = false;

/**
 * Load Turnstile script if not already loaded
 * @returns {Promise} A promise that resolves when Turnstile is loaded
 */
function loadTurnstile() {
  if (document.querySelector('script[src*="turnstile"]')) {
    return Promise.resolve();
  }
  
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

/**
 * Open signup modal with optional settingsId for magic link flow
 * @param {string} settingsId - ID for restoring settings after verification
 */
export async function openSignupModal(settingsId = null) {
  const response = await fetch("/signup-modal.html");
  const modalContent = await response.text();
  
  const modalElement = document.getElementById("signupModal");
  modalElement.innerHTML = modalContent;
  modalElement.style.display = "block";

  sendGAEvent('magic_link_modal_opened', {
    event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
    event_label: 'Magic Link Modal Interaction',
    trigger_context: settingsId ? 'in_app_generation_flow' : 'auth_button_click' // Example context
  });
  
  // Store settingsId if provided
  if (settingsId) {
    modalElement.dataset.settingsId = settingsId;
  }

  // Initialize turnstile
  let turnstileInitialized = await initializeTurnstile();
  if (!turnstileInitialized) {
    sendGAEvent('turnstile_challenge_failed', {
        event_category: GA_EVENT_CATEGORIES.ERROR_TRACKING,
        event_label: 'Security Challenge Failure',
        failure_point: 'initialization_in_modal'
    });
    showToastNotification("Could not verify security challenge. Please turn off ad blockers and try again.", "error");
    return;
  }

  // Initialize the signup modal for magic link flow
  initializeSignupModal();
}

export function closeSignupModal() {
  document.getElementById("signupModal").style.display = "none";
}

/**
 * Ensure Turnstile widget is rendered and ready
 * @returns {Promise<boolean>} True if widget is ready, false on failure
 */
async function ensureTurnstileWidget() {
  // If widget already exists, just reset it
  if (widgetId !== null && window.turnstile) {
    try {
      window.turnstile.reset(widgetId);
      logDebug('Turnstile widget reset for reuse');
      return true;
    } catch (error) {
      logDebug('Error resetting Turnstile widget, will re-render', error);
      widgetId = null;
    }
  }
  
  // Create or find container
  let turnstileContainer = document.getElementById('turnstile-container');
  if (!turnstileContainer) {
    turnstileContainer = document.createElement('div');
    turnstileContainer.id = 'turnstile-container';
    turnstileContainer.style.display = 'none';
    document.getElementById('step1').appendChild(turnstileContainer);
  }

  try {
    await loadTurnstile();

    if (!window.turnstile) {
      logDebug('Turnstile not available after loading');
      return false;
    }

    // Render widget once and store ID
    widgetId = window.turnstile.render(turnstileContainer, {
      sitekey: window.APP_CONFIG.TURNSTILE_SITE_KEY_LOGIN,
      theme: 'light',
      size: 'invisible',
      'error-callback': function (error) {
        logDebug('Turnstile error callback triggered', error);
        // Clear any pending promises on error
        if (tokenPromise) {
          tokenPromise = null;
        }
        isExecuting = false;
      },
      'expired-callback': function () {
        logDebug('Turnstile token expired');
        // Clear cached token
        lastToken = null;
        lastTokenAt = 0;
      }
    });

    logDebug('Turnstile widget rendered with ID:', widgetId);
    return true;

  } catch (err) {
    logDebug('Error initializing Turnstile widget', err);
    return false;
  }
}

/**
 * Initialize turnstile (wrapper for compatibility)
 */
async function initializeTurnstile() {
  return await ensureTurnstileWidget();
}

/**
 * Initialize signup modal for magic link flow
 */
function initializeSignupModal() {
  console.log("Initializing signup modal");
  // Add event listener for the close button
  const closeButton = document.querySelector(".close");
  if (closeButton) {
    closeButton.addEventListener("click", closeSignupModal);
  }

  // Update step 2 for magic link confirmation
  const step2 = document.getElementById('step2');
  if (step2) {
    // Clear existing content and add magic link message
    step2.innerHTML = `
      <p>Check your inbox: We've sent a magic link to continue.</p>
      <p>Click the link in your email to sign in and view your video.</p>
      <p class="note" style="font-size: 0.9rem; color: #666; margin-top: 20px;">This link will expire in 30 minutes and can only be used once.</p>
    `;
  }

  // Add event listener for the next button to handle magic link
  const nextButton = document.getElementById("nextButton");
  if (nextButton) {
    nextButton.removeEventListener('click', handleNextButton);
    nextButton.addEventListener("click", handleMagicLinkRequest);
  }
}

/**
 * Get a Turnstile token with proper lifecycle management and concurrency control
 * @returns {Promise<string>} Turnstile token
 * @throws {Error} If token generation fails
 */
async function getTurnstileToken() {
  const now = Date.now();
  
  // Return fresh cached token if still valid (< 90 seconds old)
  if (lastToken && (now - lastTokenAt) < 90000) {
    logDebug('Using cached Turnstile token');
    return lastToken;
  }
  
  // If there's already a token promise in progress, wait for it
  if (tokenPromise) {
    logDebug('Waiting for existing token promise');
    return tokenPromise;
  }
  
  // Ensure widget is ready
  if (!window.turnstile || widgetId === null) {
    throw new Error('Turnstile widget not ready');
  }
  
  // Create new token promise to coalesce concurrent calls
  tokenPromise = new Promise((resolve, reject) => {
    // Reset widget before execution to clear any previous state
    try {
      window.turnstile.reset(widgetId);
      logDebug('Turnstile widget reset before execution');
    } catch (error) {
      logDebug('Error resetting Turnstile widget', error);
      tokenPromise = null;
      return reject(new Error('Failed to reset Turnstile widget'));
    }
    
    isExecuting = true;
    
    // Set up timeout for the execution
    const executionTimeout = setTimeout(() => {
      isExecuting = false;
      tokenPromise = null;
      try {
        window.turnstile.reset(widgetId);
      } catch (e) {
        logDebug('Error resetting widget on timeout', e);
      }
      reject(new Error('Turnstile execution timed out'));
    }, 15000); // 15 second timeout
    
    try {
      // Execute the challenge
      window.turnstile.execute(widgetId, {
        callback: (token) => {
          clearTimeout(executionTimeout);
          isExecuting = false;
          tokenPromise = null;
          
          if (token) {
            lastToken = token;
            lastTokenAt = Date.now();
            logDebug('Turnstile token successfully generated');
            resolve(token);
          } else {
            logDebug('Turnstile execution completed but no token received');
            reject(new Error('No token received from Turnstile'));
          }
        },
        'error-callback': (error) => {
          clearTimeout(executionTimeout);
          isExecuting = false;
          tokenPromise = null;
          lastToken = null;
          lastTokenAt = 0;
          
          logDebug('Turnstile execution failed', error);
          try {
            window.turnstile.reset(widgetId);
          } catch (e) {
            logDebug('Error resetting widget on error', e);
          }
          reject(new Error('Turnstile execution failed'));
        }
      });
      
      logDebug('Turnstile execution started');
    } catch (error) {
      clearTimeout(executionTimeout);
      isExecuting = false;
      tokenPromise = null;
      logDebug('Error starting Turnstile execution', error);
      reject(error);
    }
  });
  
  return tokenPromise;
}

/**
 * Handle magic link request when user submits email
 */
async function handleMagicLinkRequest() {
  const email = document.getElementById("email").value;
  if (!email) {
    showToastNotification("Please enter a valid email address", "warning");
    return;
  }
  
  // Prevent multiple submissions (debounce)
  if (isSubmitting) {
    logDebug("Magic link request already in progress");
    return;
  }
  
  const nextButton = document.getElementById("nextButton");
  
  try {
    // Set submitting state
    isSubmitting = true;
    nextButton.disabled = true;
    nextButton.textContent = "Preparing...";
    
    // Get Turnstile token with proper lifecycle management
    const turnstileToken = await getTurnstileToken();
    
    // Clear cached token immediately after retrieval to prevent reuse
    lastToken = null;
    lastTokenAt = 0;
    
    // Update button state for network request
    nextButton.textContent = "Sending...";
    
    // Get settings and mode info
    const settingsId = document.getElementById("signupModal").dataset.settingsId || null;
    const currentMode = modesCfg.getCurrentModeName() || 'trace';
    
    logDebug("Sending magic link request", { 
      tokenPresent: !!turnstileToken, 
      email, 
      mode: currentMode,
      settingsId: settingsId || "none" 
    });
    
    sendGAEvent('magic_link_request_submitted', {
        event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
        event_label: 'Magic Link Interaction',
        email_provided: !!email,
        settings_id_present: !!settingsId,
        current_mode_param: currentMode
    });
    
    // Send request to backend
    const response = await fetch(`${window.APP_CONFIG.BACKEND_URL}/api/auth/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, settingsId, turnstileToken, mode: currentMode })
    });
    
    const result = await response.json();
    
    if (result.success) {
      sendGAEvent('magic_link_request_successful', {
        event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
        event_label: 'Magic Link Interaction',
        email_used: email
      });
      
      // Show success step
      document.getElementById("step1").style.display = "none";
      document.getElementById("step2").style.display = "block";
      
      logDebug('Magic link sent successfully');
    } else {
      sendGAEvent('magic_link_request_failed', {
        event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
        event_label: 'Magic Link Interaction',
        failure_reason: result.message || 'Unknown server error',
        status_code: response.status,
        email_used: email
      });
      
      showToastNotification(result.message || "Failed to send magic link", "error");
      
      // Reset widget for next attempt
      if (widgetId !== null && window.turnstile) {
        try {
          window.turnstile.reset(widgetId);
        } catch (e) {
          logDebug('Error resetting widget after failure', e);
        }
      }
    }
  } catch (error) {
    sendGAEvent('magic_link_request_failed', {
        event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
        event_label: 'Magic Link Interaction',
        failure_reason: 'Network or client-side error',
        error_message: error.message,
        email_used: email
    });
    
    logDebug("Error requesting magic link", error);
    
    // Show user-friendly error message based on error type
    if (error.message.includes('Turnstile')) {
      showToastNotification("Security verification failed. Please try again.", "error", { autoHideDelay: 0 });
    } else {
      showToastNotification("Network error. Please check your connection and try again.", "error", { autoHideDelay: 0 });
    }
    
    // Reset widget for next attempt
    if (widgetId !== null && window.turnstile) {
      try {
        window.turnstile.reset(widgetId);
      } catch (e) {
        logDebug('Error resetting widget after error', e);
      }
    }
  } finally {
    // Always reset button state
    isSubmitting = false;
    nextButton.disabled = false;
    nextButton.textContent = "Submit";
  }
}

/**
 * Handler for legacy next button (only needed for removeEventListener)
 */
function handleNextButton() {
  const email = document.getElementById("email").value;
  if (email) {
    document.getElementById("step1").style.display = "none";
    document.getElementById("step2").style.display = "block";
  } else {
    alert("Please enter a valid email address.");
  }
}

/**
 * Bind click handler to the header auth button.
 * Needed because the header is injected asynchronously.
 */
function bindAuthButton() {
  const authButton = document.getElementById("authButton");
  if (authButton && !authButton.dataset.boundAuth) {
    authButton.addEventListener("click", () => {
      const p = window.location.pathname.toLowerCase();
      const onDashboard = p.endsWith('/dashboard') || p.endsWith('/dashboard.html');
      if (onDashboard) {
        openSignupModal();
      } else {
        const defaultMode = (modesCfg.DEFAULT_MODE || 'forge');
        window.location.replace(`/dashboard.html?mode=${defaultMode}&signup=1`);
      }
    });
    authButton.dataset.boundAuth = "true";
    logDebug('Auth button bound');
  }
}

// Bind after DOM ready (in case header is inline)
document.addEventListener("DOMContentLoaded", bindAuthButton);
// Bind after header/footer are injected
document.addEventListener("headerLoaded", bindAuthButton);
document.addEventListener("includes:loaded", bindAuthButton);

/**
 * Ensure dashboard URL always carries a mode parameter.
 * - If user lands on /dashboard.html without ?mode=, add mode=DEFAULT_MODE (forge by default)
 * - Leave any signup param intact so openFromURLIfRequested can open the modal
 */
function ensureModeParam() {
  try {
    const p = window.location.pathname.toLowerCase();
    const onDashboard = p.endsWith('/dashboard') || p.endsWith('/dashboard.html');
    if (!onDashboard) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('mode')) {
      const fallbackMode = (modesCfg.DEFAULT_MODE || 'forge');
      params.set('mode', fallbackMode);
      const qs = params.toString();
      history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    }
  } catch (e) {
    logDebug('ensureModeParam error', e);
  }
}
// Run before signup auto-open so mode is already present
document.addEventListener("DOMContentLoaded", ensureModeParam);
document.addEventListener("includes:loaded", ensureModeParam);

// If redirected to dashboard with ?signup=1, open modal automatically
function openFromURLIfRequested() {
  try {
    const params = new URLSearchParams(window.location.search);
    const wantsSignup = params.get('signup') === '1' || params.get('signup') === 'true';
    const p = window.location.pathname.toLowerCase();
    const onDashboard = p.endsWith('/dashboard') || p.endsWith('/dashboard.html');
    if (onDashboard && wantsSignup) {
      openSignupModal();
      // Clean URL to avoid reopening on refresh (preserve mode and other params)
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete('signup');
      if (!newParams.get('mode')) {
        const fallbackMode = (modesCfg.DEFAULT_MODE || 'forge');
        newParams.set('mode', fallbackMode);
      }
      const qs = newParams.toString();
      history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    }
  } catch (e) {
    logDebug('openFromURLIfRequested error', e);
  }
}
document.addEventListener("DOMContentLoaded", openFromURLIfRequested);
document.addEventListener("includes:loaded", openFromURLIfRequested);

// If DOM already ready (module loaded late), enforce mode and open modal immediately
if (document.readyState !== 'loading') {
  ensureModeParam();
  openFromURLIfRequested();
}
