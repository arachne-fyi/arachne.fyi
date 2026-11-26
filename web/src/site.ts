/*
 * Shared script for every public page in the new style (landing, download, help, tools, status,
 * changelog, legal pages, profiles and sign-in). Plain DOM, no React, so the pages stay small.
 *
 * It fixes links between the two hostnames, shows who is signed in, opens the phone menu and
 * swaps every <select> for the custom dropdown. The header and footer HTML come from
 * web/partials/ at build time (site-partials.ts).
 */
import './landing.css';
import './site.css';
import { enhanceSelects } from './dropdown.ts';
import { offlineBanner } from './offline.ts';

const host = location.hostname;
const local = host === 'localhost' || host === '127.0.0.1';
/** On app.<domain> (the dashboard host), or on this PC where both live on one site. */
export const onDashboardHost = local || host.startsWith('app.');
/** Where the dashboard is: app.<domain>, or this site when running locally. */
export const dashboard = onDashboardHost ? '/' : `${location.protocol}//app.${host}/`;
/** Where the landing page is: <domain> when we are on app.<domain>, else this site. */
const home = host.startsWith('app.') ? `${location.protocol}//${host.slice(4)}` : '';

document.querySelectorAll<HTMLAnchorElement>('a.dashboard-link').forEach((a) => (a.href = dashboard));
// "/" on the dashboard host is the dashboard, so Home links point back at the landing host.
if (home) document.querySelectorAll<HTMLAnchorElement>('a[data-home]').forEach((a) => (a.href = home + (a.getAttribute('href') ?? '/')));
// Sign-in lives on the dashboard host, because that is where the login cookie is set.
const signIn = document.querySelector<HTMLAnchorElement>('a[data-signin]');
if (signIn) signIn.href = `${dashboard}signin`;
document.querySelectorAll<HTMLAnchorElement>('a[data-dashboard-path]').forEach((a) => (a.href = dashboard + (a.dataset.dashboardPath ?? '')));

// Phone menu.
const toggle = document.querySelector<HTMLButtonElement>('.nav-toggle');
const bar = document.querySelector('.top-bar');
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  bar?.classList.toggle('menu-open', open);
});

enhanceSelects();
offlineBanner();

export interface Me {
  user: { id: number; name: string; avatar: string | null; role: 'admin' | 'user' } | null;
  consent: { version: string; accepted: boolean } | null;
  openSignup: boolean;
  devAuth: boolean;
  discord: boolean;
}

/** Who is signed in. Only answerable on the dashboard host: the login cookie is not sent anywhere else. */
export async function whoAmI(): Promise<Me | null> {
  if (!onDashboardHost) return null;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    return res.ok ? ((await res.json()) as Me) : null;
  } catch {
    return null;
  }
}

// Signed in: the header button becomes your name and opens the dashboard.
if (signIn && onDashboardHost && !document.body.dataset.noMe) {
  void whoAmI().then((me) => {
    if (!me?.user) return;
    signIn.href = dashboard;
    signIn.classList.add('signed-in');
    signIn.replaceChildren();
    if (me.user.avatar) {
      const img = document.createElement('img');
      img.src = me.user.avatar;
      img.alt = '';
      img.width = 24;
      img.height = 24;
      signIn.append(img);
    }
    signIn.append(el('span', '', me.user.name));
    signIn.setAttribute('aria-label', `Signed in as ${me.user.name}. Open the dashboard`);
  });
}

// ---- small helpers the page scripts share ----------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** "Full numbers" from the dashboard's settings, if this browser has them. */
function fullNumbers(): boolean {
  try {
    return (JSON.parse(localStorage.getItem('arachne-settings') ?? '{}') as { numbers?: string }).numbers === 'full';
  } catch {
    return false;
  }
}

/** 1234567 → "1.23M", like the dashboard. */
export function coins(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (fullNumbers()) return `${sign}${Math.round(abs).toLocaleString('en-GB')}`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(1)}k`;
  return `${sign}${Math.round(abs).toLocaleString('en-GB')}`;
}

export const int = (n: number) => Math.round(n).toLocaleString('en-GB');

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Dates in UTC, like the rest of the site. */
export function day(ts: number): string {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export type Channel = 'Release' | 'Beta' | 'Nightly';
/**
 * Release channel from a mod version, until the admin panel can set it: "nightly" or "snapshot"
 * is Nightly, alpha/beta/rc/pre is Beta, anything else is a Release.
 */
export function channelOf(mod: string): Channel {
  if (/nightly|snapshot/i.test(mod)) return 'Nightly';
  if (/alpha|beta|rc|pre/i.test(mod)) return 'Beta';
  return 'Release';
}

export function tag(channel: Channel): HTMLElement {
  return el('span', `px tag tag-${channel.toLowerCase()}`, channel);
}
