// Import dependencies
import { createLogger } from '../utils/logger.js';
import { sendGAEvent, GA_EVENT_CATEGORIES } from '../analytics.js';

const logDebug = createLogger('Uploads');
import { MESSAGES } from '../config/helper-messages.js';
import * as state from '../core/state.js';
import { validateFile, needsConversion } from './fileValidator.js';
import { storeFile, isPendingFilePlaceholder, clearFile, getFileIdFromPlaceholder } from './localFileStorage.js';
import { processFile } from './fileConverter.js';
import { showToastNotification } from './helpers.js';

/**
 * Clears any existing file for the specified node input from local storage
 * @param {string} nodeId - The node ID
 * @param {string} inputName - The input name
 * @returns {Promise<void>}
 */
async function clearExistingFile(nodeId, inputName) {
    try {
        const workflow = state.getWorkflow();
        if (!workflow || !workflow[nodeId] || !workflow[nodeId].inputs || !workflow[nodeId].inputs[inputName]) {
            return;
        }
        
        // Check if current input is a pending file
        const currentValue = workflow[nodeId].inputs[inputName];
        if (isPendingFilePlaceholder(currentValue)) {
            // Extract the file ID and clear it
            const fileId = getFileIdFromPlaceholder(currentValue);
            if (fileId) {
                logDebug(`Clearing existing file for ${nodeId}.${inputName}: ${fileId}`);
                await clearFile(fileId);
            }
        }
    } catch (error) {
        console.error(`Error clearing existing file for ${nodeId}.${inputName}:`, error);
    }
}

// Convert file to base64
export function getBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
    });
}

// Upload file to bucket
export async function getBucketLocation(base64, mimeType, name, clientId = 'anonymous', fileType = 'video') {
    try {
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.UPLOADING);
        const request = await fetch(`${window.APP_CONFIG.BACKEND_URL}/api/fileUpload/uploadBase64File`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                base64File: base64,
                mimeType: mimeType,
                fileName: name,
                clientId: clientId,
                fileType: fileType
            }),
        });
        const response = await request.json();
        if (response.success) {
            logDebug("File upload:", {
                key: response.key,
                location: response.location,
                filename: name
            });
            return response.location;
        } else {
            throw new Error(MESSAGES.HELPER.UPLOAD.ERROR);
        }
    } catch (error) {
        console.error('Error sending file to server:', error);
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.ERROR);
        throw error;
    }
}

