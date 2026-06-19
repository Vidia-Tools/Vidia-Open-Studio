/**
 * UI Style Constants
 * 
 * This file contains reusable style constants for consistent UI styling
 * across the application, to be used only in cases where css conflicts are inevitable. Otherwise all css should go in stylesheets, not JS
 */

/**
 * Styles for deselect/close buttons used in various components
 */
export const DESELECT_BUTTON_STYLES = {
    position: 'absolute',
    top: '5px',
    right: '5px',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '18px',
    fontWeight: 'bold',
    zIndex: '10',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    color: 'white',
    lineHeight: '20px',     // Helps center the × character vertically
    textAlign: 'center',    // Centers it horizontally
    paddingBottom: '2px'    // Fine adjustment for the × character positioning
};

/**
 * Styles for container elements that will contain deselect buttons
 */
export const CONTAINER_WITH_BUTTON_STYLES = {
    position: 'relative'
};

/**
 * Styles for disabled feature containers
 */
export const DISABLED_FEATURE_STYLES = {
    opacity: '0.8',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderLeft: '3px solid #ccc',
    boxShadow: 'inset 0 0 3px rgba(0, 0, 0, 0.1)',
    position: 'relative',
    pointerEvents: 'auto' // Keep events enabled for tooltip
};

/**
 * Styles for dark theme disabled features
 */
export const DISABLED_FEATURE_DARK_STYLES = {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    boxShadow: 'inset 0 0 3px rgba(255, 255, 255, 0.05)'
};

/**
 * Styles for disabled toggle sliders
 */
export const DISABLED_SLIDER_STYLES = {
    backgroundColor: '#888 !important',
    cursor: 'not-allowed !important',
    opacity: '0.7'
};

/**
 * Styles for disabled toggle slider buttons
 */
export const DISABLED_SLIDER_BUTTON_STYLES = {
    opacity: '0.7 !important',
    boxShadow: 'none !important'
};

/**
 * Styles for disabled toggle labels
 */
export const DISABLED_LABEL_STYLES = {
    color: '#888 !important',
    opacity: '0.7',
    textDecoration: 'line-through',
    fontStyle: 'italic'
};

/**
 * Styles for disabled hint icons
 */
export const DISABLED_HINT_ICON_STYLES = {
    backgroundColor: '#888 !important',
    opacity: '0.7'
};

/**
 * Apply styles to an HTML element
 * @param {HTMLElement} element - The element to apply styles to
 * @param {Object} styles - Object containing style key-value pairs
 */
export function applyStyles(element, styles) {
    if (!element || !styles) return;
    
    Object.assign(element.style, styles);
}

/**
 * Styles for the overlay message on disabled features
 */
export const DISABLED_OVERLAY_STYLES = {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    color: 'white',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
    zIndex: '10',
    borderRadius: '8px',
    padding: '10px',
    fontWeight: '600',
    fontSize: '0.95rem',
    backdropFilter: 'blur(2px)',
    transition: 'opacity 0.3s ease'
};

/**
 * Styles for the overlay message in dark theme
 */
export const DISABLED_OVERLAY_DARK_STYLES = {
    backgroundColor: 'rgba(255, 255, 255, 0.15)'
};

/**
 * Apply disabled state to a feature container and its controls
 * @param {HTMLElement} container - The container element
 * @param {boolean} isDisabled - Whether the feature is disabled
 * @param {string} reason - Message explaining why disabled
 * @returns {boolean} - Whether styles were applied successfully
 */
export function applyDisabledState(container, isDisabled, reason = "Please upload a video first") {
    if (!container) return false;
    
    // Get the child elements
    const toggle = container.querySelector('input[type="checkbox"]');
    const slider = toggle?.nextElementSibling;
    const label = container.querySelector('.toggle-label');
    const hintIcon = container.querySelector('.hint-icon');
    const controls = container.querySelector('.advanced-setting-control');
    
    // Check if dark theme is active
    const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
    
    // Check for existing overlay
    const existingOverlay = container.querySelector('.disabled-feature-overlay');
    
    if (isDisabled) {
        // Apply container styles
        applyStyles(container, DISABLED_FEATURE_STYLES);
        
        // Apply dark theme styles if needed
        if (isDarkTheme) {
            applyStyles(container, DISABLED_FEATURE_DARK_STYLES);
        }
        
        // Make sure the container is positioned for overlay
        container.style.position = 'relative';
        
        // Add overlay with reason, if it doesn't already exist
        if (!existingOverlay) {
            const overlay = document.createElement('div');
            overlay.className = 'disabled-feature-overlay';
            applyStyles(overlay, DISABLED_OVERLAY_STYLES);
            
            // Apply dark theme styles to overlay if needed
            if (isDarkTheme) {
                applyStyles(overlay, DISABLED_OVERLAY_DARK_STYLES);
            }
            
            // Add message to overlay
            overlay.textContent = reason;
            
            // Append overlay to container
            container.appendChild(overlay);
        } else {
            // Update existing overlay text
            existingOverlay.textContent = reason;
            existingOverlay.style.display = 'flex';
        }
        
        // Disable user interaction with controls
        if (controls) {
            controls.style.pointerEvents = 'none';
        }
        
        // Apply styles to toggle switch components
        if (toggle) toggle.disabled = true;
        if (slider) applyStyles(slider, DISABLED_SLIDER_STYLES);
        if (label) applyStyles(label, DISABLED_LABEL_STYLES);
        if (hintIcon) applyStyles(hintIcon, DISABLED_HINT_ICON_STYLES);
        
        // Apply styles to slider button
        if (slider) {
            const sliderButton = slider.querySelector(':before') || slider;
            if (sliderButton) {
                try {
                    applyStyles(sliderButton, DISABLED_SLIDER_BUTTON_STYLES);
                } catch (e) {
                    // Can't always access pseudo-elements directly
                }
            }
        }
    } else {
        // Clear disabled styles
        container.style.opacity = '';
        container.style.backgroundColor = '';
        container.style.borderLeft = '';
        container.style.boxShadow = '';
        container.style.pointerEvents = '';
        
        // Remove or hide the overlay
        if (existingOverlay) {
            existingOverlay.remove();
        }
        
        // Enable interaction with controls
        if (controls) {
            controls.style.pointerEvents = '';
        }
        
        // Clear toggle styles
        if (toggle) toggle.disabled = false;
        if (slider) {
            slider.style.backgroundColor = '';
            slider.style.cursor = '';
            slider.style.opacity = '';
        }
        if (label) {
            label.style.color = '';
            label.style.opacity = '';
            label.style.textDecoration = '';
            label.style.fontStyle = '';
        }
        if (hintIcon) {
            hintIcon.style.backgroundColor = '';
            hintIcon.style.opacity = '';
        }
    }
    
    return true;
}
