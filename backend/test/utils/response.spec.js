import { describe, it, expect } from 'vitest';
import { jsonResponse, corsHeaders, logDebug } from '../../utils/response.js';

describe('jsonResponse', () => {
	it('returns a Response with correct JSON body', async () => {
		const resp = jsonResponse({ success: true, data: 'test' });
		expect(resp).toBeInstanceOf(Response);
		const body = await resp.json();
		expect(body.success).toBe(true);
		expect(body.data).toBe('test');
	});

	it('defaults to status 200', () => {
		const resp = jsonResponse({ ok: true });
		expect(resp.status).toBe(200);
	});

	it('uses the provided status code', () => {
		const resp = jsonResponse({ error: 'not found' }, 404);
		expect(resp.status).toBe(404);
	});

	it('sets Content-Type to application/json', () => {
		const resp = jsonResponse({});
		expect(resp.headers.get('Content-Type')).toBe('application/json');
	});

	it('includes CORS headers', () => {
		const resp = jsonResponse({});
		expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});
});

describe('corsHeaders', () => {
	it('has the expected static properties', () => {
		expect(corsHeaders['Access-Control-Allow-Origin']).toBe('*');
		expect(corsHeaders['Access-Control-Allow-Methods']).toContain('GET');
		expect(corsHeaders['Access-Control-Allow-Methods']).toContain('POST');
		expect(corsHeaders['Access-Control-Allow-Headers']).toContain('Authorization');
	});
});
