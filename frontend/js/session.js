const SESSION_KEY = "vidiaUserSession";
const MODE_KEY = "vidia_mode";

/**
 * Set user session data and fire auth state change event
 * @param {Object} userData - User session data from login/auth verification
 */
export function setSession(userData) {
  // Store user session
  localStorage.setItem(SESSION_KEY, JSON.stringify(userData));
  
  // If mode is included in userData, store it separately for redundancy
  if (userData && userData.mode) {
    localStorage.setItem(MODE_KEY, userData.mode);
    
    // Ensure mode is in URL if not already
    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has('mode') && userData.mode) {
      currentUrl.searchParams.set('mode', userData.mode);
      
      // Update URL without page reload - using history API
      try {
        window.history.replaceState({}, '', currentUrl.toString());
        console.log('Added mode to URL:', userData.mode);
      } catch (e) {
        console.error('Error updating URL with mode:', e);
      }
    }
  }
  
  // Log session update for debugging
  console.log('Session updated:', userData ? {
    token: userData.token ? 'present' : 'missing',
    user: userData.user ? userData.user.email : 'missing',
    mode: userData.mode
  } : 'cleared');
  
  // Dispatch a custom event to notify listeners of auth state change
  document.dispatchEvent(new CustomEvent('authStateChanged', {
    detail: { 
      loggedIn: !!userData,
      mode: userData ? userData.mode : null,
      timestamp: Date.now()
    }
  }));
}

export function getSession() {
  const sessionData = localStorage.getItem(SESSION_KEY);
  return sessionData ? JSON.parse(sessionData) : null;
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  
  // Dispatch a custom event to notify listeners of auth state change (logout)
  document.dispatchEvent(new CustomEvent('authStateChanged', {
    detail: { loggedIn: false }
  }));
}

export function isLoggedIn() {
  return !!getSession();
}
