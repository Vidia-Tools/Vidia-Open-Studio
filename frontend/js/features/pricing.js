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

// Speed Priority select labels (controls/generate.json) -> cost factor.
// The store holds the selected option's label under the 'speed' param key
// (controls-renderer readValue writes the select's option string). When the
// control is hidden/not applicable (e.g. forge mode) the param is unset -> 1.
const SPEED_FACTOR = {
    'Quality': 1.5,
    'Balanced': 1.2,
    'Speed': 1,
    'High Speed': 0.8
};

// === Cost Calculation ===

/**
 * Update estimated cost based on current store settings (prod parity).
 * Reads speed/detailer/upscaler/temperature from the generation store and
 * writes the rounded cost to the #estimatedCost element. Mirrors prod's
 * multiplicative formula: base 10 * speed * detailer * upscaler * temperature.
 * @returns {number} The estimated cost in credits
 */
export function updateEstimatedCost() {
    if (!state.getCurrentFile()) {
        return 0;
    }

    let baseCost = 10;

    baseCost *= SPEED_FACTOR[store.getParam('speed')] ?? 1;

    const features = store.getFeatures();
    if (features.detailer) baseCost *= FEATURE_COST_FACTORS.detailer;
    if (features.upscaler) baseCost *= FEATURE_COST_FACTORS.upscaler;
    if (store.getParam('model_temperature')) baseCost *= FEATURE_COST_FACTORS.temperature;

    const finalCost = Math.round(baseCost);
    const costEl = document.getElementById('estimatedCost');
    if (costEl) costEl.textContent = finalCost;
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
