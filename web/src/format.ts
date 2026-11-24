import { settings } from './settings.ts';

/** Display helpers. Everything the server sends is UTC epoch ms; the browser shows local time. */

/** 1234567 → "1.23M". Coins are whole numbers in game, so small values show no decimals. */
export function coins(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (settings().numbers === 'full') return `${sign}${Math.round(abs).toLocaleString('en-GB')}`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(1)}k`;
  return `${sign}${Math.round(abs).toLocaleString('en-GB')}`;
}

export const int = (value: number) => Math.round(value).toLocaleString('en-GB');

/** 3 725 000 ms → "1h 02m". Under a minute shows seconds. */
export function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** The time zone setting, as Intl wants it (undefined = this computer's zone). */
const zone = () => (settings().tz === 'utc' ? 'UTC' : undefined);

export const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: zone() });

export const shortClock = (ts: number) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone() });

export const dayLabel = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: zone() });

export const dateTime = (ts: number) =>
  new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zone() }) +
  (settings().tz === 'utc' ? ' UTC' : '');

export const bytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);

/**
 * One colour per account, kept inside the orange/grey theme: oranges and ambers alternate
 * with whites and greys so neighbouring accounts are easy to tell apart.
 */
export const ACCOUNT_COLOURS = ['#ffa62b', '#f5ecdb', '#ffd27a', '#9c8f7c', '#ff7a3d', '#d9b48a', '#6b6052', '#ffe9bf'];
export const accountColour = (index: number) => ACCOUNT_COLOURS[index % ACCOUNT_COLOURS.length]!;

/** Minecraft head for an account (an outside service, so it may fail to load; callers hide it then). */
export const headUrl = (uuid: string) => `https://mc-heads.net/avatar/${uuid}/24`;

/** Always the full number, for tooltips next to a short one. */
export const fullCoins = (value: number) => `${value < 0 ? '−' : ''}${Math.round(Math.abs(value)).toLocaleString('en-GB')}`;

/** A title for how many kills someone has. Just for fun. */
const RANKS: [number, string][] = [
  [5000, "Arachne's Bane"],
  [2500, 'Sanctuary Warden'],
  [1000, "Queen's Hunter"],
  [500, 'Venom Fang'],
  [250, 'Brood Keeper'],
  [100, 'Den Crawler'],
  [50, 'Silk Weaver'],
  [10, 'Web Spinner'],
  [0, 'Hatchling'],
];
export function rankTitle(kills: number): { title: string; next: number | null } {
  const i = RANKS.findIndex(([n]) => kills >= n);
  return { title: RANKS[i]![1], next: i > 0 ? RANKS[i - 1]![0] : null };
}

/** "18:00 to 19:30" style summary of a time span. */
export const span = (from: number, to: number) => `${shortClock(from)} to ${shortClock(to)}`;
