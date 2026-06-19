import { DEBUG_MODE } from '../config/index.js';

export function createLogger(tag) {
    return function logDebug(message, data) {
        if (DEBUG_MODE) {
            if (data !== undefined) {
                console.log(`[${tag}] ${message}`, data);
            } else {
                console.log(`[${tag}] ${message}`);
            }
        }
    };
}
