import { clearSession } from "./session.js";
import { sendGAEvent, GA_EVENT_CATEGORIES } from "./analytics.js"; // Assuming analytics.js is in the same js/ directory

export function logout() {
  sendGAEvent('user_logout', {
    event_category: GA_EVENT_CATEGORIES.USER_LIFECYCLE,
    event_label: 'User Logout Action'
    // No specific parameters needed unless you want to track e.g., time_on_site before logout,
    // but that's usually better handled by GA's session metrics.
  });
  clearSession();
  window.location.href = "login.html";
}
