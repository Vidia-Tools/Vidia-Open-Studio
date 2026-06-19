/**
 * File upload routes - base64 upload and presigned URL generation
 */
import { AwsClient } from 'aws4fetch';
import { jsonResponse } from '../utils/response.js';
import { base64ToArrayBuffer, generateRandomSuffix, validateFileType } from '../utils/helpers.js';
import { withRateLimit } from '../middleware/rate-limit.js';

export function filesRoutes(router) {
	// Base64 file upload to R2 - rate limited to prevent storage abuse (20 per 5 min per IP)
	router.post('/api/fileUpload/uploadBase64File', withRateLimit(20, 300), async (request, env) => {
		const { base64File, fileName, clientId, fileType } = await request.json();

		if (!base64File || !fileName) {
			return jsonResponse({ success: false, error: 'Missing required fields' }, 400);
		}

		if (!validateFileType(fileName, true)) {
			return jsonResponse({
				success: false,
				error: 'Unsupported file format. Only MP4/MOV videos and JPEG, PNG, WebP images are allowed.'
			}, 400);
		}

		const arrayBuffer = base64ToArrayBuffer(base64File);
		const objectKey = clientId ? `${clientId}/${fileName}` : fileName;

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
				error: 'Upload failed',
				details: error.message
			}, 500);
		}
	});

	// Presigned URL generation for direct client upload to R2
	router.post('/api/fileUpload/getPresignedUrl', async (request, env) => {
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
			const fileBase = fileName.substring(0, fileName.lastIndexOf('.') !== -1 ?
				fileName.lastIndexOf('.') : fileName.length);
			const fileExt = fileName.lastIndexOf('.') !== -1 ?
				fileName.substring(fileName.lastIndexOf('.')) : '';
			const uniqueFileName = `${fileBase}-${randomSuffix}${fileExt}`;
			const objectKey = `${clientId}/${uniqueFileName}`;

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
				{ success: false, error: 'Failed to generate presigned URL', details: error.message },
				500
			);
		}
	});
}
