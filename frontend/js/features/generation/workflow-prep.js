// =============================================================================
// Generation: workflow-prep.js
// Uploads pending files to S3/R2 and records their URLs in params.files.* on the
// generation store (plan section 3). No node graph; the handler downloads
// files.* by slot at job start.
// =============================================================================

import * as store from '../../core/generation-store.js';
import { createLogger } from '../../utils/logger.js';
import { clearFile } from '../../ui/localFileStorage.js';
import { uploadToS3 } from '../../ui/s3Uploader.js';

const logDebug = createLogger('Generation:WorkflowPrep');

// Map an upload fileType to a pipeline input slot ([in_*], plan section 1).
const SLOT_BY_FILETYPE = {
    video: 'in_video',
    style: 'in_style_ref',
    face: 'in_face_image',
    faceVideo: 'in_face_video',
    body: 'in_ref_image',
    ref: 'in_ref_image',
};

function slotFor(pendingFile) {
    return SLOT_BY_FILETYPE[pendingFile.fileType] || `in_${pendingFile.fileType}`;
}

/**
 * Upload all pending files to S3 before generation, then record their public
 * URLs into params.files.* keyed by input slot.
 * @param {Array} pendingFiles
 * @param {string} generationId
 * @param {Function} progressCallback
 * @returns {Promise<Array>} upload results
 */
export async function uploadPendingFiles(pendingFiles, generationId, progressCallback) {
    const results = [];

    for (const pendingFile of pendingFiles) {
        logDebug(`Processing pending file: ${pendingFile.id}`, {
            fileType: pendingFile.fileType,
            fileName: pendingFile.file.name
        });

        const uploadResult = await uploadToS3(
            pendingFile.file,
            generationId,
            pendingFile.fileType,
            (progress) => { if (progressCallback) progressCallback(progress, pendingFile.fileType); }
        );

        if (!uploadResult.success) {
            throw new Error(`Failed to upload ${pendingFile.file.name}: ${uploadResult.error || 'Unknown error'}`);
        }

        const slot = slotFor(pendingFile);
        store.setFile(slot, uploadResult.url);
        results.push({ fileType: pendingFile.fileType, slot, placeholderId: pendingFile.id, url: uploadResult.url });
        logDebug('Recorded params.files slot', { slot, url: uploadResult.url });

        await clearFile(pendingFile.id);
    }

    return results;
}
