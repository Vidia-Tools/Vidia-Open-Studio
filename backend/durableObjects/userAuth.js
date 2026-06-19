import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DEFAULT_CORS_HEADERS as corsHeaders } from '../middleware/cors.js';

export class UserAuth {
	constructor(state, env) {
		this.state = state; // Persistent state for this Durable Object.
		this.env = env; // Access environment variables.
	}

	async fetch(request) {
		const url = new URL(request.url);
		
		try {
			// Handle all requests via action parameter for consistency
			const body = await request.json().catch(e => ({})); // Handle empty body gracefully
			
			// Debug logging
			console.log("UserAuth request:", { 
				url: url.pathname, 
				method: request.method,
 			action: body.action || 'none'
			});
			
			// Route based on action parameter
			if (body.action === 'magic-link') {
				return this.generateMagicLink(body);
			} else if (body.action === 'verify-token') {
				return this.verifyMagicLink(body);
			} else if (body.action === 'list-users') {
				return this.listUsers();
			} else if (body.action === 'add-user') {
				return this.addUser(body);
			} else if (body.action === 'delete-user') {
				return this.deleteUser(body);
			} else if (body.action === 'get-user') {
				// Handle get-user action if implemented
				return this.getUser(body);
			} else if (body.action === 'dump-raw-storage') {
				// Debug action to dump raw storage data
				return this.dumpRawStorage();
			} else if (body.action === 'clear-all-data') {
				// Clear all data (admin only)
				return this.clearAllData(body);
			} else if (url.pathname === '/admin/users') {
				// Fallback for direct URL routing
				if (request.method === 'GET' || request.method === 'POST') {
					return this.listUsers();
				}
			} else {
				return new Response(JSON.stringify({
					success: false,
					message: 'Invalid action or path'
				}), { 
					status: 400,
					headers: corsHeaders
				});
			}
		} catch (error) {
			// Log and return error
			console.error("UserAuth error:", error);
			return new Response(JSON.stringify({
				success: false,
				message: 'Error processing request: ' + error.message
			}), { 
				status: 500,
				headers: corsHeaders
			});
		}
	}
	
	/**
	 * Check if the provided email is an admin
	 * @param {string} email - Email to check
	 * @returns {boolean} Whether the email is an admin
	 */
	isAdmin(email) {
		return email === this.env.ADMIN_EMAIL;
	}
	
	/**
	 * Generate a magic link token for authentication
	 * @param {Object} body - Request body
	 * @returns {Response} JSON response
	 */
	async generateMagicLink({ email, settingsId, turnstileToken, mode }) {
		// Verify Turnstile token
		if (turnstileToken) {
			const isValid = await this.verifyTurnstile(turnstileToken);
			if (!isValid) {
				return new Response(JSON.stringify({ 
					success: false, 
					message: "Security check failed" 
				}), { 
					status: 400,
					headers: corsHeaders 
				});
			}
		}
		
		// Generate token with expiry (30 minutes)
		const token = crypto.randomUUID();
		const expiry = Date.now() + 30 * 60 * 1000;
		
		// Store token data with mode
		await this.state.storage.put(`token:${token}`, {
			email,
			settingsId,
			mode: mode || 'trace', // Default to trace if not provided
			expiry,
			used: false
		});
		
		return new Response(JSON.stringify({ 
			success: true, 
			token, 
			email,
			mode: mode || 'trace' // Include mode in response
		}), { 
			status: 200,
			headers: corsHeaders 
		});
	}
	
