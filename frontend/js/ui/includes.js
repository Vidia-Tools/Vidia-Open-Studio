/**
 * Universal partial injector.
 *
 * Supports:
 *  - Portfolio-style placeholders by id:
 *      <div id="header-placeholder"></div>
 *      <div id="footer-placeholder"></div>
 *  - Generic placeholders via data-include:
 *      <div data-include="/partials/header.html"></div>
 *
 * Notes:
 *  - Serve via a local/static server. fetch() cannot load file:// URLs.
 *  - Use absolute paths from the site root (e.g., /partials/header.html) to match portfolio convention.
 *  - Dispatches:
 *      - `headerLoaded` on the header placeholder after injection
 *      - `footerLoaded` on the footer placeholder after injection
 *      - `includes:loaded` on document after all includes complete
 *      - `authStateChanged` on document to re-evaluate auth UI after header/footer exist
 */
(function () {
  async function runInjection() {
    // Helper: inject content into a target element and dispatch an event
    async function injectInto(target, url, loadedEventName) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
        const html = await res.text();
        target.innerHTML = html;
        if (loadedEventName) {
          const ev = new CustomEvent(loadedEventName, { bubbles: true, cancelable: true });
          target.dispatchEvent(ev);
        }
      } catch (e) {
        console.warn('Include failed:', url, e);
        try {
          target.innerHTML = '<!-- Include failed -->';
        } catch (_) {
          // no-op
        }
      }
    }

    // Strict, standardized placeholders only
    const headerEl = document.getElementById('header-placeholder');
    if (headerEl) {
      await injectInto(headerEl, '/partials/header.html', 'headerLoaded');
    }

    const footerEl = document.getElementById('footer-placeholder');
    if (footerEl) {
      await injectInto(footerEl, '/partials/footer.html', 'footerLoaded');
      // Set footer year since injected scripts do not execute
      const yearEl = document.getElementById('footerYear');
      if (yearEl) {
        yearEl.textContent = new Date().getFullYear();
      }
    }

    // All includes injected
    document.dispatchEvent(new CustomEvent('includes:loaded'));
    // Ensure auth UI refreshes after header/footer are present
    document.dispatchEvent(new CustomEvent('authStateChanged'));

    // Initialize theme system (binds footer toggle)
    try {
      const themeModule = await import('/js/ui/theme.js');
      if (themeModule && typeof themeModule.initializeTheme === 'function') {
        themeModule.initializeTheme();
      }
    } catch (e) {
      console.warn('Theme initialization failed:', e);
    }

    // Ensure auth signup module is available site-wide so it can bind after header injection
    try {
      await import('/js/auth/signup-modal.js');
      // Re-dispatch includes:loaded so late-loaded listeners (e.g., signup-modal) can bind
      document.dispatchEvent(new CustomEvent('includes:loaded'));
    } catch (e) {
      console.warn('Auth signup module load failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInjection, { once: true });
  } else {
    // DOM already ready; run immediately to avoid missing the event
    runInjection();
  }
})();
