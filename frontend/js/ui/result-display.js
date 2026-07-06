// Import dependencies
import { createLogger } from '../utils/logger.js';
import { MESSAGES } from '../config/helper-messages.js';
import { updateNotification } from './helpers.js';
import { getSession } from '../session.js';

const logDebug = createLogger('Result Display');

// Clear result display area (call when starting a new generation)
export function clearResult() {
    const resultContent = document.querySelector('.result-content');
    const animationContainer = document.querySelector('.animation-container');
    if (resultContent) {
        resultContent.innerHTML = '';
        resultContent.style.opacity = '0';
        resultContent.classList.remove('visible');
    }
    if (animationContainer) {
        animationContainer.classList.remove('hidden');
        animationContainer.style.opacity = '1';
    }
    logDebug('Result display cleared');
}

// Display generation result
export function displayResult(videoUrl, resolvedSeed = null) {
    const animationContainer = document.querySelector('.animation-container');
    const resultContent = document.querySelector('.result-content');
    
    // First, properly fade out the animation container
    animationContainer.style.opacity = '0';
    
    // After animation fades out, show the result
    setTimeout(() => {
        // Hide animation container
        animationContainer.classList.add('hidden');
        
        // Clear and prepare result content
        resultContent.innerHTML = '';
        resultContent.style.opacity = '0';
        
        // Create video container
        const videoContainer = document.createElement('div');
        videoContainer.className = 'video-container';
        
        // Create and setup video element
        const videoElement = document.createElement('video');
        videoElement.controls = true;
        videoElement.autoplay = true;
        videoElement.loop = true;
        videoElement.preload = 'auto';
        videoElement.setAttribute('playsinline', '');
        videoElement.setAttribute('webkit-playsinline', '');
        videoElement.setAttribute('crossorigin', 'anonymous');
        videoElement.style.display = 'none'; // reveal after first playable event
        videoElement.style.width = '100%';
        videoElement.style.height = 'auto';
        // Prefer <source> with explicit type to help some browsers
        const sourceEl = document.createElement('source');
        sourceEl.src = videoUrl;
        sourceEl.type = 'video/mp4';
        videoElement.appendChild(sourceEl);
        
        // Add loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'video-loading';
        loadingIndicator.textContent = 'Loading video...';
        videoContainer.appendChild(loadingIndicator);
        
        // Handle video loading (be liberal about which events we accept)
        const showVideo = () => {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            videoElement.style.display = 'block';
            logDebug('Video loaded (first playable event)');
            // Note: Video history and email notification are now handled automatically by the backend
            // when the video upload completes on RunPod
        };
        ['loadeddata', 'loadedmetadata', 'canplay', 'playing'].forEach(evt => {
            videoElement.addEventListener(evt, showVideo, { once: true });
        });
        // Fallback in case events are delayed but playback has effectively started
        setTimeout(() => {
            if (videoElement.readyState >= 2 || !videoElement.paused) {
                showVideo();
            }
        }, 3000);
        
        // Handle video error
        videoElement.addEventListener('error', () => {
            loadingIndicator.innerHTML = `Error loading video. <a href="${videoUrl}" target="_blank" rel="noopener noreferrer">Open directly</a>`;
            loadingIndicator.style.color = '#ff4444';
            logDebug('Video load error');
            
            // Show error notification
            import('./helpers.js').then(module => {
                module.showErrorNotification(MESSAGES.NOTIFICATION.ERROR.VIDEO_LOAD_ERROR);
            });
        });
        
        videoContainer.appendChild(videoElement);
        resultContent.appendChild(videoContainer);
        
        // Add buttons after video
        addResultButtons(videoUrl);

        // Show the resolved seed (plan 10.5.5) so the run is reproducible.
        if (resolvedSeed !== null && resolvedSeed !== undefined) {
            const seedEl = document.createElement('div');
            seedEl.className = 'result-seed';
            seedEl.textContent = `Seed: ${resolvedSeed}`;
            resultContent.appendChild(seedEl);
            logDebug('Result resolved_seed displayed:', resolvedSeed);
        }

        // Fade in the result content
        requestAnimationFrame(() => {
            resultContent.style.opacity = '1';
            resultContent.classList.add('visible');
        });

        // Show expiry notification
        updateNotification(MESSAGES.NOTIFICATION.VIDEO_EXPIRY);
        
        logDebug('Result displayed:', videoUrl);
    }, 500); // Wait for animation fade out
}

/**
 * Display a local-mode output that is a filesystem path rather than a
 * browser-served URL. Browsers cannot load arbitrary filesystem paths as media
 * sources, so the path is shown as text with a copy button instead of a
 * <video>. This keeps local mode from crashing on a non-URL output_file.
 * @param {string|null} outputPath - Local filesystem path from app_server /generate
 * @param {number|null} resolvedSeed - Resolved seed for reproducibility
 */
