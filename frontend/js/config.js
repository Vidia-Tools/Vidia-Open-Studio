// Open Studio: values come from build-time VITE_* env (URLs/public keys only,
// never secret keys). See root .env.example. Local mode points VITE_API_BASE at
// the localhost app_server target.
const config = {
  BACKEND_URL: import.meta.env?.VITE_API_BASE || '',
  TURNSTILE_SITE_KEY_LOGIN: import.meta.env?.VITE_TURNSTILE_SITE_KEY_LOGIN || '',
};

// Freeze the config object to prevent modifications
Object.freeze(config);

// Make config available globally
window.APP_CONFIG = config;
