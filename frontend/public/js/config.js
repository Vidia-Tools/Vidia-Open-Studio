// Open Studio: static (non-module) config for the admin page. No secrets in the
// repo. setup.sh / deploy writes the real values here from the root .env
// (URLs/public keys only, never secret keys).
const config = {
  BACKEND_URL: "https://vidia-open-studio-test.tech-b5a.workers.dev",
  TURNSTILE_SITE_KEY_LOGIN: "0x4AAAAAABHuKs-qf4-IZDE1",
  ADMIN_EMAIL: "admin@vidia.tools",
};

// Freeze the config object to prevent modifications
Object.freeze(config);

// Make config available globally
window.APP_CONFIG = config;