// Handle video file upload
export async function handleFileUpload(event, { uploadArea, spinner, uploadIcon, checkmarkIcon }, clientId = 'anonymous') {
    const file = event.target.files[0];
    const fileType = 'video';
    if (!file) return { success: false };

    sendGAEvent('file_upload_initiated', {
        event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
        event_label: 'File Upload Process',
        file_type: fileType,
        original_file_name: file.name,
        original_file_size: file.size,
        original_file_mime_type: file.type
    });
    
    // Clear any existing file first
    await clearExistingFile('VIDEO_LOAD', "video");
    
    // Hide upload icon and show spinner
    uploadIcon.style.display = 'none';
    spinner.style.display = 'block';
    
    try {
        // Check if file needs conversion before validation
        const conversionCheck = needsConversion(file);
        let wasConverted = false;
        
        // Process and potentially convert the file
        let processedFile = file;
        let conversionResult = null;
        
        if (conversionCheck.needsConversion) {
            logDebug(`File needs conversion: ${file.name}`, conversionCheck);
            sendGAEvent('file_conversion_needed', {
                event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                event_label: 'File Conversion Process',
                file_type: fileType,
                original_file_name: file.name
            });
            
            // Convert file if needed
            conversionResult = await processFile(file);
            
            if (!conversionResult.success) {
                sendGAEvent('file_conversion_failed', {
                    event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                    event_label: 'File Conversion Process',
                    file_type: fileType,
                    original_file_name: file.name,
                    failure_reason: conversionResult.error || 'Unknown conversion error'
                });
                throw new Error(`Conversion failed: ${conversionResult.error}`);
            }
            
            processedFile = conversionResult.file;
            
            if (conversionResult.wasConverted) {
                wasConverted = true;
                sendGAEvent('file_conversion_successful', {
                    event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                    event_label: 'File Conversion Process',
                    file_type: fileType,
                    original_file_name: file.name,
                    converted_file_name: processedFile.name,
                    converted_file_size: processedFile.size
                });
                logDebug(`File converted: ${file.name} → ${processedFile.name}`);
                state.setCurrentHelperText(`File converted: ${file.name} → ${processedFile.name}`);
            }
        }
        
        // Validate the file (original or converted)
        const validation = validateFile(processedFile, fileType);
        if (!validation.valid) {
            sendGAEvent('file_upload_failed', {
                event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                event_label: 'File Upload Process',
                file_type: fileType,
                processed_file_name: processedFile.name,
                failure_reason: `Validation: ${validation.reason}`
            });
            showToastNotification(validation.reason, 'error');
            // Hide spinner and show upload icon again in case of error
            spinner.style.display = 'none';
            uploadIcon.style.display = 'block';
            return { success: false, error: validation.reason };
        }
        
        // Show warnings
        if (validation.warnings.length > 0) {
            state.setCurrentHelperText(validation.warnings[0]);
        }
        
        // Store locally
        const nodeInfo = {
            nodeId: 'VIDEO_LOAD',
            inputName: "video"
        };
        
        const storageResult = await storeFile('video', processedFile, nodeInfo);
        if (!storageResult.success) {
            throw new Error(`Failed to store file: ${storageResult.error}`);
        }
        
        // Update UI
        uploadArea.querySelector('.upload-icon').style.display = 'none';
        checkmarkIcon.style.display = 'none';
        uploadArea.setAttribute('data-filename', processedFile.name);
        
        // Create and display video preview
        const videoPreview = document.createElement('video');
        videoPreview.className = 'input-video-preview';
        videoPreview.src = URL.createObjectURL(processedFile);
        videoPreview.loop = true;
        videoPreview.muted = true;
        videoPreview.autoplay = true;
        videoPreview.playsInline = true;
        videoPreview.style.maxWidth = '100%';
        videoPreview.style.maxHeight = '100%';
        videoPreview.style.borderRadius = '15px';
        videoPreview.style.objectFit = 'contain';
        uploadArea.appendChild(videoPreview);
        
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.FILE_SELECTED(processedFile.name));

        sendGAEvent('file_upload_successful', {
            event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
            event_label: 'File Upload Process',
            file_type: fileType,
            processed_file_name: processedFile.name,
            processed_file_size: processedFile.size,
            processed_file_mime_type: processedFile.type,
            was_converted: wasConverted,
            storage_id: storageResult.id
        });
        
        return {
            success: true,
            file: processedFile,
            storageId: storageResult.id
        };
    } catch (error) {
        sendGAEvent('file_upload_failed', {
            event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
            event_label: 'File Upload Process',
            file_type: fileType,
            original_file_name: file.name, // Use original file name if processedFile might not be defined
            failure_reason: error.message || 'Unknown error during upload handling'
        });
        console.error('Error handling file:', error);
        showToastNotification(`Error: ${error.message || 'Failed to process file'}`, 'error');
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.ERROR);
        
        // Hide spinner and show upload icon again in case of error
        spinner.style.display = 'none';
        uploadIcon.style.display = 'block';
        
        return { success: false };
    } finally {
        // Hide spinner if it's still showing
        spinner.style.display = 'none';
    }
}

