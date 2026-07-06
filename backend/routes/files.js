/**
 * File upload routes - base64 upload and presigned URL generation
 */
import { AwsClient } from 'aws4fetch';
import { jsonResponse } from '../utils/response.js';
import { base64ToArrayBuffer, generateRandomSuffix, validateFileType } from '../utils/helpers.js';
import { withRateLimit } from '../middleware/rate-limit.js';
import { withAuth } from '../middleware/auth.js';

/**
 * Sanitizes a string for safe use as an R2 object key segment
 * @param {string} s - Raw key part
 * @returns {string} Sanitized key part (may be empty)
 */
function sanitizeKeyPart(s) {
	return String(s)
		.replace(/[\/\\]/g, '-')
		.replace(/\.{2,}/g, '.')
		.replace(/[\x00-\x1f\x7f]/g, '')
		.slice(0, 128);
}

export function filesRoutes(router) {
	// Base64 file upload to R2 - rate limited to prevent storage abuse (20 per 5 min per IP)
	router.post('/api/fileUpload/uploadBase64File', withAuth, withRateLimit(20, 300), async (request, env) => {
		const { base64File, fileName, clientId, fileType } = await request.json();

		if (!base64File || !fileName) {
			return jsonResponse({ success: false, error: 'Missing required fields' }, 400);
		}

		if (base64File.length > 40_000_000) {
			return jsonResponse({ success: false, error: 'File too large' }, 413);
		}

		if (!validateFileType(fileName, true)) {
			return jsonResponse({
				success: false,
				error: 'Unsupported file format. Only MP4/MOV videos and JPEG, PNG, WebP images are allowed.'
			}, 400);
		}

		const safeFileName = sanitizeKeyPart(fileName);
		const safeClientId = clientId ? sanitizeKeyPart(clientId) : '';
		if (!safeFileName || (clientId && !safeClientId)) {
			return jsonResponse({ success: false, error: 'Invalid file name or client ID' }, 400);
		}

		const arrayBuffer = base64ToArrayBuffer(base64File);
		const objectKey = safeClientId ? `${safeClientId}/${safeFileName}` : safeFileName;

		try {
			console.log(`Uploading file ${objectKey} to bucket ${env.IMPORTS_BUCKET_NAME}`);
			const upload = await env.IMPORTS_BUCKET.put(objectKey, arrayBuffer, {
				httpMetadata: {
					contentType: fileType || 'application/octet-stream'
				}
			});
			console.log('Upload successful:', upload);

			if (!upload || !upload.key) {
				throw new Error('Upload response missing key');
			}

			return jsonResponse({
				success: true,
				location: `https://${env.IMPORTS_BUCKET_DOMAIN}/${upload.key}`,
			});
		} catch (error) {
			console.error('R2 upload error:', error);
			return jsonResponse({
				success: false,
				error: 'Upload failed'
			}, 500);
		}
	});

	// Presigned URL generation for direct client upload to R2
	router.post('/api/fileUpload/getPresignedUrl', withAuth, withRateLimit(30, 300), async (request, env) => {
		try {
			const { fileName, contentType, clientId, isImport } = await request.json();

			if (!fileName || !contentType || !clientId) {
				return jsonResponse({ success: false, error: 'Missing required fields' }, 400);
			}

			if (isImport && !validateFileType(fileName, isImport)) {
				return jsonResponse({
					success: false,
					error: 'Unsupported file format. Only MP4/MOV videos and JPEG, PNG, WebP images are allowed.'
				}, 400);
			}

			const safeFileName = sanitizeKeyPart(fileName);
			const safeClientId = sanitizeKeyPart(clientId);
			if (!safeFileName || !safeClientId) {
				return jsonResponse({ success: false, error: 'Invalid file name or client ID' }, 400);
			}

			// Choose bucket based on import/export flag
			const bucketName = isImport !== false ? env.IMPORTS_BUCKET_NAME : env.EXPORTS_BUCKET_NAME;
			const bucketDomain = isImport !== false ? env.IMPORTS_BUCKET_DOMAIN : env.EXPORTS_BUCKET_DOMAIN;

			const r2 = new AwsClient({
				service: 's3',
				region: 'auto',
				accessKeyId: env.S3_ACCESS_KEY_ID,
				secretAccessKey: env.S3_SECRET_ACCESS_KEY,
			});

			// Add random suffix for uniqueness
			const randomSuffix = generateRandomSuffix(6);
			const fileBase = safeFileName.substring(0, safeFileName.lastIndexOf('.') !== -1 ?
				safeFileName.lastIndexOf('.') : safeFileName.length);
			const fileExt = safeFileName.lastIndexOf('.') !== -1 ?
				safeFileName.substring(safeFileName.lastIndexOf('.')) : '';
			const uniqueFileName = `${fileBase}-${randomSuffix}${fileExt}`;
			const objectKey = `${safeClientId}/${uniqueFileName}`;

			console.log(`Generating presigned URL for ${objectKey} in bucket ${bucketName}`);

			const signUrl = new URL(
				`https://${bucketName}.${env.ACCOUNT_ID}.r2.cloudflarestorage.com/${objectKey}`
			);
			signUrl.searchParams.set('X-Amz-Expires', '3600');

			const signed = await r2.sign(
				new Request(signUrl, {
					method: 'PUT',
					headers: { 'Content-Type': contentType }
				}),
				{ aws: { signQuery: true } }
			);

			const publicUrl = `https://${bucketDomain}/${objectKey}`;

			console.log(`Presigned URL generated successfully for ${objectKey}`);

			return jsonResponse({
				success: true,
				uploadUrl: signed.url,
				publicUrl: publicUrl,
				expiresIn: 3600
			});
		} catch (error) {
			console.error('Error generating presigned URL:', error);
			return jsonResponse(
				{ success: false, error: 'Failed to generate presigned URL' },
				500
			);
		}
	});
}
