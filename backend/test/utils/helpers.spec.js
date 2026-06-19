import { describe, it, expect } from 'vitest';
import { base64ToArrayBuffer, generateRandomSuffix, validateFileType } from '../../utils/helpers.js';

describe('base64ToArrayBuffer', () => {
	it('converts a simple base64 string to Uint8Array', () => {
		// "Hello" in base64 is "SGVsbG8="
		const result = base64ToArrayBuffer('SGVsbG8=');
		expect(result).toBeInstanceOf(Uint8Array);
		expect(result.length).toBe(5);
		// 'H' = 72, 'e' = 101, 'l' = 108, 'l' = 108, 'o' = 111
		expect(result[0]).toBe(72);
		expect(result[4]).toBe(111);
	});

	it('strips data URL prefix before decoding', () => {
		const result = base64ToArrayBuffer('data:image/png;base64,SGVsbG8=');
		expect(result.length).toBe(5);
		expect(result[0]).toBe(72);
	});
});

describe('generateRandomSuffix', () => {
	it('returns a string of the default length (4)', () => {
		const result = generateRandomSuffix();
		expect(result).toHaveLength(4);
		expect(typeof result).toBe('string');
	});

	it('returns a string of the specified length', () => {
		expect(generateRandomSuffix(8)).toHaveLength(8);
		expect(generateRandomSuffix(1)).toHaveLength(1);
	});

	it('contains only lowercase letters and digits', () => {
		const result = generateRandomSuffix(100);
		expect(result).toMatch(/^[a-z0-9]+$/);
	});
});

describe('validateFileType', () => {
	it('accepts MP4 and MOV video files for imports', () => {
		expect(validateFileType('video.mp4', true)).toBe(true);
		expect(validateFileType('video.MOV', true)).toBe(true);
	});

	it('accepts JPEG, PNG, WebP image files for imports', () => {
		expect(validateFileType('image.jpg', true)).toBe(true);
		expect(validateFileType('image.jpeg', true)).toBe(true);
		expect(validateFileType('image.png', true)).toBe(true);
		expect(validateFileType('image.webp', true)).toBe(true);
	});

	it('rejects unsupported file types for imports', () => {
		expect(validateFileType('document.pdf', true)).toBe(false);
		expect(validateFileType('script.js', true)).toBe(false);
		expect(validateFileType('archive.zip', true)).toBe(false);
	});

	it('allows any file type for exports (isImport=false)', () => {
		expect(validateFileType('anything.xyz', false)).toBe(true);
	});
});