	/**
	 * Verify a magic link token and create/retrieve user
	 * @param {Object} body - Request body
	 * @returns {Response} JSON response
	 */
	async verifyMagicLink({ token }) {
		try {
			// Get token data
			const tokenData = await this.state.storage.get(`token:${token}`);
			if (!tokenData) {
				return new Response(JSON.stringify({ 
					success: false, 
					message: "Invalid token" 
				}), { 
					status: 400,
					headers: corsHeaders 
				});
			}
			
			// Check expiry and used status
			if (tokenData.expiry < Date.now()) {
				return new Response(JSON.stringify({ 
					success: false, 
					message: "Token has expired" 
				}), { 
					status: 400,
					headers: corsHeaders 
				});
			}
			
			if (tokenData.used) {
				return new Response(JSON.stringify({ 
					success: false, 
					message: "Token has already been used" 
				}), { 
					status: 400,
					headers: corsHeaders 
				});
			}
			
			// Mark as used
			tokenData.used = true;
			await this.state.storage.put(`token:${token}`, tokenData);
			
			console.log(`Token ${token} marked as used for email: ${tokenData.email}`);
			
			// Delete the used token to keep storage clean
			await this.state.storage.delete(`token:${token}`);
			console.log(`Deleted used token: ${token}`);
			
			// Properly find or create user by filtering out tokens first
			const users = await this.state.storage.list();
			let user = Array.from(users.entries())
				.filter(([key, _]) => !key.startsWith('token:'))
				.map(([_, value]) => value)
				.find(user => user.email && user.email.toLowerCase() === tokenData.email.toLowerCase());
			
			let isNewUser = false;
			
			if (!user) {
				// Create new user with verified email
				const userId = crypto.randomUUID();
				user = {
					userId,
					email: tokenData.email,
					firstName: "User",
					lastName: "",
					emailVerified: true,
					createdAt: Date.now()
				};
				
				console.log(`Creating new user: ${tokenData.email} with ID: ${userId}`);
				await this.state.storage.put(userId, user);
				console.log(`User created successfully: ${tokenData.email}`);
				isNewUser = true;
			} else {
				console.log(`Found existing user: ${tokenData.email}`);
			}
			
			// Generate JWT
			const jwtToken = jwt.sign({ email: user.email, userId: user.userId }, this.env.JWT_SECRET, { expiresIn: '1d' });
			
			return new Response(JSON.stringify({ 
				success: true, 
				token: jwtToken, 
				user,
				settingsId: tokenData.settingsId,
				mode: tokenData.mode || 'trace', // Include the mode in the response
				isNewUser: isNewUser // Flag indicating if this is a newly created user
			}), { 
				status: 200,
				headers: corsHeaders 
			});
		} catch (error) {
			console.error('Error in verifyMagicLink:', error);
			return new Response(JSON.stringify({ 
				success: false, 
				message: "Error verifying token: " + error.message 
			}), { 
				status: 500,
				headers: corsHeaders 
			});
		}
	}
	
