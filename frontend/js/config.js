// Open Studio: values come from build-time VITE_* env (URLs/public keys only,
// never secret keys). See root .env.example. Local mode points VITE_API_BASE at
// the localhost app_server target.
const HOSTED_BACKEND_URL = 'https://vidia-open-studio-test.tech-b5a.workers.dev';
const HOSTED_TURNSTILE_SITE_KEY_LOGIN = '0x4AAAAAABHuKs-qf4-IZDE1';
const config = {
  BACKEND_URL: import.meta.env?.VITE_API_BASE || HOSTED_BACKEND_URL,
  TURNSTILE_SITE_KEY_LOGIN: import.meta.env?.VITE_TURNSTILE_SITE_KEY_LOGIN || HOSTED_TURNSTILE_SITE_KEY_LOGIN,
};

// Freeze the config object to prevent modifications
Object.freeze(config);

// Make config available globally
window.APP_CONFIG = config;
