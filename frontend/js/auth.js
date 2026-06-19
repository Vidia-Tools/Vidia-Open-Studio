import { isLoggedIn, getSession } from "./session.js";
import { logout } from "./logout.js";
import { initializeHistoryButton } from "./auth/history-modal.js";

function checkAuth() {
  if (
    !isLoggedIn() &&
    !window.location.pathname.includes("signup.html")
  ) {
    // Magic link authentication is now used - no redirect needed
  }
}

function updateUIForLoggedInUser() {
  const userData = getSession();
  if (userData) {
    /*  const userNameElement = document.getElementById("userName");
    if (userNameElement) {
      userNameElement.textContent = `Welcome, ${userData.firstName}`;
    } */
    const authButton = document.getElementById("authButton");
    const logoutButton = document.querySelector(".logout");
    if (authButton) authButton.style.display = "none";
    if (logoutButton) {
      logoutButton.style.display = "block";
      logoutButton.addEventListener("click", logout);
    }
    
    // Initialize history button when user is logged in
    initializeHistoryButton();
    
    // Check if user is admin and add admin panel button
    if (userData.user && userData.user.email === (import.meta.env?.VITE_ADMIN_EMAIL || '')) {
      // Enable debug mode
      window.DEBUG_MODE = true;
      
      // Create admin button
      const adminButton = document.createElement("button");
      adminButton.textContent = "Admin Panel";
      adminButton.className = "btn";
      adminButton.style.marginRight = "10px";
      adminButton.addEventListener("click", () => {
        window.location.href = "/admin-panel.html";
      });
      
      // Add button next to logout
      if (logoutButton && logoutButton.parentNode) {
        logoutButton.parentNode.insertBefore(adminButton, logoutButton);
      }
    }
  }
}

// Listen for auth state changes
document.addEventListener('authStateChanged', (event) => {
  console.log('Auth state changed event received', event.detail);
  // Update UI based on new auth state
  updateUIForLoggedInUser();
  
  // Also update document body class for CSS targeting of login state
  if (event.detail && event.detail.loggedIn) {
    document.body.classList.add('user-logged-in');
  } else {
    document.body.classList.remove('user-logged-in');
  }
});

document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
  updateUIForLoggedInUser();
});
