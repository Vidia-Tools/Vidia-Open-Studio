/**
 * Authentication routes - magic link and token verification
 */
import { jsonResponse } from '../utils/response.js';
import { sendEmail, isDisposableEmail, addToMailerLite, getMagicLinkEmailTemplate } from '../utils/email.js';
import { withRateLimit } from '../middleware/rate-limit.js';

export function authRoutes(router) {
	// Magic link email sending - rate limited to prevent email spam (5 per 5 min per IP)
	router.post('/api/auth/magic-link', withRateLimit(5, 300), async (request, env) => {
		const { email, settingsId, turnstileToken, mode } = await request.json();

		// Block disposable/temporary email domains
		if (await isDisposableEmail(email, env)) {
			return jsonResponse({
				success: false,
				message: 'Please use a permanent email address to create an account'
			}, 400);
		}

		// Forward to UserAuth DO for token generation
		const id = env.USER_AUTH.idFromName('user-auth-instance');
		const obj = env.USER_AUTH.get(id);

		const response = await obj.fetch(new Request('http://internal/magic-link', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, settingsId, turnstileToken, mode, action: 'magic-link' })
		}));

		const data = await response.json();

		if (data.success) {
			const userMode = data.mode || 'trace';
			const magicLink = `${env.APP_BASE_URL}/dashboard?mode=${userMode}&token=${data.token}`;

			try {
				const templateData = getMagicLinkEmailTemplate(magicLink, env);
				const emailResult = await sendEmail(env, data.email, templateData);

				if (!emailResult.success) {
					return jsonResponse({
						success: false,
						message: 'Failed to send magic link email'
					}, 500);
				}

				return jsonResponse({
					success: true,
					message: 'Magic link sent to your email'
				});
			} catch (error) {
				console.error('Email sending error:', error);
				return jsonResponse({
					success: false,
					message: 'Failed to send magic link email'
				}, 500);
			}
		}

		return jsonResponse(data);
	});

	// Token verification
	router.post('/api/auth/verify-token', async (request, env) => {
		const id = env.USER_AUTH.idFromName('user-auth-instance');
		const obj = env.USER_AUTH.get(id);

		const body = await request.json();
		const response = await obj.fetch(new Request('http://internal/verify-token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...body, action: 'verify-token' })
		}));

		const data = await response.json();

		// Sync new users to MailerLite (non-blocking)
		if (data.success && data.isNewUser) {
			try {
				const country = body.cf?.country || request.cf?.country || 'Unknown';
				await addToMailerLite(
					data.user.email,
					env.MAILERLITE_USERS_GROUP_ID,
					country,
					env
				);
				console.log('New user synced to MailerLite');
			} catch (mlError) {
				console.error('MailerLite sync failed:', mlError);
				// Don't fail the verification flow
			}
		}

		return jsonResponse(data);
	});
}
