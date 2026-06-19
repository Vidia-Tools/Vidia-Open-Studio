// Import dependencies
import { createLogger } from '../utils/logger.js';

const logDebug = createLogger('LocalStorage');

const DB_NAME = 'vidia-file-storage';
const DB_VERSION = 1;
const STORE_NAME = 'pending-files';

// Initialize database
let dbPromise = null;

/**
 * Open or create the IndexedDB database
 * @returns {Promise<IDBDatabase>} - A promise that resolves to the database instance
 */
async function openDatabase() {
    if (dbPromise) return dbPromise;
    
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };
        
        request.onsuccess = (event) => {
            logDebug('IndexedDB opened successfully');
            resolve(event.target.result);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create object store if it doesn't exist
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('fileType', 'fileType', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                logDebug('Created pending-files object store');
            }
        };
    });
    
    return dbPromise;
}

/**
 * Store a file locally for later upload
 * @param {string} fileType - Type of file ('video', 'style', or 'face')
 * @param {File} file - The file to store
 * @param {Object} nodeInfo - Information about which node will use this file
 * @returns {Promise<Object>} - Result of the storage operation
 */
export async function storeFile(fileType, file, nodeInfo) {
    try {
        const db = await openDatabase();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        const id = `${fileType}-${Date.now()}`;
        const fileEntry = {
            id,
            fileType, // 'video', 'style', or 'face'
            file,
            nodeInfo: nodeInfo || null, // Info about which node will use this file
            timestamp: Date.now()
        };
        
        await new Promise((resolve, reject) => {
            const request = store.put(fileEntry);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
        
        logDebug(`File stored locally: ${id}`, { fileType, fileName: file.name, size: file.size });
        
        return {
            success: true,
            id
        };
    } catch (error) {
        console.error('Error storing file:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Retrieve a specific file by ID
 * @param {string} id - The file ID
 * @returns {Promise<Object>} - The file entry or null if not found
 */
export async function getFile(id) {
    try {
        const db = await openDatabase();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        
        const fileEntry = await new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
        
        if (fileEntry) {
            logDebug(`Retrieved file: ${id}`, { fileType: fileEntry.fileType, fileName: fileEntry.file.name });
            return {
                success: true,
                fileEntry
            };
        } else {
            logDebug(`File not found: ${id}`);
            return {
                success: false,
                error: 'File not found'
            };
        }
    } catch (error) {
        console.error('Error retrieving file:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Retrieve all pending files
 * @returns {Promise<Array>} - Array of file entries
 */
export async function getAllPendingFiles() {
    try {
        const db = await openDatabase();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        
        const files = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
        
        logDebug(`Retrieved ${files.length} pending files`);
        return files;
    } catch (error) {
        console.error('Error retrieving pending files:', error);
        return [];
    }
}

/**
 * Clear a file after successful upload
 * @param {string} id - The file ID to clear
 * @returns {Promise<boolean>} - Success status
 */
export async function clearFile(id) {
    try {
        const db = await openDatabase();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        await new Promise((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
        
        logDebug(`Cleared file: ${id}`);
        return true;
    } catch (error) {
        console.error('Error clearing file:', error);
        return false;
    }
}

/**
 * Clear all stored files (useful for cleanup)
 * @returns {Promise<boolean>} - Success status
 */
export async function clearAllFiles() {
    try {
        const db = await openDatabase();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        await new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
        
        logDebug('Cleared all pending files');
        return true;
    } catch (error) {
        console.error('Error clearing all files:', error);
        return false;
    }
}

/**
 * Clear all files of a specific type (e.g., 'body', 'face', 'style', 'video')
 * @param {string} fileType - The type of files to clear
 * @returns {Promise<boolean>} - Success status
 */
export async function clearFilesByType(fileType) {
    try {
        const db = await openDatabase();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('fileType');
        
        // Get all files of the specified type
        const files = await new Promise((resolve, reject) => {
            const request = index.getAll(fileType);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
        
        // Delete each file
        for (const file of files) {
            await new Promise((resolve, reject) => {
                const request = store.delete(file.id);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        }
        
        logDebug(`Cleared ${files.length} ${fileType} files`);
        return true;
    } catch (error) {
        console.error(`Error clearing ${fileType} files:`, error);
        return false;
    }
}

/**
 * Check if a placeholder URL represents a pending file
 * @param {string} url - The URL to check
 * @returns {boolean} - True if it's a pending file placeholder
 */
export function isPendingFilePlaceholder(url) {
    return typeof url === 'string' && url.startsWith('pending-upload-');
}

/**
 * Extract file ID from a placeholder URL
 * @param {string} url - The placeholder URL
 * @returns {string|null} - The file ID or null if not a valid placeholder
 */
export function getFileIdFromPlaceholder(url) {
    if (!isPendingFilePlaceholder(url)) return null;
    return url.replace('pending-upload-', '');
}


