// Helper to convert base64-encoded string to ArrayBuffer for R2 storage
const base64ToArrayBuffer = (base64) => {
	// Strip data URL prefix if present (e.g., "data:image/png;base64,")
	const base64String = base64.replace(/^data:.*,/, '');

	const binaryString = atob(base64String);

	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	return bytes;
};

/**
 * Random string for filename suffixes to prevent collisions in storage
 * @param {number} length - Length of random string to generate
 * @returns {string}
 */
const generateRandomSuffix = (length = 4) => {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
};

/**
 * Validates a file type based on its extension
 * @param {string} fileName - The file name to validate
 * @param {boolean} isImport - Whether this is an import (vs export)
 * @returns {boolean}
 */
const validateFileType = (fileName, isImport) => {
	if (!isImport) return true;

	const fileExt = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();

	const allowedVideoExts = ['.mp4', '.mov'];
	const allowedImageExts = ['.jpg', '.jpeg', '.png', '.webp'];

	return allowedVideoExts.includes(fileExt) || allowedImageExts.includes(fileExt);
};

export { base64ToArrayBuffer, generateRandomSuffix, validateFileType };
