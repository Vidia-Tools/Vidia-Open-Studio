import { describe, it, expect } from 'vitest';
import { validateParams } from '../../utils/validate-params.js';

describe('validateParams', () => {
	it('accepts a valid section-3 params payload', () => {
		const params = {
			method: 'forge',
			prompt: 'a cat riding a bike',
			seed: 123,
			steps: 20,
			cfg: 6.0,
			denoise: 0.7,
			features: { detailer: false },
			files: { in_video: 'https://example.com/v.mp4' }
		};
		expect(validateParams(params)).toEqual({ valid: true });
	});

	it('rejects an invalid method', () => {
		const result = validateParams({ method: 'bogus', prompt: 'hi' });
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/method/);
	});

	it('rejects missing required params (no prompt)', () => {
		const result = validateParams({ method: 'forge' });
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/prompt/);
	});

	it('rejects a non-object params', () => {
		expect(validateParams(null).valid).toBe(false);
		expect(validateParams('nope').valid).toBe(false);
	});

	it('rejects wrong types for numeric fields', () => {
		const result = validateParams({ method: 'forge', prompt: 'hi', steps: 'twenty' });
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/steps/);
	});
});