	/**
	 * Verify Turnstile token with Cloudflare API
	 * @param {string} token - Turnstile token
	 * @returns {Promise<boolean>} Whether the token is valid
	 */
	async verifyTurnstile(token) {
		try {
			const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					secret: this.env.TURNSTILE_SECRET_KEY_LOGIN,
					response: token
				})
			});
			
			const result = await response.json();
			return result.success === true;
		} catch (error) {
			console.error('Turnstile verification error:', error);
			return false;
		}
	}

	/**
	 * List all registered users
	 * @returns {Response} JSON response with user list
	 */
	async listUsers() {
		try {
			const users = await this.state.storage.list();
			const userList = [];
			
			// Convert storage map to array, filtering out token entries
			for (const [key, value] of users.entries()) {
				if (!key.startsWith('token:')) {
					userList.push({
						userId: key,
						...value
					});
				}
			}
			
			return new Response(JSON.stringify({ 
				success: true, 
				users: userList 
			}), { 
				status: 200,
				headers: corsHeaders 
			});
		} catch (error) {
			console.error('Error listing users:', error);
			return new Response(JSON.stringify({ 
				success: false, 
				message: "Failed to list users" 
			}), { 
				status: 500,
				headers: corsHeaders 
			});
		}
	}
	
	/**
	 * DEBUG: Dump raw storage data for troubleshooting
	 * @returns {Response} JSON response with all storage data
	 */
	async dumpRawStorage() {
		try {
			const storageItems = await this.state.storage.list();
			const rawData = {};
			
			// Convert storage map to raw object
			for (const [key, value] of storageItems.entries()) {
				rawData[key] = value;
			}
			
			return new Response(JSON.stringify({ 
				success: true, 
				rawStorage: rawData,
				timestamp: new Date().toISOString(),
				count: Object.keys(rawData).length
			}), { 
				status: 200,
				headers: corsHeaders 
			});
		} catch (error) {
			console.error('Error dumping raw storage:', error);
			return new Response(JSON.stringify({ 
				success: false, 
				message: "Failed to dump raw storage",
				error: error.message
			}), { 
				status: 500,
				headers: corsHeaders 
			});
		}
	}
	
	/**
	 * Add a new user to the system
	 * @param {Object} body - Request body with user details
	 * @returns {Response} JSON response
	 */
	async addUser({ email, requesterEmail }) {
		// Check if requester is admin
		if (!this.isAdmin(requesterEmail)) {
			return new Response(JSON.stringify({ 
				success: false, 
				message: "Unauthorized" 
			}), { 
				status: 401,
				headers: corsHeaders 
			});
		}
		
		try {
			// Check if user already exists
			const users = await this.state.storage.list();
			for (const [_, user] of users.entries()) {
				if (user.email && user.email.toLowerCase() === email.toLowerCase()) {
					return new Response(JSON.stringify({ 
						success: false, 
						message: "User already exists" 
					}), { 
						status: 400,
						headers: corsHeaders 
					});
				}
			}
			
			// Create new user
			const userId = crypto.randomUUID();
			const newUser = {
				userId,
				email,
				firstName: "User",
				lastName: "",
				emailVerified: true,
				createdAt: Date.now(),
				createdBy: requesterEmail
			};
			
			await this.state.storage.put(userId, newUser);
			
			return new Response(JSON.stringify({ 
				success: true, 
				user: newUser 
			}), { 
				status: 200,
				headers: corsHeaders 
			});
		} catch (error) {
			console.error('Error adding user:', error);
			return new Response(JSON.stringify({ 
				success: false, 
				message: "Failed to add user" 
			}), { 
				status: 500,
				headers: corsHeaders 
			});
		}
	}
	
	/**
	 * Delete a user from the system
	 * @param {Object} body - Request body with user ID to delete
	 * @returns {Response} JSON response
	 */
	async deleteUser({ userId, requesterEmail }) {
		// Check if requester is admin
		if (!this.isAdmin(requesterEmail)) {
			return new Response(JSON.stringify({ 
				success: false, 
				message: "Unauthorized" 
			}), { 
				status: 401,
				headers: corsHeaders 
			});
		}
		
		try {
			// Check if user exists
			const user = await this.state.storage.get(userId);
			if (!user) {
				return new Response(JSON.stringify({ 
					success: false, 
					message: "User not found" 
				}), { 
					status: 404,
					headers: corsHeaders 
				});
			}
			
			// Delete user
			await this.state.storage.delete(userId);
			
			return new Response(JSON.stringify({ 
				success: true, 
				message: "User deleted successfully" 
			}), { 
				status: 200,
				headers: corsHeaders 
			});
		} catch (error) {
			console.error('Error deleting user:', error);
			return new Response(JSON.stringify({ 
				success: false, 
				message: "Failed to delete user" 
			}), { 
				status: 500,
				headers: corsHeaders 
			});
		}
	}
	
	/**
	 * Get a specific user by ID
	 * @param {Object} body - Request with userId
	 * @returns {Response} JSON response with user data
	 */
	async getUser({ userId }) {
		try {
			// Get user by ID
			const user = await this.state.storage.get(userId);
			
			if (!user) {
				return new Response(JSON.stringify({
					success: false,
					message: "User not found"
				}), {
					status: 404,
					headers: corsHeaders
				});
			}
			
			return new Response(JSON.stringify({
				success: true,
				user: {
					userId,
					...user
				}
			}), {
				status: 200,
				headers: corsHeaders
			});
		} catch (error) {
			console.error('Error getting user:', error);
			return new Response(JSON.stringify({
				success: false,
				message: "Failed to get user"
			}), {
				status: 500,
				headers: corsHeaders
			});
		}
	}
	
	/**
	 * Clear all data in storage (admin only)
	 * @param {Object} body - Request body with requester info
	 * @returns {Response} JSON response
	 */
	async clearAllData({ requesterEmail }) {
		// Check if requester is admin
		if (!this.isAdmin(requesterEmail)) {
			return new Response(JSON.stringify({ 
				success: false, 
				message: "Unauthorized - Admin access required" 
			}), { 
				status: 401,
				headers: corsHeaders 
			});
		}
		
		try {
			// Get all keys
			const items = await this.state.storage.list();
			const keys = Array.from(items.keys());
			
			// Delete everything
			for (const key of keys) {
				await this.state.storage.delete(key);
			}
			
			console.log(`Cleared all data (${keys.length} items) from storage by admin: ${requesterEmail}`);
			
			return new Response(JSON.stringify({
				success: true,
				message: `Successfully cleared ${keys.length} items from storage`,
				clearedAt: new Date().toISOString()
			}), {
				status: 200,
				headers: corsHeaders
			});
		} catch (error) {
			console.error('Error clearing data:', error);
			return new Response(JSON.stringify({
				success: false,
				message: "Failed to clear data: " + error.message
			}), {
				status: 500,
				headers: corsHeaders
			});
		}
	}
	
	// End of UserAuth class
}
