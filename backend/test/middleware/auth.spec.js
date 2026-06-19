import { describe, it, expect } from 'vitest';
import { withAuth } from '../../middleware/auth.js';

// Minimal mock env with a known JWT secret
const TEST_SECRET = 'test-secret-key-for-unit-tests';

describe('withAuth middleware', () => {
	it('returns 401 when no Authorization header is present', () => {
		const request = new Request('http://example.com/api/test', {
			method: 'GET'
		});
		const env = { JWT_SECRET: TEST_SECRET };

		const result = withAuth(request, env);
		// Should return a Response (short-circuit)
		expect(result).toBeInstanceOf(Response);
		expect(result.status).toBe(401);
	});

	it('returns 401 when Authorization header has empty bearer token', () => {
		const request = new Request('http://example.com/api/test', {
			method: 'GET',
			headers: { 'Authorization': 'Bearer ' }
		});
		const env = { JWT_SECRET: TEST_SECRET };

		const result = withAuth(request, env);
		expect(result).toBeInstanceOf(Response);
		expect(result.status).toBe(401);
	});

	it('returns 401 when token is invalid', () => {
		const request = new Request('http://example.com/api/test', {
			method: 'GET',
			headers: { 'Authorization': 'Bearer invalid-token-here' }
		});
		const env = { JWT_SECRET: TEST_SECRET };

		const result = withAuth(request, env);
		expect(result).toBeInstanceOf(Response);
		expect(result.status).toBe(401);
	});

	it('attaches decoded user to request when token is valid', async () => {
		// Create a real JWT for testing (requires jsonwebtoken)
		const jwt = await import('jsonwebtoken');
		const token = jwt.default.sign(
			{ userId: 'user-123', email: 'test@example.com' },
			TEST_SECRET,
			{ expiresIn: '1h' }
		);

		const request = new Request('http://example.com/api/test', {
			method: 'GET',
			headers: { 'Authorization': `Bearer ${token}` }
		});
		const env = { JWT_SECRET: TEST_SECRET };

		const result = withAuth(request, env);
		// Should return undefined (pass-through to next handler)
		expect(result).toBeUndefined();
		// User should be attached to request
		expect(request.user).toBeDefined();
		expect(request.user.userId).toBe('user-123');
		expect(request.user.email).toBe('test@example.com');
	});
});
