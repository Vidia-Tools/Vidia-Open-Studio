import { showToastNotification } from './helpers.js';

/**
 * Validates a set of fields based on provided rules and provides UI feedback for failures.
 * @param {Array<Object>} rules - An array of validation rules.
 * @param {Function} rules[].condition - A function that returns true if validation fails.
 * @param {string} rules[].elementId - The ID of the element to highlight on failure.
 * @param {string} rules[].message - The message to display in a toast notification on failure.
 * @returns {boolean} - True if all validations pass, false otherwise.
 */
export function validateRequiredFields(rules) {
  for (const rule of rules) {
    if (rule.condition()) {
      showToastNotification(rule.message, 'warning');
      const container = document.getElementById(rule.elementId)?.closest('.advanced-setting');
      if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
        container.classList.add('red-glow');
        setTimeout(() => {
          container.classList.remove('red-glow');
        }, 2000);
      }
      return false; // Validation failed
    }
  }
  return true; // All validations passed
}
