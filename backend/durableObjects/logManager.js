import { DEFAULT_CORS_HEADERS as corsHeaders } from '../middleware/cors.js';

/**
 * Helper function to create a JSON response with CORS headers
 * @param {Object|string} data - Data to be JSON-stringified
 * @param {number} status - HTTP status code
 * @param {Object} headers - Additional headers to include
 * @returns {Response} JSON response with CORS headers
 */
function jsonResponse(data, status = 200, headers = {}) {
	const body = typeof data === 'string' ? data : JSON.stringify(data);
	return new Response(body, {
		status,
		headers: { 
			...corsHeaders,
			'Content-Type': 'application/json',
			...headers
		}
	});
}

export class LogManager {
	constructor(state, env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request) {
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: corsHeaders
			});
		}
		
		const url = new URL(request.url);
		
		try {
			// Regular API logging endpoints
			if (url.pathname === '/api/logging/log' && request.method === 'POST') {
				const { log, context, type, userId } = await request.json();
				await this.saveLog(log, context, type, userId);
				return jsonResponse({ success: true, message: 'Log saved successfully' });
			} else if (url.pathname === '/api/logging/logs' && request.method === 'GET') {
				const { page = 1, limit = 10 } = Object.fromEntries(url.searchParams);
				return this.getLogs(page, limit);
			} 
			// Terminal logs endpoints
			else if (url.pathname === '/store-terminal-logs') {
				return this.storeTerminalLogs(request);
			} else if (url.pathname === '/list-emails-with-logs') {
				return this.listEmailsWithLogs();
			} else if (url.pathname === '/email-logs') {
				const email = url.searchParams.get('email');
				if (!email) {
					return jsonResponse({
						success: false,
						message: 'Email required'
					}, 400);
				}
				return this.getEmailLogs(email);
			} else if (url.pathname === '/generation-logs') {
				const generation_id = url.searchParams.get('generation_id');
				if (!generation_id) {
					return jsonResponse({
						success: false,
						message: 'Generation ID required'
					}, 400);
				}
				return this.getGenerationLogs(generation_id);
			} else if (url.pathname === '/clear-terminal-logs') {
				// New endpoint to clear terminal logs
				return this.clearTerminalLogs(request);
			} else if (url.pathname === '/get-all-terminal-logs') {
				// New endpoint to get all terminal logs regardless of email
				return this.getAllTerminalLogs();
			}
			
			return jsonResponse({ success: false, message: 'Not found' }, 404);
		} catch (error) {
			console.error('LogManager error:', error);
			return jsonResponse({ 
				success: false, 
				message: 'Error processing request',
				error: error.message
			}, 500);
		}
	}

	async saveLog(log, context, type, userId) {
		const logId = `log-${Date.now()}-${Math.random()}`; // Unique ID for each log
		const logEntry = { log, context, type, userId, timestamp: Date.now() };
		await this.state.storage.put(logId, logEntry); // Store each log entry separately
	}

	async getLogs(page, limit) {
		const result = await this.state.storage.list(); // Get all keys and values
		const keys = Array.from(result.keys()); // Extract keys from the Map

		// Retrieve logs using the keys
		const logs = await Promise.all(
			keys.map(async (key) => {
				// Skip terminal log entries
				if (key.startsWith('terminal:')) {
					return null;
				}
				const logEntry = await this.state.storage.get(key); // Retrieve log
				return { id: key, ...logEntry }; // Include the key as id in the response
			})
		);

		// Filter out null entries (terminal logs)
		const filteredLogs = logs.filter(log => log !== null);
		
		const paginatedLogs = filteredLogs.slice((page - 1) * limit, page * limit); // Implement pagination

		return jsonResponse(paginatedLogs);
	}
	
	// Constants for log chunking
	MAX_CHUNK_SIZE = 16384; // 16KB chunk size (increased from 50 bytes)
	
	/**
	 * Store terminal logs with email mapping using chunking for large logs
	 * @param {Request} request - The request object
	 * @returns {Response} JSON response
	 */
		async storeTerminalLogs(request) {
			try {
				const { generation_id, userId, userEmail, terminalOutput, timestamp } = await request.json();
				
				if (!generation_id || !terminalOutput) {
					return new Response(JSON.stringify({ 
						success: false, 
						message: 'Missing required fields' 
					}), { 
						status: 400,
						headers: { 'Content-Type': 'application/json' }
					});
				}
				
				console.log(`Storing terminal logs for generation ${generation_id}, size ${terminalOutput.length}B`);
				
				// The userId passed might be incorrect - we need to look up the real user info
				let realUserID = userId;
				let realUserEmail = userEmail || "unknown@user.com";
				
				// Clean any RunPod suffixes from the userId (e.g., "abc-def-u1" -> "abc-def")
				if (realUserID && realUserID.includes('-u')) {
					const parts = realUserID.split('-u');
					if (parts.length > 1 && parts[1].match(/^\d+$/)) { // Only if suffix is numeric like "u1"
						console.log(`Cleaning RunPod suffix from userId: ${realUserID} -> ${parts[0]}`);
						realUserID = parts[0];
					}
				}
			
			try {
				// First try to get the real userID from WebSocketManager
				const wsManagerId = this.env.WEBSOCKET_MANAGER.idFromName('default');
				const wsManager = this.env.WEBSOCKET_MANAGER.get(wsManagerId);
				
				// Use the provided generation_id directly
				const finalGenerationID = generation_id;
				
				// Now lookup the userID using the correct generation_id
				const userIDResponse = await wsManager.fetch(`http://internal/getUserIDForGeneration?generation_id=${generation_id}`);
				
				if (userIDResponse.ok) {
					const userIDData = await userIDResponse.json();
					
					if (userIDData.success && userIDData.userID) {
						realUserID = userIDData.userID;
						console.log(`Found real userID ${realUserID} for generation ${generation_id}`);
						
						// Now get the email from UserAuth
						const userAuthId = this.env.USER_AUTH.idFromName('user-auth-instance');
						const userAuth = this.env.USER_AUTH.get(userAuthId);
						
						const userResponse = await userAuth.fetch(new Request('http://internal/get-user', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ 
								action: 'get-user',
								userId: realUserID
							})
						}));
						
						const userData = await userResponse.json();
						
						if (userData.success && userData.user && userData.user.email) {
							realUserEmail = userData.user.email;
							console.log(`Found real email ${realUserEmail} for user ${realUserID}`);
						}
					}
				}
			} catch (lookupError) {
				console.error(`Error looking up real user data for terminal logs: ${lookupError.message}`);
				// Continue with the logs storage anyway, just with the fallback IDs
			}
			
			// First, ensure metadata is stored (separate from logs)
			// This only needs to be done once and won't overwrite existing metadata
			const metadataKey = `terminal:${generation_id}:metadata`;
			const existingMetadata = await this.state.storage.get(metadataKey);
			
			if (!existingMetadata) {
				const metadata = {
					userId: realUserID,
					userEmail: realUserEmail,
					timestamp,
					createdAt: new Date().toISOString(),
					lastUpdate: new Date().toISOString(),
					chunkCount: 0 // Will be incremented as chunks are added
				};
				
				await this.state.storage.put(metadataKey, metadata);
				console.log(`Created metadata for generation ${generation_id} with user ${realUserID}, email ${realUserEmail}`);
				
				// Also store a direct mapping from generation_id to userEmail as a fallback
				if (realUserEmail && realUserEmail !== "unknown@user.com") {
					await this.state.storage.put(`terminal:generation_id:${generation_id}:userEmail`, realUserEmail);
				}
			} else {
				// Update metadata with correct user information if we just found it
				await this.state.storage.put(metadataKey, {
					...existingMetadata,
					userId: realUserID,
					userEmail: realUserEmail,
					lastUpdate: new Date().toISOString()
				});
			}
			
			// Get current manifest or create a new one
			const manifestKey = `terminal:${generation_id}:manifest`;
			let manifest = await this.state.storage.get(manifestKey) || { chunks: [], size: 0 };
			
			// Handle chunking of the log data
			const logChunks = this.chunkLogData(terminalOutput, this.MAX_CHUNK_SIZE);
			console.log(`Split log into ${logChunks.length} chunks`);
			
			// Store each chunk
			for (let i = 0; i < logChunks.length; i++) {
				const chunkNum = manifest.chunks.length;
				const chunkKey = `terminal:${generation_id}:chunk:${chunkNum}`;
				
				// Store encoded chunk using Unicode-safe encoding
				let encodedSize = 0;
				try {
					// Unicode-safe base64 encoding (handles non-ASCII characters)
					const encodedChunk = btoa(unescape(encodeURIComponent(logChunks[i])));
					await this.state.storage.put(chunkKey, encodedChunk);
					encodedSize = encodedChunk.length;
				} catch (e) {
					console.error(`Error encoding chunk ${i}: ${e.message}`);
					// Fallback method if encoding fails
					const fallbackEncodedChunk = btoa(
						logChunks[i].replace(/[^\x00-\x7F]/g, char => {
							return '\\u' + ('0000' + char.charCodeAt(0).toString(16)).slice(-4);
						})
					);
					await this.state.storage.put(chunkKey, fallbackEncodedChunk);
					encodedSize = fallbackEncodedChunk.length;
				}
				
				// Update manifest
				manifest.chunks.push({
					index: chunkNum,
					key: chunkKey,
					size: logChunks[i].length,
					encodedSize: encodedSize
				});
				manifest.size += logChunks[i].length;
			}
			
			// Store updated manifest
			await this.state.storage.put(manifestKey, manifest);
			
			// Update metadata with latest chunk count
			const updatedMetadata = await this.state.storage.get(metadataKey);
			await this.state.storage.put(metadataKey, {
				...updatedMetadata,
				chunkCount: manifest.chunks.length,
				totalSize: manifest.size
			});
			
			// Add to email-based index using the correct email we found (in a separate try/catch)
			try {
				// Use the realUserEmail we found (which might be the original or the looked-up one)
				if (realUserEmail && realUserEmail !== "unknown@user.com") {
					const emailKey = `terminal:email:${realUserEmail}:runs`;
					let emailRuns = await this.state.storage.get(emailKey);
					
					if (!emailRuns) {
						emailRuns = JSON.stringify([generation_id]);
					} else {
						try {
							const runs = JSON.parse(emailRuns);
							if (!runs.includes(generation_id)) {
								runs.push(generation_id);
								emailRuns = JSON.stringify(runs);
							}
						} catch (e) {
							// If parsing fails, reset to a single run
							console.error(`Error parsing email runs for ${realUserEmail}: ${e.message}`);
							emailRuns = JSON.stringify([generation_id]);
						}
					}
					
					await this.state.storage.put(emailKey, emailRuns);
					console.log(`Updated email index for ${realUserEmail} with generation ${generation_id}`);
				}
			} catch (emailError) {
				// Log error but don't fail the whole operation - logs are still stored
				console.error(`Failed to update email index but logs stored: ${emailError.message}`);
				
				// Record the failure in a special key for debugging
				await this.state.storage.put(
					`terminal:error:emailIndex:${generation_id}`, 
					{error: emailError.message, timestamp: new Date().toISOString()}
				);
			}
			
			return new Response(JSON.stringify({ 
				success: true,
				chunksStored: logChunks.length
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			console.error('Error storing terminal logs:', error);
			return new Response(JSON.stringify({ 
				success: false, 
				message: 'Error storing terminal logs: ' + error.message
			}), { 
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
	
	/**
	 * Split a log string into smaller chunks
	 * @param {string} logData - The log data to split
	 * @param {number} maxSize - Maximum size of each chunk
	 * @returns {string[]} Array of log chunks
	 */
	chunkLogData(logData, maxSize) {
		const chunks = [];
		let index = 0;
		
		// For extremely large logs, we need to ensure we don't hit memory limits
		while (index < logData.length) {
			chunks.push(logData.substring(index, index + maxSize));
			index += maxSize;
		}
		
		return chunks;
	}

	/**
	 * List all emails with terminal logs
	 * @returns {Response} JSON response with list of emails
	 */
	async listEmailsWithLogs() {
		try {
			console.log("Listing emails with terminal logs");
			
			// First approach: Use the email index
			const emailRunKeys = await this.state.storage.list({ prefix: 'terminal:email:' });
			const emails = new Set();
			
			for (const [key] of emailRunKeys) {
				try {
					// Extract email from pattern terminal:email:{email}:runs
					const parts = key.split(':');
					if (parts.length >= 3) {
						emails.add(parts[2]);
					}
				} catch (e) {
					console.error(`Error parsing email from key ${key}: ${e.message}`);
					// Continue with other keys
				}
			}
			
			// Fallback approach if no emails found: Scan metadata
			if (emails.size === 0) {
				console.log("No emails found in index, trying metadata scan");
				
				// Get all metadata entries
				const metadataEntries = await this.state.storage.list({ prefix: 'terminal:' });
				
				for (const [key, value] of metadataEntries) {
					// Only process metadata keys
					if (key.includes(':metadata')) {
						try {
							if (value && value.userEmail && value.userEmail !== "unknown@user.com") {
								emails.add(value.userEmail);
							}
						} catch (e) {
							console.error(`Error extracting email from metadata: ${e.message}`);
						}
					}
				}
			}
			
			console.log(`Found ${emails.size} emails with logs`);
			
			// Always provide at least empty array, never null
			return jsonResponse({
				success: true,
				emails: Array.from(emails)
			});
		} catch (error) {
			console.error('Error listing emails with logs:', error);
			return new Response(JSON.stringify({ 
				success: false, 
				message: 'Error listing emails: ' + error.message
			}), { 
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
	
	/**
	 * Get logs for a specific email
	 * @param {string} email - Email to get logs for
	 * @returns {Response} JSON response with logs
	 */
	async getEmailLogs(email) {
		try {
			console.log(`Getting logs for email: ${email}`);
			
			// Get email's run IDs from primary index
			const emailRunsKey = `terminal:email:${email}:runs`;
			let emailRuns = await this.state.storage.get(emailRunsKey);
			let runIds = [];
			
			if (emailRuns) {
				try {
					runIds = JSON.parse(emailRuns);
					console.log(`Found ${runIds.length} runs for email ${email} from index`);
				} catch (e) {
					console.error(`Error parsing runs JSON for ${email}: ${e.message}`);
					// Continue with empty array, we'll try fallback
				}
			} else {
				console.log(`No runs found for email ${email} in index, trying fallback`);
			}
			
			// Fallback approach if no runs found: Scan metadata for this email
			if (runIds.length === 0) {
				// Get all metadata entries
				const metadataEntries = await this.state.storage.list({ prefix: 'terminal:' });
				
				for (const [key, value] of metadataEntries) {
					// Only process metadata keys
					if (key.includes(':metadata')) {
						try {
							if (value && value.userEmail === email) {
								// Extract runId from key format terminal:{runId}:metadata
								const keyParts = key.split(':');
								if (keyParts.length >= 3) {
									const runId = keyParts[1];
									runIds.push(runId);
								}
							}
						} catch (e) {
							console.error(`Error in metadata fallback for ${email}: ${e.message}`);
						}
					}
				}
				console.log(`Found ${runIds.length} runs for email ${email} from fallback scan`);
			}
			
			// Nothing found even after fallback
			if (runIds.length === 0) {
				return jsonResponse({
					success: true,
					email,
					runs: []
				});
			}
			
			// Get details for each run
			const runs = [];
			for (const runId of runIds) {
				try {
					const metadata = await this.state.storage.get(`terminal:${runId}:metadata`);
					if (metadata) {
						// Add the runId to the metadata
						runs.push({
							runId,
							...metadata
						});
					}
				} catch (e) {
					console.error(`Error getting metadata for run ${runId}: ${e.message}`);
					// Continue with other runs
				}
			}
			
			console.log(`Successfully retrieved ${runs.length} run details for email ${email}`);
			
			// Sort by timestamp (newest first)
			runs.sort((a, b) => {
				const dateA = new Date(a.lastUpdate || a.timestamp || 0);
				const dateB = new Date(b.lastUpdate || b.timestamp || 0);
				return dateB - dateA;
			});
			
			return jsonResponse({
				success: true,
				email,
				runs
			});
		} catch (error) {
			console.error(`Error getting logs for email ${email}:`, error);
			return new Response(JSON.stringify({ 
				success: false, 
				message: 'Error getting email logs: ' + error.message
			}), { 
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
	
	/**
	 * Get logs for a specific generation
	 * @param {string} generation_id - Generation ID to get logs for
	 * @returns {Response} JSON response with logs
	 */
	async getGenerationLogs(generation_id) {
		try {
			console.log(`Getting logs for generation: ${generation_id}`);
			
			// Get metadata first
			const metadataKey = `terminal:${generation_id}:metadata`;
			const metadata = await this.state.storage.get(metadataKey);
			
			if (!metadata) {
				console.log(`No metadata found for generation ${generation_id}`);
				return jsonResponse({
					success: false,
					message: 'No metadata found for this generation'
				}, 404);
			}
			
			// Try to get manifest
			const manifestKey = `terminal:${generation_id}:manifest`;
			const manifest = await this.state.storage.get(manifestKey);
			
			// Check for old-style storage first (before chunking)
			if (!manifest) {
				console.log(`No manifest found for generation ${generation_id}, checking for old-style log`);
				// Try the old direct log key
				const oldLogKey = `terminal:${generation_id}`;
				const oldLogs = await this.state.storage.get(oldLogKey);
				
				if (oldLogs) {
					console.log(`Found old-style logs for generation ${generation_id}`);
					return jsonResponse({
						success: true,
						generation_id,
						...metadata,
						logs: oldLogs
					});
				}
				
				return jsonResponse({
					success: false,
					message: 'No logs found for this generation'
				}, 404);
			}
			
			// Fetch and combine all chunks
			let combinedLogs = '';
			for (const chunk of manifest.chunks) {
				try {
					const chunkKey = chunk.key;
					const encodedChunk = await this.state.storage.get(chunkKey);
					
					if (encodedChunk) {
						// Decode the Base64 chunk
						const decodedChunk = atob(encodedChunk);
						combinedLogs += decodedChunk;
					} else {
						console.warn(`Missing chunk ${chunkKey} for generation ${generation_id}`);
					}
				} catch (e) {
					console.error(`Error processing chunk for generation ${generation_id}: ${e.message}`);
					// Continue with other chunks
				}
			}
			
			console.log(`Successfully assembled ${manifest.chunks.length} chunks for generation ${generation_id}`);
			
			return jsonResponse({
				success: true,
				generation_id,
				...metadata,
				logs: combinedLogs
			});
		} catch (error) {
			console.error(`Error getting logs for generation ${generation_id}:`, error);
			return jsonResponse({ 
				success: false, 
				message: 'Error getting generation logs: ' + error.message
			}, 500);
		}
	}
	
	/**
	 * Clear terminal logs for a specific email or all logs
	 * @param {Request} request - The request object
	 * @returns {Response} JSON response indicating success or failure
	 */
	async clearTerminalLogs(request) {
		try {
			// Check if this is an OPTIONS preflight request
			if (request.method === 'OPTIONS') {
				return new Response(null, {
					status: 204,
					headers: corsHeaders
				});
			}
			
			// Parse request body
			const { email, clearAll = false } = await request.json();
			console.log(`Clearing terminal logs. Email: ${email || 'all'}, clearAll: ${clearAll}`);
			
			let clearedCount = 0;
			let cleanedKeys = [];
			
			if (clearAll) {
				// Clear all terminal logs
				const allKeys = await this.state.storage.list({ prefix: 'terminal:' });
				
				for (const [key] of allKeys) {
					await this.state.storage.delete(key);
					clearedCount++;
					cleanedKeys.push(key);
				}
				
				console.log(`Cleared all terminal logs (${clearedCount} entries)`);
				
				return jsonResponse({
					success: true,
					message: `Cleared all terminal logs (${clearedCount} entries)`,
					clearedCount
				});
			} else if (email) {
				// Clear logs for a specific email
				
				// First, get all runIds for this email
				let runIds = [];
				const emailRunsKey = `terminal:email:${email}:runs`;
				const emailRuns = await this.state.storage.get(emailRunsKey);
				
				if (emailRuns) {
					try {
						runIds = JSON.parse(emailRuns);
					} catch (e) {
						console.error(`Error parsing email runs for ${email}:`, e);
					}
				}
				
				// If we have runIds, delete all associated entries
				for (const runId of runIds) {
					// Delete old-style log
					const oldLogKey = `terminal:${runId}`;
					await this.state.storage.delete(oldLogKey);
					cleanedKeys.push(oldLogKey);
					
					// Delete metadata 
					const metadataKey = `terminal:${runId}:metadata`;
					await this.state.storage.delete(metadataKey);
					cleanedKeys.push(metadataKey);
					
					// Delete manifest
					const manifestKey = `terminal:${runId}:manifest`;
					const manifest = await this.state.storage.get(manifestKey);
					
					if (manifest) {
						// Delete all chunks
						for (const chunk of manifest.chunks) {
							await this.state.storage.delete(chunk.key);
							cleanedKeys.push(chunk.key);
							clearedCount++;
						}
						
						// Delete manifest 
						await this.state.storage.delete(manifestKey);
						cleanedKeys.push(manifestKey);
					}
					
					// Also check for any fallback keys
					const fallbackKey = `terminal:runId:${runId}:userEmail`;
					await this.state.storage.delete(fallbackKey);
					cleanedKeys.push(fallbackKey);
					
					clearedCount++;
				}
				
				// Delete the email index
				await this.state.storage.delete(emailRunsKey);
				cleanedKeys.push(emailRunsKey);
				
				console.log(`Cleared logs for email ${email} (${clearedCount} entries)`);
				
				return jsonResponse({
					success: true,
					message: `Cleared logs for email ${email}`,
					clearedCount,
					email
				});
			} else {
				return jsonResponse({
					success: false,
					message: 'No email provided and clearAll not specified'
				}, 400);
			}
		} catch (error) {
			console.error('Error clearing terminal logs:', error);
			return jsonResponse({ 
				success: false, 
				message: 'Error clearing terminal logs: ' + error.message
			}, 500);
		}
	}

	/**
	 * Get all terminal logs regardless of email association
	 * @returns {Response} JSON response with all terminal logs
	 */
	async getAllTerminalLogs() {
		try {
			console.log("Getting all terminal logs");
			
			// Get all metadata entries
			const metadataEntries = await this.state.storage.list({ prefix: 'terminal:' });
			const runs = [];
			
			// Extract all run IDs without filtering by email
			for (const [key, value] of metadataEntries) {
				if (key.includes(':metadata')) {
					try {
				// Extract generation_id from key pattern terminal:{generation_id}:metadata
				const generation_id = key.split(':')[1];
				
				// Add to runs array with metadata
				runs.push({
					generation_id,
					...value
				});
					} catch (e) {
						console.error(`Error processing metadata key ${key}: ${e.message}`);
						// Continue with other keys
					}
				}
			}
			
			// Sort by timestamp (newest first)
			runs.sort((a, b) => {
				const dateA = new Date(a.lastUpdate || a.timestamp || 0);
				const dateB = new Date(b.lastUpdate || b.timestamp || 0);
				return dateB - dateA;
			});
			
			console.log(`Found ${runs.length} total terminal runs`);
			
			return jsonResponse({
				success: true,
				runs
			});
		} catch (error) {
			console.error('Error getting all terminal logs:', error);
			return jsonResponse({ 
				success: false, 
				message: 'Error getting all terminal logs: ' + error.message
			}, 500);
		}
	}
}
