// =============================================================================
// Utility: pricing.js
// Tier: N/A (Utility - not a standard feature)
// Description: Credit cost estimation, balance management, and refunds
// =============================================================================

// === Imports ===
import { createLogger } from '../utils/logger.js';
import * as state from '../core/state.js';
import * as store from '../core/generation-store.js';

const logDebug = createLogger('Pricing');

// === Constants/Config ===

const FEATURE_COST_FACTORS = {
    detailer: 1.2,
    upscaler: 1.5,
    temperature: 1.1
};

// === Cost Calculation ===

/**
 * Update estimated cost based on current settings
 * @param {Object} workflow - The current workflow object
 * @param {string} speedSetting - The selected speed setting (quality, balanced, speed, high_speed)
 * @returns {number} The estimated cost in credits
 */
export function updateEstimatedCost(workflow, speedSetting) {
    if (!state.getCurrentFile()) {
        return 0;
    }

    let baseCost = 10;

    const speedFactor = {
        'quality': 1.5,
        'balanced': 1.2,
        'speed': 1,
        'high_speed': 0.8
    };
    baseCost *= speedFactor[speedSetting];

    const features = store.getFeatures();
    if (features.detailer) baseCost *= FEATURE_COST_FACTORS.detailer;
    if (features.upscaler) baseCost *= FEATURE_COST_FACTORS.upscaler;

    const finalCost = Math.round(baseCost);
    logDebug('Estimated cost updated:', finalCost);
    return finalCost;
}

// === Credit Management ===

/**
 * Update credit balance in state and UI
 * @param {number} newAmount - The new credit amount
 */
export function updateCredits(newAmount) {
    state.setCurrentCredits(newAmount);
    const creditBalance = document.getElementById('creditBalance');
    if (creditBalance) {
        creditBalance.textContent = `Credits: ${newAmount}`;
        logDebug('Credit balance updated:', newAmount);
    }
}

/**
 * Refund credits to user for failed generation
 * @param {number} amount - The amount to refund (if not provided, defaults to 10)
 * @returns {number} The refunded amount
 */
export function refundCredits(amount) {
    const currentCredits = state.getCurrentCredits();
    const refundAmount = amount || 10;
    const newBalance = currentCredits + refundAmount;

    updateCredits(newBalance);
    logDebug('Credits refunded for failed generation:', refundAmount);
    return refundAmount;
}

/**
 * Check if user has sufficient credits
 * @param {number} cost - The cost to check against
 * @returns {boolean} Whether the user has sufficient credits
 */
export function hasSufficientCredits(cost) {
    return state.getCurrentCredits() >= cost;
}
