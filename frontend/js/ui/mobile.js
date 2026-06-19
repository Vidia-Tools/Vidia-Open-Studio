/**
 * Mobile-specific enhancements for Vidia
 * This script only runs on mobile devices (screens under 768px)
 */

// Guard clause - only run on mobile devices
if (window.innerWidth > 768) {
    // Exit early on desktop
    console.log('Mobile enhancements skipped on desktop');
} else {
    document.addEventListener('DOMContentLoaded', function() {
        // Initialize mobile enhancements
        initMobileEnhancements();
    });
}

/**
 * Initialize all mobile-specific enhancements
 */
function initMobileEnhancements() {
    // Add back-to-top button
    // addBackToTopButton();
    
    // Add touch feedback to interactive elements
    enhanceTouchFeedback();
    
    // Add hamburger menu for advanced settings
    addAdvancedSettingsToggle();
}

/**
 * Add hamburger menu toggle for advanced settings section
 */
function addAdvancedSettingsToggle() {
    // Get advanced section
    const advancedSection = document.getElementById('advanced');
    if (!advancedSection) return;
    
    // Create hamburger button
    const hamburger = document.createElement('button');
    hamburger.className = 'mobile-hamburger';
    hamburger.setAttribute('aria-label', 'Toggle advanced settings');
    hamburger.innerHTML = '<span></span>';
    
    // Advanced section should start collapsed on mobile
    advancedSection.classList.add('collapsed');
    
    // Add hamburger button to the document
    document.body.appendChild(hamburger);
    
    // Toggle advanced section visibility when hamburger clicked
    hamburger.addEventListener('click', function() {
        this.classList.toggle('active');
        advancedSection.classList.toggle('collapsed');
        
        // Scroll to advanced section if opened
        if (!advancedSection.classList.contains('collapsed')) {
            setTimeout(() => {
                advancedSection.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        }
    });
    
    // Hide the "More Options" button since we're using hamburger instead
    const moreOptionsButton = document.getElementById('advancedButton');
    if (moreOptionsButton) {
        moreOptionsButton.style.display = 'none';
    }
}

/**
 * Add a back-to-top floating button for mobile
 */
function addBackToTopButton() {
    // Create back-to-top button
    const backToTop = document.createElement('a');
    backToTop.href = '#top';
    backToTop.className = 'back-to-top';
    backToTop.setAttribute('aria-label', 'Back to top');
    backToTop.innerHTML = `
        <svg viewBox="0 0 24 24">
            <polyline points="17 11 12 6 7 11"></polyline>
            <polyline points="12 18 12 6"></polyline>
        </svg>
    `;
    
    // Append to body
    document.body.appendChild(backToTop);
    
    // Handle scroll events to show/hide button
    window.addEventListener('scroll', function() {
        // Show button when scrolled down 300px
        if (window.scrollY > 300) {
            backToTop.classList.add('visible');
        } else {
            backToTop.classList.remove('visible');
        }
    });
    
    // Smoothly scroll back to top when clicked
    backToTop.addEventListener('click', function(e) {
        e.preventDefault();
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

/**
 * Enhance touch feedback for better mobile experience
 */
function enhanceTouchFeedback() {
    // Add active class on touch to relevant elements for visual feedback
    const touchElements = document.querySelectorAll('button, .generate-button, .advanced-button, .auth-button');
    
    touchElements.forEach(element => {
        element.addEventListener('touchstart', function() {
            this.classList.add('touch-active');
        }, { passive: true });
        
        // Remove touch-active class on touchend and touchcancel
        ['touchend', 'touchcancel'].forEach(eventType => {
            element.addEventListener(eventType, function() {
                this.classList.remove('touch-active');
            }, { passive: true });
        });
    });
}
