import { getSession } from "../session.js";
import { showToastNotification } from "../ui/helpers.js";
import { createLogger } from '../utils/logger.js';

const logDebug = createLogger('History');

// Default placeholder and error images using existing assets
const DEFAULT_THUMBNAIL_PLACEHOLDER = '/assets/icon2.svg';
const DEFAULT_THUMBNAIL_ERROR = '/assets/icon2.svg';

// Thumbnail generation queue and active generation tracking
const thumbnailQueue = [];
let activeThumbnailGenerations = 0;
const MAX_CONCURRENT_GENERATIONS = 2;

/**
 * Open history modal and load user's generation history
 */
export async function openHistoryModal() {
  const response = await fetch("/history-modal.html");
  const modalContent = await response.text();
  
  // Create a container element if it doesn't exist already
  let modalElement = document.getElementById("historyModal");
  if (!modalElement) {
    modalElement = document.createElement('div');
    modalElement.id = "historyModal";
    document.body.appendChild(modalElement);
  }
  
  modalElement.innerHTML = modalContent;
  modalElement.style.display = "block";
  
  // Initialize the history modal
  initializeHistoryModal();
  
  // Load user's generation history
  loadGenerationHistory();
}

/**
 * Close the history modal
 */
export function closeHistoryModal() {
  const modalElement = document.getElementById("historyModal");
  if (modalElement) {
    modalElement.style.display = "none";
  }
}

/**
 * Initialize history modal event listeners
 */
function initializeHistoryModal() {
  // Add event listener for the close button
  const closeButton = document.querySelector("#historyModal .close");
  if (closeButton) {
    closeButton.addEventListener("click", closeHistoryModal);
  }
  
  // Add event listener for clicking outside the modal
  const modal = document.querySelector("#historyModal .modal");
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeHistoryModal();
      }
    });
  }
}

/**
 * Load the user's generation history
 */
