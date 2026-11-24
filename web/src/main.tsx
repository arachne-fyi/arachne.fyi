import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './dash/App.tsx';
import './dash/dash.css';
import './mc-theme.css';
import { mountPanorama } from './mc-bg.ts';
import { offlineBanner } from './offline.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
offlineBanner();
mountPanorama(true);

// Installable app and push notifications. Only in a production build: in development a
// cached page would hide your edits.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    /* no service worker: the site still works, just not offline */
  });
}
