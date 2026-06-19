// Import dependencies
import { createLogger } from '../utils/logger.js';

const logDebug = createLogger('FileConverter');

/**
 * Client-side file conversion utilities
 * Handles conversion of less common file formats to standardized formats
 */

/**
 * Detects if a file needs conversion and what type of conversion
 * @param {File} file - The file to check
 * @returns {Object} Details about needed conversion: {needsConversion, type, sourceFormat}
 */
export function detectConversionNeeded(file) {
    const fileName = file.name;
    const mimeType = file.type;
    const fileExt = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    
    // Check for HEIC/HEIF image formats
    if (fileExt === '.heic' || fileExt === '.heif' || mimeType === 'image/heic' || mimeType === 'image/heif') {
        logDebug(`HEIC/HEIF image detected: ${fileName} (${mimeType})`);
        return { 
            needsConversion: true, 
            type: 'image', 
            sourceFormat: fileExt.substring(1),
            targetFormat: 'jpeg'
        };
    }
    
    // No conversion needed
    return { needsConversion: false };
}

/**
 * Converts HEIC/HEIF image to JPEG
 * @param {File} file - HEIC/HEIF file to convert
 * @returns {Promise<Blob>} Converted JPEG file as Blob
 */
export async function convertHeicToJpeg(file) {
    try {
        logDebug(`Converting HEIC to JPEG: ${file.name}`);
        
        // Use the global heic2any function
        // This function is made available by the heic2any.min.js script loaded in dashboard.html
        if (typeof window.heic2any !== 'function') {
            throw new Error('heic2any library not loaded properly');
        }
        
        // Convert to JPEG Blob
        const jpegBlob = await window.heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.9
        });
        
        logDebug('HEIC conversion successful');
        
        // Create a new File object from the blob with appropriate metadata
        const fileName = file.name.substring(0, file.name.lastIndexOf('.')) + '.jpg';
        const convertedFile = new File([jpegBlob], fileName, { type: 'image/jpeg' });
        
        return convertedFile;
    } catch (error) {
        console.error('Error converting HEIC to JPEG:', error);
        throw new Error(`Failed to convert HEIC image: ${error.message}`);
    }
}

/**
 * Check if heic2any library is available
 * @returns {boolean} Whether the library is properly loaded
 */
function isHeic2AnyAvailable() {
    return typeof window.heic2any === 'function';
}

/**
 * Process a file, converting it if necessary
 * @param {File} file - The original file
 * @returns {Promise<Object>} Result with converted file if conversion was needed
 */
export async function processFile(file) {
    try {
        // Check if conversion is needed
        const conversionInfo = detectConversionNeeded(file);
        
        if (!conversionInfo.needsConversion) {
            return { success: true, file: file, wasConverted: false };
        }
        
        // Handle image conversion
        if (conversionInfo.type === 'image') {
            if (conversionInfo.sourceFormat === 'heic' || conversionInfo.sourceFormat === 'heif') {
                // Check if heic2any is available before attempting conversion
                if (!isHeic2AnyAvailable()) {
                    logDebug('HEIC conversion library not available');
                    return { 
                        success: false, 
                        error: 'HEIC conversion library not available. Please reload the page or try another image format.',
                        file: file,
                        wasConverted: false
                    };
                }
                
                const convertedFile = await convertHeicToJpeg(file);
                return { 
                    success: true, 
                    file: convertedFile, 
                    wasConverted: true,
                    originalName: file.name,
                    convertedName: convertedFile.name
                };
            }
        }
        
        // If we got here without handling, return the original file
        return { success: true, file: file, wasConverted: false };
    } catch (error) {
        console.error('File processing error:', error);
        return { 
            success: false, 
            error: error.message || 'Unknown error during file processing'
        };
    }
}


