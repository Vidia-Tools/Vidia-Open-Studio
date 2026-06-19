// Import dependencies
import { createLogger } from '../utils/logger.js';
import { getBase64, getBucketLocation } from './uploads.js';

const logDebug = createLogger('S3Uploader');

/**
 * Upload a file directly to S3 using presigned URL
 * @param {File} file - The file to upload
 * @param {string} generationId - Unique generation identifier
 * @param {string} fileType - Type of file ('video', 'style', 'face', 'body')
 * @param {Function} progressCallback - Callback for upload progress
 * @returns {Promise<Object>} - Upload result with public URL
 */
export async function uploadToS3(file, generationId, fileType, progressCallback) {
    try {
        logDebug(`Preparing to upload ${fileType}: ${file.name} (${file.size} bytes)`);
        
        // Determine if this is an import (vs. export)
        const isImport = fileType === 'video' || fileType === 'style' || fileType === 'face' || fileType === 'body';
        
        // Get presigned URL
        const presignedData = await getPresignedUrl(
            file.name,
            file.type,
            generationId,
            isImport
        );
        
        if (!presignedData?.success) {
            throw new Error(`Failed to get presigned URL: ${presignedData?.error || 'Unknown error'}`);
        }
        
        logDebug(`Got presigned URL for ${file.name}`, {
            uploadUrl: presignedData.uploadUrl,
            publicUrl: presignedData.publicUrl,
            expiresIn: presignedData.expiresIn
        });
        
        // Use XMLHttpRequest for upload (supports progress tracking)
        try {
            const uploadResult = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                
                // Set up progress tracking
                xhr.upload.addEventListener('progress', (event) => {
                    if (event.lengthComputable) {
                        const percent = (event.loaded / event.total) * 100;
                        logDebug(`Upload progress: ${Math.round(percent)}%`);
                        if (progressCallback) progressCallback(percent);
                    }
                });
                
                // Handle completion
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        logDebug(`Upload successful: ${presignedData.publicUrl}`);
                        resolve({
                            success: true,
                            url: presignedData.publicUrl
                        });
                    } else {
                        logDebug(`Upload failed with status ${xhr.status}: ${xhr.statusText}`);
                        reject(new Error(`Upload failed with status ${xhr.status}`));
                    }
                };
                
                // Handle errors
                xhr.onerror = () => {
                    logDebug('Network error during upload');
                    reject(new Error('Network error during upload'));
                };
                
                // Start upload
                xhr.open('PUT', presignedData.uploadUrl);
                xhr.setRequestHeader('Content-Type', file.type);
                xhr.send(file);
            });
            
            return uploadResult;
        } catch (error) {
            logDebug(`Direct upload failed, falling back to base64: ${error.message}`);
            throw error; // Fall through to fallback
        }
    } catch (error) {
        console.error('S3 upload error:', error);
        
        // Attempt fallback to base64 method
        logDebug('Attempting base64 fallback upload');
        return uploadBase64Fallback(file, generationId, fileType);
    }
}

/**
 * Get a presigned URL from the backend for direct S3 upload
 * @param {string} fileName - Name of the file
 * @param {string} contentType - MIME type of the file
 * @param {string} generationId - Unique generation identifier
 * @param {boolean} isImport - Whether this is an import (vs export)
 * @returns {Promise<Object>} - Presigned URL data
 */
async function getPresignedUrl(fileName, contentType, generationId, isImport) {
    try {
        logDebug(`Requesting presigned URL for ${fileName}`, { contentType, generationId, isImport });
        
        const response = await fetch(`${window.APP_CONFIG.BACKEND_URL}/api/fileUpload/getPresignedUrl`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fileName,
                contentType,
                clientId: generationId, // Keep parameter name for backend compatibility
                isImport
            }),
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error getting presigned URL:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Fallback to base64 upload if direct upload fails
 * @param {File} file - The file to upload
 * @param {string} generationId - Unique generation identifier
 * @param {string} fileType - Type of file ('video', 'style', 'face', 'body')
 * @returns {Promise<Object>} - Upload result
 */
async function uploadBase64Fallback(file, generationId, fileType = 'video') {
    try {
        logDebug(`Using base64 fallback for ${file.name}`);
        
        // Convert file to base64
        const fileBase64 = await getBase64(file);
        
        // Upload using existing base64 method
        const bucketLocation = await getBucketLocation(fileBase64, file.type, file.name, generationId, fileType);
        
        if (!bucketLocation) {
            throw new Error('Base64 fallback upload failed');
        }
        
        logDebug(`Base64 fallback upload successful: ${bucketLocation}`);
        
        return {
            success: true,
            url: bucketLocation
        };
    } catch (error) {
        console.error('Base64 fallback upload error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Find any remaining placeholders in the workflow
 * @param {Object} workflow - The workflow object
 * @returns {Array} - Array of placeholder objects with nodeId, inputName, and value
 */
export function findPlaceholders(workflow) {
    const placeholders = [];
    
    for (const [nodeId, node] of Object.entries(workflow)) {
        if (node?.inputs) {
            for (const [inputName, value] of Object.entries(node.inputs)) {
                if (typeof value === 'string' && value.startsWith('pending-upload-')) {
                    placeholders.push({
                        nodeId,
                        inputName,
                        value
                    });
                }
            }
        }
    }
    
    logDebug(`Found ${placeholders.length} placeholders in workflow`);
    return placeholders;
}


