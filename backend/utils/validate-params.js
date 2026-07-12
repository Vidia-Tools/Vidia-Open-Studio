/**
 * Edge validation for the generation params payload (design section 3).
 *
 * The backend is a thin relay: it does not build graphs, but it does reject
 * malformed payloads at the edge so bad requests never reach the GPU.
 */

const VALID_METHODS = ['forge', 'evolve', 'trace', 'inspire', 'envision'];
const NUMERIC_FIELDS = ['seed', 'steps', 'cfg', 'denoise', 'frame_divider'];

/**
 * Validate a section-3 params object.
 * @param {any} params - The params object from the request body
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateParams(params) {
	if (!params || typeof params !== 'object' || Array.isArray(params)) {
		return { valid: false, error: 'params must be an object' };
	}

	if (!VALID_METHODS.includes(params.method)) {
		return { valid: false, error: `params.method must be one of: ${VALID_METHODS.join(', ')}` };
	}

	if (typeof params.prompt !== 'string' || params.prompt.trim() === '') {
		return { valid: false, error: 'params.prompt is required and must be a non-empty string' };
	}

	for (const field of NUMERIC_FIELDS) {
		if (params[field] !== undefined && typeof params[field] !== 'number') {
			return { valid: false, error: `params.${field} must be a number` };
		}
	}

	if (params.features !== undefined && (typeof params.features !== 'object' || params.features === null || Array.isArray(params.features))) {
		return { valid: false, error: 'params.features must be an object' };
	}

	if (params.files !== undefined && (typeof params.files !== 'object' || params.files === null || Array.isArray(params.files))) {
		return { valid: false, error: 'params.files must be an object' };
	}

	return { valid: true };
}
