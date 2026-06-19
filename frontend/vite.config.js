import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Project root is this directory (Front/Vidia_App/)
  root: '.',

  // Static files that should be copied to dist/ as-is without processing.
  // This handles partials fetched at runtime and modal HTML loaded via fetch().
  publicDir: 'public',

  build: {
    outDir: 'dist',
    emptyOutDir: true,

    rollupOptions: {
      // Multi-page app: each HTML file is a separate entry point
      input: {
        dashboard: resolve(__dirname, 'dashboard.html'),
        index: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin-panel.html'),
        changelog: resolve(__dirname, 'changelog.html'),
        credits: resolve(__dirname, 'credits-page.html'),
        privacy: resolve(__dirname, 'privacy-policy-page.html'),
        terms: resolve(__dirname, 'terms-of-service-page.html'),
      },

      output: {
        // Cache-busting hashed filenames for JS chunks
        entryFileNames: 'assets/js/[name]-[hash].js',
        chunkFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },

    // Generate source maps for debugging production issues
    sourcemap: true,

    // Target modern browsers (matches browserslist in package.json)
    target: 'es2020',
  },

  server: {
    // Dev server settings for local development
    port: 3000,
    open: '/dashboard.html',
  },
});
