/**
 * Game rules the server applies to raw events. They live here, not in the mod, so a
 * rule change never needs a new jar and old data can be re-derived (`npm run rebuild-index`).
 */

/** A kill needs "Your Damage" at or above this... */
export const KILL_DAMAGE_THRESHOLD = 10_000;
/** ...reported within this long after "ARACHNE DOWN!". */
export const KILL_DAMAGE_WINDOW_MS = 5_000;

/** Uptime ends this long after the last boss died if no new boss has spawned. */
export const UPTIME_GRACE_MS = 30_000;
/** A fight with no death/interrupt signal stops extending uptime after this long. */
export const UPTIME_MAX_OPEN_FIGHT_MS = 5 * 60_000;

/** The mod sends a batch about this often; the server can change it per reply. */
export const DEFAULT_POLL_MS = 30_000;
/** An account is shown as online if a batch arrived within this window. */
export const ONLINE_WINDOW_MS = 90_000;

export const MAX_BATCH_EVENTS = 500;

/**
 * The Alpha Hypixel Network (alpha.hypixel.net) is Hypixel's test server: items, drops and
 * coins there are not real, so its events are never stored. Decided here, on the server,
 * from what the client saw: the address it joined, the server's brand and its MOTD.
 */
export function isAlphaOrigin(o: { host: string | null; brand: string | null; motd: string | null } | undefined): boolean {
  if (!o) return false;
  const host = (o.host ?? '').toLowerCase().trim().replace(/:\d+$/, '').replace(/\.$/, '');
  if (host === 'alpha.hypixel.net' || host.endsWith('.alpha.hypixel.net')) return true;
  return /\balpha\b/i.test(o.brand ?? '') || /\balpha\b/i.test(o.motd ?? '');
}

/** Events timestamped further in the future than this (after skew correction) are rejected. */
export const MAX_FUTURE_MS = 10 * 60_000;
