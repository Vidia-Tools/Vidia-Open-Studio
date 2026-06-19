import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';

describe('Worker entry point', () => {
	it('responds with Hello World! on root path (unit style)', async () => {
		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});

	it('returns 404 for unknown paths', async () => {
		const request = new Request('http://example.com/nonexistent');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		const data = await response.json();
		expect(data.success).toBe(false);
	});

	it('handles CORS preflight requests', async () => {
		const request = new Request('http://example.com/api/auth/magic-link', {
			method: 'OPTIONS',
			headers: { 'Origin': 'https://app.example.com' }
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		// Reflects the request origin when it is in the env ALLOWED_ORIGINS allowlist
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
	});
});