// Handle style image upload
export async function handleStyleUpload(event, { styleUploadArea, stylePreview, uploadIcon }, clientId = 'anonymous') {
    const file = event.target.files[0];
    const fileType = 'style_image';
    if (!file) return { success: false };

    sendGAEvent('file_upload_initiated', {
        event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
        event_label: 'File Upload Process',
        file_type: fileType,
        original_file_name: file.name,
        original_file_size: file.size,
        original_file_mime_type: file.type
    });
    
    // Clear any existing file first
    await clearExistingFile('STYLE_INPUT', "image");
    
    try {
        // Check if file needs conversion
        const conversionCheck = needsConversion(file);
        let wasConverted = false;
        
        // Process and potentially convert the file
        let processedFile = file;
        
        if (conversionCheck.needsConversion) {
            logDebug(`Style image needs conversion: ${file.name}`, conversionCheck);
            sendGAEvent('file_conversion_needed', {
                event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                event_label: 'File Conversion Process',
                file_type: fileType,
                original_file_name: file.name
            });
            
            // Show conversion feedback
            state.setCurrentHelperText(`Converting ${file.name}...`);
            
            // Convert file if needed
            const conversionResult = await processFile(file);
            
            if (!conversionResult.success) {
                sendGAEvent('file_conversion_failed', {
                    event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                    event_label: 'File Conversion Process',
                    file_type: fileType,
                    original_file_name: file.name,
                    failure_reason: conversionResult.error || 'Unknown conversion error'
                });
                throw new Error(`Conversion failed: ${conversionResult.error}`);
            }
            
            processedFile = conversionResult.file;
            
            if (conversionResult.wasConverted) {
                wasConverted = true;
                sendGAEvent('file_conversion_successful', {
                    event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                    event_label: 'File Conversion Process',
                    file_type: fileType,
                    original_file_name: file.name,
                    converted_file_name: processedFile.name,
                    converted_file_size: processedFile.size
                });
                logDebug(`Style image converted: ${file.name} → ${processedFile.name}`);
            }
        }
        
        // Validate the file (original or converted)
        const validation = validateFile(processedFile, 'image'); // Assuming 'image' is the correct type for validation
        if (!validation.valid) {
            sendGAEvent('file_upload_failed', {
                event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                event_label: 'File Upload Process',
                file_type: fileType,
                processed_file_name: processedFile.name,
                failure_reason: `Validation: ${validation.reason}`
            });
            showToastNotification(validation.reason, 'error');
            return { success: false, error: validation.reason };
        }
        
        // Store locally
        const nodeInfo = {
            nodeId: 'STYLE_INPUT',
            inputName: "image"
        };
        
        const storageResult = await storeFile('style', processedFile, nodeInfo);
        if (!storageResult.success) {
            throw new Error(`Failed to store file: ${storageResult.error}`);
        }
        
        // Update UI
        stylePreview.src = URL.createObjectURL(processedFile);
        stylePreview.style.display = 'block';
        uploadIcon.style.display = 'none';
        
        const displayName = processedFile.name;
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.FILE_SELECTED(displayName));

        sendGAEvent('file_upload_successful', {
            event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
            event_label: 'File Upload Process',
            file_type: fileType,
            processed_file_name: processedFile.name,
            processed_file_size: processedFile.size,
            processed_file_mime_type: processedFile.type,
            was_converted: wasConverted,
            storage_id: storageResult.id
        });
        
        return {
            success: true,
            file: processedFile,
            originalFile: file !== processedFile ? file : null,
            storageId: storageResult.id
        };
    } catch (error) {
        sendGAEvent('file_upload_failed', {
            event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
            event_label: 'File Upload Process',
            file_type: fileType,
            original_file_name: file.name,
            failure_reason: error.message || 'Unknown error during style upload'
        });
        console.error('Error handling style file:', error);
        showToastNotification(`Error: ${error.message || 'Failed to process file'}`, 'error');
        
        // Reset UI
        stylePreview.style.display = 'none';
        uploadIcon.style.display = 'block';
        
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.ERROR);
        return { success: false };
    }
}

