import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { sitePartials } from './site-partials.ts';

/**
 * In development, serve /download and /landing as their own pages (the production server
 * does the same for /download, and shows the landing page on arachne.fyi).
 */
const publicPages: Plugin = {
  name: 'public-pages',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/download' || req.url === '/download/') req.url = '/download.html';
      else if (req.url === '/help') req.url = '/help.html';
      else if (req.url === '/status') req.url = '/status.html';
      else if (req.url === '/tools') req.url = '/tools.html';
      else if (req.url?.startsWith('/overlay/')) req.url = '/overlay.html';
      else if (req.url?.startsWith('/u/')) req.url = '/profile.html';
      else if (req.url === '/landing') req.url = '/landing.html';
      else if (req.url === '/signin' || req.url?.startsWith('/signin?')) req.url = '/signin.html';
      else if (['/terms', '/privacy', '/cookies', '/changelog'].includes(req.url ?? '')) req.url = `${req.url}.html`;
      next();
    });
  },
};

// In development Vite serves the dashboard on :5173 and forwards API calls to the
// server on :8787, so the browser only ever talks to one origin (cookies just work).
// start-offline.bat runs a second, offline copy on other ports (WEB_PORT, API_TARGET).
const api = process.env.API_TARGET || 'http://localhost:8787';

export default defineConfig({
  plugins: [sitePartials(), publicPages, react()],
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/auth': { target: api, changeOrigin: false },
      '/download/files': { target: api, changeOrigin: false },
      '/download/latest': { target: api, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Recharts makes the dashboard bundle ~600 kB (about 180 kB gzipped); that is fine here.
    chunkSizeWarningLimit: 1000,
    // Pages: the dashboard (app.arachne.fyi), the landing page (arachne.fyi), and the public pages.
    rollupOptions: {
      input: { index: 'index.html', landing: 'landing.html', download: 'download.html', help: 'help.html', status: 'status.html', tools: 'tools.html', overlay: 'overlay.html', profile: 'profile.html', terms: 'terms.html', privacy: 'privacy.html', cookies: 'cookies.html', changelog: 'changelog.html', signin: 'signin.html' },
    },
  },
});
