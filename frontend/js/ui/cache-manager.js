/**
 * Cache Manager for Vidia
 * Provides functions to clear browser-stored files
 */

import { clearAllFiles, clearFilesByType } from './localFileStorage.js';
import { createLogger } from '../utils/logger.js';

const logDebug = createLogger('CacheManager');

/**
 * Initialize cache management functionality
 * @returns {Object} Cache management methods
 */
export function initializeCacheManager() {
    // Get DOM elements
    const clearBodyFilesBtn = document.getElementById('clearBodyFilesBtn');
    const clearFaceFilesBtn = document.getElementById('clearFaceFilesBtn');
    const clearStyleFilesBtn = document.getElementById('clearStyleFilesBtn');
    const clearVideoFilesBtn = document.getElementById('clearVideoFilesBtn');
    const clearAllFilesBtn = document.getElementById('clearAllFilesBtn');
    const cacheStatus = document.getElementById('cacheStatus');
    
    // Bind event handlers
    if (clearBodyFilesBtn) {
        clearBodyFilesBtn.addEventListener('click', () => handleClearFiles('body'));
    }
    
    if (clearFaceFilesBtn) {
        clearFaceFilesBtn.addEventListener('click', () => handleClearFiles('face'));
    }
    
    if (clearStyleFilesBtn) {
        clearStyleFilesBtn.addEventListener('click', () => handleClearFiles('style'));
    }
    
    if (clearVideoFilesBtn) {
        clearVideoFilesBtn.addEventListener('click', () => handleClearFiles('video'));
    }
    
    if (clearAllFilesBtn) {
        clearAllFilesBtn.addEventListener('click', handleClearAllFiles);
    }
    
    /**
     * Handle clearing files of a specific type
     * @param {string} fileType - Type of files to clear ('body', 'face', 'style', 'video')
     */
    async function handleClearFiles(fileType) {
        try {
            logDebug(`Clearing ${fileType} files from browser storage`);
            
            // Show pending status
            showStatus(`Clearing ${fileType} files...`);
            
            // Clear files
            await clearFilesByType(fileType);
            
            // Show success message
            showStatus(`${capitalize(fileType)} files cleared successfully`, 'success');
            
            logDebug(`${fileType} files cleared successfully`);
        } catch (error) {
            console.error(`Error clearing ${fileType} files:`, error);
            showStatus(`Error clearing ${fileType} files: ${error.message}`, 'error');
        }
    }
    
    /**
     * Handle clearing all files
     */
    async function handleClearAllFiles() {
        try {
            // Confirm with the user
            if (!confirm('Are you sure you want to clear all cached files? This will remove all uploaded images and videos from browser storage.')) {
                return;
            }
            
            logDebug('Clearing all files from browser storage');
            
            // Show pending status
            showStatus('Clearing all cached files...');
            
            // Clear all files
            await clearAllFiles();
            
            // Show success message
            showStatus('All cached files cleared successfully', 'success');
            
            logDebug('All files cleared successfully');
        } catch (error) {
            console.error('Error clearing all files:', error);
            showStatus(`Error clearing files: ${error.message}`, 'error');
        }
    }
    
    /**
     * Show status message
     * @param {string} message - Message to display
     * @param {string} type - Message type ('success' or 'error')
     */
    function showStatus(message, type = '') {
        if (!cacheStatus) return;
        
        cacheStatus.textContent = message;
        cacheStatus.className = 'admin-status';
        
        if (type === 'success') {
            cacheStatus.classList.add('admin-status-success');
        } else if (type === 'error') {
            cacheStatus.classList.add('admin-status-error');
        }
        
        cacheStatus.classList.remove('admin-hidden');
        
        // Hide after 3 seconds
        setTimeout(() => {
            cacheStatus.classList.add('admin-hidden');
        }, 3000);
    }
    
    /**
     * Capitalize first letter of a string
     * @param {string} str - String to capitalize
     * @returns {string} Capitalized string
     */
    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    
    return {
        clearFilesByType: handleClearFiles,
        clearAllFiles: handleClearAllFiles
    };
}