// Handle face image upload
export async function handleFaceUpload(event, { faceUploadArea, facePreview, uploadIcon }, clientId = 'anonymous') {
    const file = event.target.files[0];
    const fileType = 'face_image';
    if (!file) return { success: false };

    sendGAEvent('file_upload_initiated', {
        event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
        event_label: 'File Upload Process',
        file_type: fileType,
        original_file_name: file.name,
        original_file_size: file.size,
        original_file_mime_type: file.type
    });
    
    // Clear any existing file first
    await clearExistingFile('FACE_INPUT', "image");
    
    try {
        // Check if file needs conversion
        const conversionCheck = needsConversion(file);
        let wasConverted = false;
        
        // Process and potentially convert the file
        let processedFile = file;
        
        if (conversionCheck.needsConversion) {
            logDebug(`Face image needs conversion: ${file.name}`, conversionCheck);
            sendGAEvent('file_conversion_needed', {
                event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                event_label: 'File Conversion Process',
                file_type: fileType,
                original_file_name: file.name
            });
            
            // Show conversion feedback
            state.setCurrentHelperText(`Converting ${file.name}...`);
            
            // Convert file if needed
            const conversionResult = await processFile(file);
            
            if (!conversionResult.success) {
                sendGAEvent('file_conversion_failed', {
                    event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                    event_label: 'File Conversion Process',
                    file_type: fileType,
                    original_file_name: file.name,
                    failure_reason: conversionResult.error || 'Unknown conversion error'
                });
                throw new Error(`Conversion failed: ${conversionResult.error}`);
            }
            
            processedFile = conversionResult.file;
            
            if (conversionResult.wasConverted) {
                wasConverted = true;
                sendGAEvent('file_conversion_successful', {
                    event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                    event_label: 'File Conversion Process',
                    file_type: fileType,
                    original_file_name: file.name,
                    converted_file_name: processedFile.name,
                    converted_file_size: processedFile.size
                });
                logDebug(`Face image converted: ${file.name} → ${processedFile.name}`);
            }
        }
        
        // Validate the file (original or converted)
        const validation = validateFile(processedFile, 'image'); // Assuming 'image'
        if (!validation.valid) {
            sendGAEvent('file_upload_failed', {
                event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                event_label: 'File Upload Process',
                file_type: fileType,
                processed_file_name: processedFile.name,
                failure_reason: `Validation: ${validation.reason}`
            });
            showToastNotification(validation.reason, 'error');
            return { success: false, error: validation.reason };
        }
        
        // Store locally
        const nodeInfo = {
            nodeId: 'FACE_INPUT',
            inputName: "image"
        };
        
        const storageResult = await storeFile('face', processedFile, nodeInfo);
        if (!storageResult.success) {
            throw new Error(`Failed to store file: ${storageResult.error}`);
        }
        
        // Update UI
        facePreview.src = URL.createObjectURL(processedFile);
        facePreview.style.display = 'block';
        uploadIcon.style.display = 'none';
        
        const displayName = processedFile.name;
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.FILE_SELECTED(displayName));

        sendGAEvent('file_upload_successful', {
            event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
            event_label: 'File Upload Process',
            file_type: fileType,
            processed_file_name: processedFile.name,
            processed_file_size: processedFile.size,
            processed_file_mime_type: processedFile.type,
            was_converted: wasConverted,
            storage_id: storageResult.id
        });
        
        return {
            success: true,
            file: processedFile,
            originalFile: file !== processedFile ? file : null,
            storageId: storageResult.id
        };
    } catch (error) {
        sendGAEvent('file_upload_failed', {
            event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
            event_label: 'File Upload Process',
            file_type: fileType,
            original_file_name: file.name,
            failure_reason: error.message || 'Unknown error during face upload'
        });
        console.error('Error handling face file:', error);
        showToastNotification(`Error: ${error.message || 'Failed to process file'}`, 'error');
        
        // Reset UI
        facePreview.style.display = 'none';
        uploadIcon.style.display = 'block';
        
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.ERROR);
        return { success: false };
    }
}

