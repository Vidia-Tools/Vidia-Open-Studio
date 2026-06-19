// Import dependencies
import { createLogger } from '../utils/logger.js';
import { detectConversionNeeded } from './fileConverter.js';

const logDebug = createLogger('FileValidator');

/**
 * Validates a file based on its type and size
 * @param {File} file - The file to validate
 * @param {string} type - The validation type ('video' or 'image')
 * @returns {Object} Validation result with validity status, reason, and warnings
 */
export function validateFile(file, type) {
    const result = {
        valid: false,
        reason: '',
        warnings: []
    };
    
    // Log validation attempt
    logDebug(`Validating ${type} file: ${file.name} (${formatFileSize(file.size)}, ${file.type})`);
    
    // Size validation
    if (type === 'video' && file.size > 150 * 1024 * 1024) {
        result.reason = `Video exceeds size limit (150MB maximum)`;
        logDebug(`Validation failed: ${result.reason}`);
        return result;
    } else if (type === 'image' && file.size > 10 * 1024 * 1024) {
        result.reason = `Image exceeds size limit (10MB maximum)`;
        logDebug(`Validation failed: ${result.reason}`);
        return result;
    }
    
    // Type validation
    if (type === 'video') {
        const allowedVideoTypes = ['video/mp4', 'video/quicktime'];
        const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        
        // Check if file has valid MIME type or extension (for .mov files)
        if (!allowedVideoTypes.includes(file.type) && fileExt !== '.mov') {
            result.reason = 'Only MP4 and MOV video files are allowed';
            logDebug(`Validation failed: ${result.reason}`);
            return result;
        }
    } else if (type === 'image') {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        
        // Check for HEIC/HEIF that can be converted
        const isHeic = fileExt === '.heic' || fileExt === '.heif' || 
                      file.type === 'image/heic' || file.type === 'image/heif';
        
        if (!allowedTypes.includes(file.type) && !isHeic) {
            result.reason = 'Only JPEG, PNG, WebP, and HEIC/HEIF images are allowed';
            logDebug(`Validation failed: ${result.reason}`);
            return result;
        }
    }
    
    // Warnings for large files
    if (type === 'video' && file.size > 100 * 1024 * 1024) {
        result.warnings.push('This large video file may take longer to process');
    }
    
    // Valid file
    result.valid = true;
    logDebug(`Validation passed for ${type} file`);
    return result;
}

/**
 * Determines if a file needs conversion
 * @param {File} file - The file to check
 * @returns {Object} Conversion info with needsConversion flag and type details
 */
export function needsConversion(file) {
    return detectConversionNeeded(file);
}

/**
 * Formats file size in human-readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' bytes';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}


