/**
 * Email utility module
 * 
 * Consolidates all email-related logic: sending, template generation,
 * disposable email detection, and mailing list subscription.
 */

/**
 * Build the list of allowed URL prefixes for email links from env config.
 * Only links under the app base URL or the exports bucket domain are permitted,
 * preventing link injection into outgoing emails.
 * @param {Object} env - Worker environment bindings
 * @returns {string[]} Allowed URL prefixes
 */
function allowedUrlPrefixes(env) {
  return [env.APP_BASE_URL, env.EXPORTS_BUCKET_DOMAIN ? `https://${env.EXPORTS_BUCKET_DOMAIN}` : null]
    .filter(Boolean);
}

/**
 * Validate and sanitize a URL for safe use in email templates.
 * Returns the URL if it falls under an allowed prefix, or a safe fallback otherwise.
 * @param {string} url - Candidate URL
 * @param {Object} env - Worker environment bindings
 * @param {string} [fallback] - Fallback URL (defaults to env.APP_BASE_URL)
 */
function sanitizeUrl(url, env, fallback) {
  const safeFallback = fallback || env.APP_BASE_URL || '';
  if (typeof url !== 'string') return safeFallback;
  const trimmed = url.trim();
  const prefixes = allowedUrlPrefixes(env);
  if (prefixes.some(prefix => trimmed === prefix || trimmed.startsWith(prefix + '/'))) {
    // Encode any characters that could break out of an href attribute
    return trimmed.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  console.error(`[EMAIL] Rejected URL that does not match allowed prefixes: ${trimmed.substring(0, 80)}`);
  return safeFallback;
}

// --- Sending ---

/**
 * Centralized email sending via Resend API
 * @param {Object} env - Environment variables with EMAIL_API_KEY
 * @param {string} to - Recipient email address
 * @param {Object} templateData - Object containing subject and html content
 * @param {string} [senderEmail] - Sender email address (defaults to env.EMAIL_FROM)
 * @returns {Promise<Object>} Success status and message
 */
export async function sendEmail(env, to, templateData, senderEmail = env.EMAIL_FROM) {
  try {
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.EMAIL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: senderEmail,
        to: to,
        subject: templateData.subject,
        html: templateData.html
      })
    });

    const emailResult = await emailResponse.json();
    
    if (!emailResponse.ok) {
      console.error('[EMAIL] Sending failed:', emailResult);
      return { success: false, message: 'Failed to send email', error: emailResult };
    }
    
    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    console.error('[EMAIL] Error sending email:', error);
    return { success: false, message: 'Failed to send email', error };
  }
}

// --- Disposable email detection ---

/**
 * Check if email domain is disposable using KV storage
 * @param {string} email - Email address to check
 * @param {Object} env - Environment variables with KV binding
 * @returns {Promise<boolean>} Whether the email is disposable
 */
export async function isDisposableEmail(email, env) {
  try {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;
    
    const blocklistJson = await env.DISPOSABLE_EMAIL_DOMAINS.get('__blocklist__');
    if (!blocklistJson) return false;
    const blocklist = new Set(JSON.parse(blocklistJson));
    return blocklist.has(domain);
  } catch (error) {
    console.error('[EMAIL] Error checking disposable email:', error);
    // Fail open - if check fails, allow the email through
    return false;
  }
}

// --- Mailing list ---

/**
 * Add subscriber to MailerLite group
 * @param {string} email - Subscriber email address
 * @param {string} groupId - MailerLite group ID
 * @param {string} country - Country code for subscriber
 * @param {Object} env - Environment variables with MailerLite API key
 * @returns {Promise<Response>} MailerLite API response
 */
export async function addToMailerLite(email, groupId, country, env) {
  const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.MAILERLITE_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      email: email,
      groups: [groupId],
      fields: {
        country: country || 'Unknown',
        signup_date: new Date().toISOString()
      }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`MailerLite API error: ${error.message || response.statusText}`);
  }
  
  return response;
}

// --- Templates ---

/**
 * Generate email template for magic link authentication
 * @param {string} magicLink - The authentication magic link URL
 * @param {Object} env - Worker environment bindings (provides APP_BASE_URL)
 * @returns {Object} Template object with subject and HTML content
 */
export function getMagicLinkEmailTemplate(magicLink, env) {
  const safeLink = sanitizeUrl(magicLink, env);
  return {
    subject: 'Your Vidia Magic Link',
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <img src="${env.APP_BASE_URL}/assets/triangles-logo.png" alt="Vidia Logo" style="max-width: 100px; margin-bottom: 20px;">
      <h2>Continue your video generation</h2>
      <p>Don't wait: Click the button below to sign in and view your video.</p>
      <a href="${safeLink}" style="display: inline-block; background-color: #A971FB; color: white; text-decoration: none; padding: 12px 24px; border-radius: 4px; margin: 20px 0;">Continue to Vidia</a>
      <p style="color: #666; font-size: 14px;">This link will expire in 30 minutes and can only be used once.</p>
      <p style="color: #666; font-size: 12px;">If you didn't request this email, you can safely ignore it.</p>
    </div>
    `
  };
}

/**
 * Generate email template for video ready notification
 * @param {string} name - The recipient's name
 * @param {string} videoUrl - URL to the generated video
 * @param {Object} env - Worker environment bindings (provides APP_BASE_URL)
 * @returns {Object} Template object with subject and HTML content
 */
export function getVideoReadyEmailTemplate(name, videoUrl, env) {
  const safeUrl = sanitizeUrl(videoUrl, env);
  return {
    subject: 'Your Vidia is Ready!',
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <img src="${env.APP_BASE_URL}/assets/triangles-logo.png" alt="Vidia Logo" style="max-width: 100px; margin-bottom: 20px;">
      <h2>Your Vidia is ready!</h2>
      <p>Hi there,</p>
      <p>Good news! Your Vidia has been processed and is ready to view.</p>
      <a href="${safeUrl}" style="display: inline-block; background-color: #A971FB; color: white; text-decoration: none; padding: 12px 24px; border-radius: 4px; margin: 20px 0;">View Your Vidia</a>
      <p style="color: #666; font-size: 14px;">Please note that this link will expire in 7 days.</p>
      <p>Happy creating,<br>The Vidia Team</p>
    </div>
    `
  };
}