// Handle body image upload
export async function handleBodyUpload(event, { bodyUploadArea, bodyPreview, uploadIcon }, clientId = 'anonymous') {
    const file = event.target.files[0];
    const fileType = 'body_image';
    if (!file) return { success: false };

    sendGAEvent('file_upload_initiated', {
        event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
        event_label: 'File Upload Process',
        file_type: fileType,
        original_file_name: file.name,
        original_file_size: file.size,
        original_file_mime_type: file.type
    });
    
    // Clear any existing file first
    await clearExistingFile('BODY_IMAGE', "image");
    
    try {
        // Check if file needs conversion
        const conversionCheck = needsConversion(file);
        let wasConverted = false;
        
        // Process and potentially convert the file
        let processedFile = file;
        
        if (conversionCheck.needsConversion) {
            logDebug(`Body image needs conversion: ${file.name}`, conversionCheck);
            sendGAEvent('file_conversion_needed', {
                event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                event_label: 'File Conversion Process',
                file_type: fileType,
                original_file_name: file.name
            });
            
            // Show conversion feedback
            state.setCurrentHelperText(`Converting ${file.name}...`);
            
            // Convert file if needed
            const conversionResult = await processFile(file);
            
            if (!conversionResult.success) {
                sendGAEvent('file_conversion_failed', {
                    event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                    event_label: 'File Conversion Process',
                    file_type: fileType,
                    original_file_name: file.name,
                    failure_reason: conversionResult.error || 'Unknown conversion error'
                });
                throw new Error(`Conversion failed: ${conversionResult.error}`);
            }
            
            processedFile = conversionResult.file;
            
            if (conversionResult.wasConverted) {
                wasConverted = true;
                sendGAEvent('file_conversion_successful', {
                    event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                    event_label: 'File Conversion Process',
                    file_type: fileType,
                    original_file_name: file.name,
                    converted_file_name: processedFile.name,
                    converted_file_size: processedFile.size
                });
                logDebug(`Body image converted: ${file.name} → ${processedFile.name}`);
            }
        }
        
        // Validate the file (original or converted)
        const validation = validateFile(processedFile, 'image'); // Assuming 'image'
        if (!validation.valid) {
            sendGAEvent('file_upload_failed', {
                event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
                event_label: 'File Upload Process',
                file_type: fileType,
                processed_file_name: processedFile.name,
                failure_reason: `Validation: ${validation.reason}`
            });
            showToastNotification(validation.reason, 'error');
            return { success: false, error: validation.reason };
        }
        
        // Store locally
        const nodeInfo = {
            nodeId: 'BODY_IMAGE',
            inputName: "image"
        };
        
        const storageResult = await storeFile('body', processedFile, nodeInfo);
        if (!storageResult.success) {
            throw new Error(`Failed to store file: ${storageResult.error}`);
        }
        
        // Update UI
        bodyPreview.src = URL.createObjectURL(processedFile);
        bodyPreview.style.display = 'block';
        uploadIcon.style.display = 'none';
        
        const displayName = processedFile.name;
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.FILE_SELECTED(displayName));

        sendGAEvent('file_upload_successful', {
            event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
            event_label: 'File Upload Process',
            file_type: fileType,
            processed_file_name: processedFile.name,
            processed_file_size: processedFile.size,
            processed_file_mime_type: processedFile.type,
            was_converted: wasConverted,
            storage_id: storageResult.id
        });
        
        return {
            success: true,
            file: processedFile,
            originalFile: file !== processedFile ? file : null,
            storageId: storageResult.id
        };
    } catch (error) {
        sendGAEvent('file_upload_failed', {
            event_category: GA_EVENT_CATEGORIES.FILE_MANAGEMENT,
            event_label: 'File Upload Process',
            file_type: fileType,
            original_file_name: file.name,
            failure_reason: error.message || 'Unknown error during body image upload'
        });
        console.error('Error handling body image file:', error);
        showToastNotification(`Error: ${error.message || 'Failed to process file'}`, 'error');
        
        // Reset UI
        bodyPreview.style.display = 'none';
        uploadIcon.style.display = 'block';
        
        state.setCurrentHelperText(MESSAGES.HELPER.UPLOAD.ERROR);
        return { success: false };
    }
}

/**
 * Check if a video has been uploaded
 * @returns {boolean} - Whether a video is uploaded
 */
export function isVideoUploaded() {
    const workflow = state.getWorkflow();
    if (!workflow || !workflow['VIDEO_LOAD'] || !workflow['VIDEO_LOAD'].inputs.video) {
        return false;
    }
    
    return isPendingFilePlaceholder(workflow['VIDEO_LOAD'].inputs.video);
}


