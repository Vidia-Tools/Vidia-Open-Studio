// Open Studio: static (non-module) config for the admin page. No secrets in the
// repo. setup.sh / deploy writes the real values here from the root .env
// (URLs/public keys only, never secret keys).
const config = {
  BACKEND_URL: "",
  TURNSTILE_SITE_KEY_LOGIN: "",
};

// Freeze the config object to prevent modifications
Object.freeze(config);

// Make config available globally
window.APP_CONFIG = config;
