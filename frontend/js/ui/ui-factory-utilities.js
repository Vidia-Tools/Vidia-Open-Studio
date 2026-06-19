// Import dependencies
import { createLogger } from '../utils/logger.js';

const logDebug = createLogger('UI-Factory');

/**
 * Create an element with nested HTML content
 * @param {string} html - Inner HTML content
 * @param {string} [id] - ID for the container element
 * @param {string} [className] - Class name(s) for the container element
 * @returns {HTMLElement} The created container element
 */
export function createElement(html, id = null, className = null) {
    // Create a div container (matching original implementation)
    const container = document.createElement('div');
    
    // Set the ID and className directly on this container
    if (id) container.id = id;
    if (className) container.className = className;
    
    // Set the inner HTML content
    container.innerHTML = html.trim();
    
    return container;
}

/**
 * Create and inject an element into the DOM
 * @param {string} html - HTML string template
 * @param {string} parentId - ID of parent element to inject into 
 * @param {Object} [options] - Additional options
 * @param {string} [options.id] - ID for the created element
 * @param {string} [options.className] - Class name(s) for the created element
 * @param {string} [options.position='append'] - Position ('prepend', 'append', 'before', 'after')
 * @param {string} [options.relativeTo] - ID of element to position relative to (for 'before'/'after')
 * @returns {HTMLElement|null} The injected element or null if injection failed
 */
export function createAndInject(html, parentId, options = {}) {
    const { id, className, position = 'append', relativeTo } = options;
    
    // Create the element
    const element = createElement(html, id, className);
    
    // Find parent element
    const parent = document.getElementById(parentId);
    if (!parent) {
        logDebug(`Parent element with ID "${parentId}" not found`);
        return null;
    }
    
    // Inject based on position
    try {
        switch (position) {
            case 'prepend':
                parent.prepend(element);
                break;
                
            case 'before':
            case 'after': {
                const reference = relativeTo 
                    ? document.getElementById(relativeTo) 
                    : parent.querySelector(position === 'before' ? ':first-child' : ':last-child');
                
                if (!reference) {
                    logDebug(`Reference element not found, falling back to append`);
                    parent.append(element);
                } else {
                    reference[position === 'before' ? 'before' : 'after'](element);
                }
                break;
            }
                
            default: // append
                parent.append(element);
        }
        
        logDebug(`Element injected into ${parentId} (${position}${relativeTo ? ' '+relativeTo : ''})`);
        return element;
    } catch (error) {
        logDebug(`Error injecting element: ${error.message}`);
        return null;
    }
}


