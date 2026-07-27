import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The app is served from the same origin as the API in production — Caddy sends
 * `/api/*` to the container and everything else to the built bundle — so the session
 * cookie is a first-party cookie and `SameSite=Lax` does what it says.
 *
 * The dev proxy reproduces that exactly, prefix strip included, so localhost and
 * production differ in no way the auth code can see. `changeOrigin` stays off on
 * purpose: the API's origin guard should keep seeing the browser's real `Origin`.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8082',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/u, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
