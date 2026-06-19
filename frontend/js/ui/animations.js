// Import dependencies
import { createLogger } from '../utils/logger.js';

const logDebug = createLogger('Animations');

// Animation state
let animationInterval;

/**
 * Start animation sequence with support for multiple animation types
 * @param {string} type - Animation type ('upload', 'connecting', 'preview', 'full', 'calm')
 * @param {Object} elements - DOM elements required for animation
 * @param {HTMLElement} elements.resultContent - Result content container
 * @param {HTMLElement} elements.resultArea - Result area container
 * @param {HTMLElement} elements.animationContainer - Animation container
 * @param {NodeList} elements.waves - Wave SVG elements
 */
export function startAnimation(type, { resultContent, resultArea, animationContainer, waves }) {
    // First, fade out result content if it exists
    if (resultContent.classList.contains('visible')) {
        resultContent.style.opacity = '0';
        resultContent.classList.remove('visible');
    }
    
    // Show and reset animation container
    animationContainer.classList.remove('hidden');
    requestAnimationFrame(() => {
        animationContainer.style.opacity = '1';
    });

    // Reset and start wave animations
    clearInterval(animationInterval);
    resultArea.classList.remove('preview-animation', 'full-generation-animation', 'upload-animation', 'connecting-animation');
    void resultArea.offsetWidth; // Trigger reflow
    resultArea.classList.add(`${type}-animation`);
    
    // Update wave animations
    updateWaveAnimations(type, waves);

    // Type-specific animation behaviors
    if (type === 'preview') {
        // Preview animation speeds up gradually
        let speed = 1;
        animationInterval = setInterval(() => {
            speed *= 0.95;
            waves.forEach((wave, index) => {
                wave.style.animationDuration = `${(2 + index * 0.5) * speed}s`;
            });
            if (speed < 0.5) clearInterval(animationInterval);
        }, 500);
    }
    // Upload, connecting, and full generation animations rely solely on CSS animations
    
    logDebug(`Started ${type} animation`);
}

/**
 * Stop animation sequence and reset to calm state
 * @param {Object} elements - DOM elements required for animation
 * @param {HTMLElement} elements.resultArea - Result area container 
 * @param {HTMLElement} elements.animationContainer - Animation container
 * @param {HTMLElement} elements.resultContent - Result content container
 * @param {NodeList} elements.waves - Wave SVG elements
 */
export function stopAnimation({ resultArea, animationContainer, resultContent, waves }) {
    clearInterval(animationInterval);
    resultArea.classList.remove('preview-animation', 'full-generation-animation', 'upload-animation', 'connecting-animation');
    void resultArea.offsetWidth; // Trigger reflow
    updateWaveAnimations('calm', waves);

    // Show animation container and hide result content
    animationContainer.classList.remove('hidden');
    resultContent.classList.remove('visible');
    
    logDebug('Animation stopped and reset to calm state');
}

/**
 * Update wave animations based on the animation type
 * @param {string} type - Animation type
 * @param {NodeList} waves - Wave SVG elements
 */
function updateWaveAnimations(type, waves) {
    waves.forEach((wave, index) => {
        wave.style.transition = 'all 2s ease';
        
        // Set animation properties based on type
        switch (type) {
            case 'upload':
                // Gentle, steady waves for upload
                wave.style.animationDuration = `${3.5 + index * 0.8}s`;
                wave.style.animationTimingFunction = 'ease-in-out';
                wave.style.opacity = '0.6';
                break;
                
            case 'connecting':
                // Faster, more dynamic waves for connection
                wave.style.animationDuration = `${1.8 + index * 0.3}s`;
                wave.style.animationTimingFunction = 'ease-in-out';
                wave.style.opacity = '0.7';
                break;
                
            case 'preview':
                // Quick, energetic waves for preview
                wave.style.animationDuration = `${2 + index * 0.5}s`;
                wave.style.animationTimingFunction = 'ease-in-out';
                wave.style.opacity = '0.8';
                break;
                
            case 'full':
                // More dramatic waves for full generation
                wave.style.animationDuration = `${10 + index * 2}s`;
                wave.style.animationTimingFunction = 'ease-in-out';
                wave.style.opacity = '0.9';
                break;
                
            default: // 'calm' state
                wave.style.animationDuration = `${4 + index}s`;
                wave.style.animationTimingFunction = 'linear';
                wave.style.opacity = '0.5';
        }
    });
    
    logDebug(`Wave animations updated for type: ${type}`);
}

// Glow overlay removed