async function loadGenerationHistory() {
  const loadingElement = document.getElementById("loadingHistory");
  const emptyElement = document.getElementById("emptyHistory");
  const listElement = document.getElementById("historyList");
  
  // Ensure elements exist
  if (!loadingElement || !emptyElement || !listElement) {
    showToastNotification("Error loading history view", "error");
    return;
  }
  
  // Show loading state, hide other states
  loadingElement.style.display = "block";
  emptyElement.style.display = "none";
  listElement.style.display = "none";
  
  try {
    // Get session data to verify user is logged in
    const session = getSession();
    if (!session?.token || !session?.user?.userId) {
      showToastNotification("Please log in to view your history", "warning");
      closeHistoryModal();
      return;
    }
    
    // Fetch user's video history from the backend
    const userId = session.user.userId;
    const response = await fetch(`${window.APP_CONFIG.BACKEND_URL}/api/videos/user/${userId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${session.token}`,
        "Content-Type": "application/json"
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to load history: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const videos = data.videos || [];
    
    // Log the received data
    logDebug("Video history data received", videos);
    
    // Check if there are any videos
    if (videos.length === 0) {
      loadingElement.style.display = "none";
      emptyElement.style.display = "block";
      emptyElement.innerHTML = "<p>No videos found.</p><p>Generate a new video to get started!</p>";
      return;
    }
    
    // Process and display the videos
    displayVideos(videos, listElement);
    
    // Hide loading, show list
    loadingElement.style.display = "none";
    listElement.style.display = "block";
    
  } catch (error) {
    logDebug("Error loading generation history", error);
    showToastNotification("Failed to load your generation history", "error");
    loadingElement.style.display = "none";
    
    // Show empty state as fallback
    emptyElement.style.display = "block";
  }
}

/**
 * Generate a thumbnail from a video URL
 * @param {string} videoUrl - URL of the video
 * @param {string} thumbnailId - Unique ID for this thumbnail
 * @returns {Promise<string>} - Promise resolving to thumbnail data URL
 */
async function generateThumbnail(videoUrl, thumbnailId) {
  try {
    return new Promise((resolve, reject) => {
      // Create a video element to load the video
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous'; // For CORS videos
      video.preload = 'metadata'; // Only load metadata initially
      
      // Set up video event handlers
      video.onloadedmetadata = () => {
        // Once metadata is loaded, seek to a frame
        video.currentTime = 0.1; // Slightly after start for better thumbnail
      };
      
      video.onseeked = () => {
        try {
          // Create canvas and draw the video frame
          const canvas = document.createElement('canvas');
          canvas.width = 320;  // Thumbnail width
          canvas.height = 180; // Thumbnail height (16:9 ratio)
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Get the data URL
          const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
          
          // Clean up
          video.pause();
          video.src = '';
          video.load();
          
          logDebug(`Generated thumbnail for ${thumbnailId}`);
          resolve(thumbnailUrl);
        } catch (e) {
          reject(e);
        }
      };
      
      // Handle errors
      video.onerror = (e) => {
        logDebug(`Error loading video for thumbnail: ${thumbnailId}`, e);
        reject(new Error("Could not load video for thumbnail generation"));
      };
      
      // Start loading the video
      video.src = videoUrl;
      video.load();
      
      // Set a timeout to prevent hanging
      setTimeout(() => {
        if (video.readyState < 2) { // HAVE_CURRENT_DATA
          reject(new Error("Timeout loading video"));
        }
      }, 10000); // 10 second timeout
    });
  } catch (error) {
    logDebug('Error generating thumbnail:', error);
    throw error;
  }
}

/**
 * Process the thumbnail generation queue
 */
function processThumbnailQueue() {
  if (thumbnailQueue.length === 0 || activeThumbnailGenerations >= MAX_CONCURRENT_GENERATIONS) {
    return;
  }
  
  // Process the next thumbnail in the queue
  const thumbnailInfo = thumbnailQueue.shift();
  activeThumbnailGenerations++;
  
  logDebug(`Processing thumbnail for ${thumbnailInfo.id} (${activeThumbnailGenerations}/${MAX_CONCURRENT_GENERATIONS} active)`);
  
  generateThumbnail(thumbnailInfo.videoUrl, thumbnailInfo.id)
    .then(thumbnailUrl => {
      // Update thumbnail in the UI
      updateThumbnail(thumbnailInfo.id, thumbnailUrl);
    })
    .catch(error => {
      logDebug(`Thumbnail generation failed for ${thumbnailInfo.id}:`, error);
      // Set error image
      updateThumbnail(thumbnailInfo.id, DEFAULT_THUMBNAIL_ERROR);
    })
    .finally(() => {
      // Decrement active count and process next
      activeThumbnailGenerations--;
      processThumbnailQueue();
    });
}

/**
 * Update a thumbnail in the UI with generated image
 * @param {string} id - Thumbnail ID
 * @param {string} thumbnailUrl - Thumbnail data URL
 */
function updateThumbnail(id, thumbnailUrl) {
  const thumbnailImg = document.querySelector(`img[data-thumbnail-id="${id}"]`);
  if (thumbnailImg) {
    thumbnailImg.src = thumbnailUrl;
  }
}

/**
 * Display videos in the history list
 * @param {Array} videos - Array of video objects from the backend
 * @param {HTMLElement} listElement - The container element for the history list
 */
function displayVideos(videos, listElement) {
  // Clear the list first
  listElement.innerHTML = "";
  
  // Clear existing thumbnail queue and reset counters
  thumbnailQueue.length = 0;
  activeThumbnailGenerations = 0;
  
  // Sort videos by date (newest first)
  const sortedVideos = [...videos].sort((a, b) => b.createdAt - a.createdAt);
  
  // Create HTML for each video
  for (const video of sortedVideos) {
    // Format date
    const date = new Date(video.createdAt);
    const dateString = date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Generate a unique ID for this video item
    const thumbnailId = `thumbnail-${date.getTime()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create the history item HTML - with placeholder thumbnail
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    
    historyItem.innerHTML = `
      <div class="history-item-header">
        <div class="history-date">${dateString}</div>
      </div>
      <div class="history-item-content">
        <div class="history-thumbnail">
          <img src="${DEFAULT_THUMBNAIL_PLACEHOLDER}" alt="Video thumbnail" 
               data-thumbnail-id="${thumbnailId}"
               onerror="this.onerror=null; this.src='${DEFAULT_THUMBNAIL_ERROR}';">
        </div>
      </div>
      <div class="history-actions">
        <button class="history-button download-button" data-url="${video.videoUrl}">Save Video</button>
      </div>
    `;
    
    // Add event listeners for buttons
    addHistoryItemEventListeners(historyItem);
    
    // Add to list
    listElement.appendChild(historyItem);
    
    // Add to thumbnail generation queue
    thumbnailQueue.push({
      id: thumbnailId,
      videoUrl: video.videoUrl
    });
  }
  
  // Start processing the thumbnail queue
  setTimeout(() => {
    // Process in batches of MAX_CONCURRENT_GENERATIONS
    for (let i = 0; i < MAX_CONCURRENT_GENERATIONS; i++) {
      processThumbnailQueue();
    }
  }, 100);
  
  // Show the list
  listElement.style.display = "block";
}

/**
 * Add event listeners to a history item's buttons
 * @param {HTMLElement} historyItem - The history item element
 */
function addHistoryItemEventListeners(historyItem) {
  // Download button
  const downloadButton = historyItem.querySelector('.download-button');
  if (downloadButton) {
    downloadButton.addEventListener('click', () => {
      const videoUrl = downloadButton.dataset.url;
      if (videoUrl) {
        downloadVideo(videoUrl);
      }
    });
  }
}

/**
 * Download a video from a URL
 * @param {string} url - The video URL to download
 */
function downloadVideo(url) {
  // Create a temp anchor element for downloading
  const a = document.createElement('a');
  a.href = url;
  a.download = `vidia-video-${Date.now()}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Initialize the history button in the UI if the user is logged in
 */
export function initializeHistoryButton() {
  // Check if user is logged in
  const session = getSession();
  const isLoggedIn = session?.token && session?.user?.userId;
  
  // Find or create container for history button
  let authContainer = document.querySelector('.auth-buttons');
  
  // If container doesn't exist, create it
  if (!authContainer) {
    const menuContainer = document.querySelector('.menu-container');
    if (menuContainer) {
      authContainer = document.createElement('div');
      authContainer.className = 'auth-buttons';
      menuContainer.appendChild(authContainer);
    }
  }
  
  // Don't proceed if we couldn't find or create the container
  if (!authContainer) return;
  
  // Check if history button already exists
  let historyButton = document.getElementById('historyButton');
  
  // If logged in, add the history button
  if (isLoggedIn) {
    // Create button if it doesn't exist
    if (!historyButton) {
      historyButton = document.createElement('button');
      historyButton.id = 'historyButton';
      historyButton.className = 'history-nav-button';
      historyButton.textContent = 'History';
      historyButton.addEventListener('click', openHistoryModal);
      
      // Add to auth container
      authContainer.appendChild(historyButton);
      
      logDebug('History button added to UI');
    }
  } else {
    // If not logged in, remove the history button
    if (historyButton) {
      historyButton.remove();
      logDebug('History button removed from UI');
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeHistoryButton);

// Listen for auth state changes to update history button
document.addEventListener('authStateChanged', initializeHistoryButton);
