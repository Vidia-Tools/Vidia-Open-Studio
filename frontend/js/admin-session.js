// Non-module version of session.js specifically for admin panel
const SESSION_KEY = "vidiaUserSession";
const MODE_KEY = "vidia_mode";

/**
 * Get session data for admin panel
 * @returns {Object|null} Session data or null if not logged in
 */
function getSession() {
  try {
    const sessionData = localStorage.getItem(SESSION_KEY);
    const sessionObj = sessionData ? JSON.parse(sessionData) : null;
    
    // Debug logging for admin session
    console.log('Admin session retrieved:', sessionObj ? {
      token: sessionObj.token ? 'present' : 'missing',
      user: sessionObj.user ? sessionObj.user.email : 'missing',
      mode: sessionObj.mode || localStorage.getItem(MODE_KEY) || 'none'
    } : 'no session');
    
    return sessionObj;
  } catch (e) {
    console.error('Error getting admin session:', e);
    return null;
  }
}

/**
 * Clear session and redirect to home page
 */
function logout() {
  try {
    localStorage.removeItem(SESSION_KEY);
    console.log('Admin logged out, redirecting to homepage');
    window.location.href = "/";
  } catch (e) {
    console.error('Error during admin logout:', e);
    // Force redirect even if error
    window.location.href = "/";
  }
}

/**
 * Check if current user is admin
 * @returns {boolean} True if user is admin
 */
function isAdmin() {
  const session = getSession();
  return session && 
         session.user && 
         session.user.email === (import.meta.env?.VITE_ADMIN_EMAIL || '');
}