export function displayLocalOutputPath(outputPath, resolvedSeed = null) {
    const animationContainer = document.querySelector('.animation-container');
    const resultContent = document.querySelector('.result-content');

    animationContainer.style.opacity = '0';

    setTimeout(() => {
        animationContainer.classList.add('hidden');
        resultContent.innerHTML = '';
        resultContent.style.opacity = '0';

        const info = document.createElement('div');
        info.className = 'video-container local-output-info';

        const heading = document.createElement('p');
        heading.textContent = 'Generation complete.';
        heading.style.fontWeight = '600';
        info.appendChild(heading);

        const pathRow = document.createElement('p');
        pathRow.className = 'local-output-path';
        pathRow.textContent = outputPath || 'No output path returned.';
        pathRow.style.wordBreak = 'break-all';
        pathRow.style.fontFamily = 'monospace';
        info.appendChild(pathRow);

        if (outputPath) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'result-button';
            copyBtn.textContent = 'Copy path';
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(outputPath);
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = 'Copy path'; }, 2000);
                } catch (err) {
                    console.error('Failed to copy output path:', err);
                }
            });
            info.appendChild(copyBtn);
        }

        resultContent.appendChild(info);

        if (resolvedSeed !== null && resolvedSeed !== undefined) {
            const seedEl = document.createElement('div');
            seedEl.className = 'result-seed';
            seedEl.textContent = `Seed: ${resolvedSeed}`;
            resultContent.appendChild(seedEl);
        }

        requestAnimationFrame(() => {
            resultContent.style.opacity = '1';
            resultContent.classList.add('visible');
        });

        updateNotification(MESSAGES.NOTIFICATION.VIDEO_EXPIRY);
        logDebug('Local output path displayed:', outputPath);
    }, 500);
}

// Create download button
function createDownloadButton(videoUrl) {
    const downloadButton = document.createElement('a');
    downloadButton.href = videoUrl;
    downloadButton.download = 'vidia.mp4';
    downloadButton.className = 'result-button download-button';
    downloadButton.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Download
    `;
    return downloadButton;
}

// Create share button
function createShareButton(videoUrl) {
    const shareButton = document.createElement('button');
    shareButton.className = 'result-button share-button';
    shareButton.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
        </svg>
        Share
    `;
    
    shareButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(videoUrl);
            
            // Show success feedback
            const originalText = shareButton.innerHTML;
            shareButton.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 6L9 17l-5-5"></path>
                </svg>
                Copied!
            `;
            shareButton.classList.add('success');
            
            // Reset button after 3 seconds and open Discord channel
            setTimeout(() => {
                shareButton.innerHTML = originalText;
                shareButton.classList.remove('success');
                
                // Open Discord channel in a new tab
                window.open('https://discord.gg/dUQtDTunks', '_blank');
            }, 3000);

            logDebug('Video URL copied to clipboard');
        } catch (err) {
            console.error('Failed to copy URL:', err);
            alert('Failed to copy URL to clipboard');
        }
    });
    
    return shareButton;
}

// Add result buttons
function addResultButtons(videoUrl) {
    const resultContent = document.querySelector('.result-content');
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'result-buttons';
    
    // Add download button
    const downloadButton = createDownloadButton(videoUrl);
    // Add share button
    const shareButton = createShareButton(videoUrl);
    
    buttonsContainer.appendChild(downloadButton);
    buttonsContainer.appendChild(shareButton);
    resultContent.appendChild(buttonsContainer);
}

/**
 * Saves video URL to user's history if they're logged in
 * @param {string} videoUrl - URL of the video to save
 * @param {boolean} sendNotification - Whether to trigger an email notification
 */
async function saveVideoToHistory(videoUrl, sendNotification = true) {
    try {
        // Check if user is logged in
        const session = getSession();
        if (!session?.token || !session?.user?.userId) {
            logDebug('User not logged in, skipping history save');
            return;
        }
        
        const userId = session.user.userId;
        logDebug(`Saving video to history for user ${userId}`);
        
        logDebug(`EMAIL: Sending request with notification=${sendNotification} to backend`, { userId, videoUrl });
        
        // Send request to backend to store video
        const response = await fetch(`${window.APP_CONFIG.BACKEND_URL}/api/videos/store`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: userId,
                videoUrl: videoUrl,
                title: 'Video Generation',
                sendNotification: sendNotification // Add notification flag
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to save to history: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        logDebug('Video saved to history successfully', data);
        logDebug('EMAIL: Received response from history save with notification', { success: data.success });
    } catch (error) {
        // Just log the error, don't show notification to user
        console.error('Error saving video to history:', error);
        logDebug('Error saving video to history', error.message);
    }
}


