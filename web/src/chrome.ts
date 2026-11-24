import { PANORAMA_FACES, panoramaCanvas } from './panorama.ts';

/**
 * Things every page shares, public pages and the dashboard alike: the background, the footer
 * and links that open in a new tab. Plain DOM so the tiny public pages stay tiny.
 */

export type Background = 'panorama' | 'still' | 'colour';
const KEY = 'arachne-settings';

export function savedBackground(): Background {
  try {
    const b = (JSON.parse(localStorage.getItem(KEY) ?? '{}') as { background?: Background }).background;
    return b === 'still' || b === 'colour' ? b : 'panorama';
  } catch {
    return 'panorama';
  }
}

/** The marketing site (arachne.fyi) when we are on app.arachne.fyi; this site otherwise. */
export function siteBase(): string {
  const h = location.hostname;
  return h.startsWith('app.') ? `${location.protocol}//${h.slice(4)}${location.port ? `:${location.port}` : ''}` : '';
}

/** Slow connection, data saver or reduced motion: stay on the still picture. */
function canAnimate(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } }).connection;
  if (!c) return true; // browsers without the API (Safari, Firefox): assume a normal connection
  if (c.saveData) return false;
  if (c.effectiveType && c.effectiveType !== '4g') return false;
  return c.downlink == null || c.downlink >= 1; // Mbps; the ~0.9 MB of faces load behind the still picture
}

let pan: HTMLElement | null = null;


function loadAll(srcs: string[]): Promise<HTMLImageElement[]> {
  return Promise.all(
    srcs.map(
      (src) =>
        new Promise<HTMLImageElement>((ok, fail) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => ok(img);
          img.onerror = fail;
          img.src = src;
        }),
    ),
  );
}

/**
 * Still picture first (it is in the CSS, so it shows at once). Then, on a fast connection,
 * the panorama loads in the background and fades in over it. "colour" drops the picture.
 */
export function applyBackground(mode: Background = savedBackground()): void {
  const root = document.documentElement;
  root.classList.remove('bg-panorama', 'bg-still', 'bg-colour', 'pan-ready');
  root.classList.add(`bg-${mode}`);
  if (mode !== 'panorama' || !canAnimate()) {
    pan?.remove();
    pan = null;
    return;
  }
  if (pan) {
    root.classList.add('pan-ready');
    return;
  }
  const reveal = (node: HTMLElement) => {
    if (savedBackground() !== 'panorama' || pan) return;
    pan = node;
    document.body.prepend(node);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('pan-ready')));
  };
  const drift = () => {
    // No panorama or no WebGL: drift the still picture instead.
    const box = document.createElement('div');
    box.className = 'bg-pan';
    box.setAttribute('aria-hidden', 'true');
    box.style.backgroundImage = 'url("/bg/sanctuary.jpg")';
    reveal(box);
  };
  loadAll(PANORAMA_FACES)
    .then((imgs) => {
      const canvas = panoramaCanvas(imgs);
      if (!canvas) return drift();
      canvas.className = 'bg-pan sky';
      canvas.setAttribute('aria-hidden', 'true');
      reveal(canvas);
    })
    .catch(drift);
}

function footer(): HTMLElement {
  const base = siteBase();
  const f = document.createElement('footer');
  f.className = 'site-foot';
  const link = (href: string, text: string) => `<a href="${base}${href}">${text}</a>`;
  f.innerHTML = `
    <div class="sf-brand">
      <strong><span>Arachne</span>.fyi</strong>
      <span>Questions, data requests or business: <a href="mailto:contact@arachne.fyi">contact@arachne.fyi</a></span>
    </div>
    <nav class="sf-links" aria-label="Site">
      <div>${link('/download', 'Download')}${link('/help', 'Help')}${link('/tools', 'Calculators')}${link('/status', 'Status')}${link('/changelog', 'Changelog')}</div>
      <div>${link('/terms', 'Terms')}${link('/privacy', 'Privacy')}${link('/cookies', 'Cookies')}<a href="mailto:contact@arachne.fyi?subject=Data%20request">Data request</a></div>
    </nav>
    <p class="sf-small">Not affiliated with Hypixel Inc., Mojang Studios or Microsoft. &copy; ${new Date().getFullYear()} Arachne.fyi</p>`;
  return f;
}

/** Links to another site (or between arachne.fyi and app.arachne.fyi) open in a new tab. */
function newTabLinks(): void {
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target || a.protocol === 'mailto:' || a.hasAttribute('download')) return;
      if (a.origin !== location.origin || a.dataset.newtab !== undefined) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    },
    true,
  );
}

let started = false;
export function startChrome(opts: { footer?: boolean } = {}): void {
  if (started) return;
  started = true;
  applyBackground();
  newTabLinks();
  if (opts.footer !== false && !document.body.classList.contains('overlay-page')) document.body.append(footer());
}
