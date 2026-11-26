/*
 * Live bosses: the small packets the mod sends the moment a boss spawns or dies
 * (POST /api/v1/live), folded into one record per boss so the website's fight timer is right
 * to the second instead of waiting for the next 30-second batch.
 *
 * Several accounts usually fight the same boss, and each one reports it. Reports belong to
 * the same boss when they carry the same `key` (a hash of the lobby and the summon tier, made
 * by the mod) and are within MATCH_MS of each other. The boss's spawn and death are then the
 * median of everyone's reports, after each client's clock skew is taken out, so one client
 * with a wrong clock or a late chat line can't move the timer. That agreed time is the
 * "source of truth" the dashboard shows.
 *
 * Kept in memory only, for LIVE_KEEP_MS: the batches carry the same SPAWN/DEATH events, and
 * those stay the stored record (fights, kill counts, time to kill).
 */
import type { LiveRequest } from '@arachne/shared';

/** Reports this close together (same key) are one boss. Spawns are ~35s apart, so this can't join two. */
const MATCH_MS = 8_000;
/** A boss is forgotten this long after its last report. */
const LIVE_KEEP_MS = 10 * 60_000;
/** A boss still "alive" after this long was left alone or its death was never reported. */
const MAX_OPEN_MS = 5 * 60_000;
const MAX_BOSSES = 500;

interface Report {
  account: string;
  name: string;
  fight: string;
  spawnTs: number | null;
  deathTs: number | null;
}

interface Boss {
  id: string;
  key: string;
  tier: string;
  reports: Map<string, Report>;
  lastAt: number;
}

export interface LiveBoss {
  id: string;
  tier: string;
  /** Agreed spawn time (median of the reports), epoch ms UTC. Null if only deaths were seen. */
  spawnTs: number | null;
  deathTs: number | null;
  /** How many accounts reported the spawn; more than one means the time was cross-checked. */
  confirmations: number;
  /** Largest gap between one account's spawn time and the agreed one, in ms. */
  spreadMs: number;
  accounts: { uuid: string; name: string }[];
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

export class LiveBosses {
  private readonly bosses = new Map<string, Boss>();
  private seq = 0;

  /**
   * Add one report. `account` is the dash-less UUID, `skew` the client's clock error (server
   * time minus client time, 0 when small), `fallbackKey` the grouping used when the mod could
   * not read the lobby. Returns the boss id, or null for an ignored report.
   */
  report(r: LiveRequest & { account: { uuid: string; name: string } }, skew: number, fallbackKey: string, now: number): string | null {
    this.prune(now);
    const account = r.account.uuid;
    const key = r.key ?? fallbackKey;
    const ts = r.ts + skew;

    // The same account and fight again (a retry, or its death after its spawn).
    for (const b of this.bosses.values()) {
      const mine = b.reports.get(account);
      if (mine && mine.fight === r.fight) {
        if (r.kind === 'SPAWN') mine.spawnTs = ts;
        else mine.deathTs = ts;
        b.lastAt = now;
        if (r.tier && b.tier === 'UNKNOWN') b.tier = r.tier;
        return b.id;
      }
    }

    // Someone else's report of the same boss: same key, close in time, this account not in it yet.
    let best: Boss | null = null;
    let bestGap = Infinity;
    for (const b of this.bosses.values()) {
      if (b.key !== key || b.reports.has(account)) continue;
      const agreed = r.kind === 'SPAWN' ? this.agreed(b).spawnTs : this.agreed(b).deathTs;
      if (agreed == null) continue;
      const gap = Math.abs(agreed - ts);
      if (gap <= MATCH_MS && gap < bestGap) {
        best = b;
        bestGap = gap;
      }
    }
    const boss =
      best ??
      ((): Boss => {
        const b: Boss = { id: `b${now.toString(36)}${(this.seq++).toString(36)}`, key, tier: r.tier ?? 'UNKNOWN', reports: new Map(), lastAt: now };
        this.bosses.set(b.id, b);
        return b;
      })();
    boss.reports.set(account, {
      account,
      name: r.account.name,
      fight: r.fight,
      spawnTs: r.kind === 'SPAWN' ? ts : null,
      deathTs: r.kind === 'DEATH' ? ts : null,
    });
    boss.lastAt = now;
    if (r.tier && boss.tier === 'UNKNOWN') boss.tier = r.tier;
    return boss.id;
  }

  /** Bosses that any of `accounts` reported, newest first. */
  visible(accounts: ReadonlySet<string>, now: number): LiveBoss[] {
    this.prune(now);
    const out: LiveBoss[] = [];
    for (const b of this.bosses.values()) {
      const seen = [...b.reports.values()].filter((r) => accounts.has(r.account));
      if (seen.length === 0) continue;
      const a = this.agreed(b);
      // A boss nobody reported dying within MAX_OPEN_MS is over, not "still fighting".
      if (a.deathTs == null && a.spawnTs != null && now - a.spawnTs > MAX_OPEN_MS) continue;
      out.push({ id: b.id, tier: b.tier, ...a, accounts: seen.map((r) => ({ uuid: r.account, name: r.name })) });
    }
    return out.sort((x, y) => (y.spawnTs ?? y.deathTs ?? 0) - (x.spawnTs ?? x.deathTs ?? 0));
  }

  private agreed(b: Boss) {
    const spawns = [...b.reports.values()].flatMap((r) => (r.spawnTs == null ? [] : [r.spawnTs]));
    const deaths = [...b.reports.values()].flatMap((r) => (r.deathTs == null ? [] : [r.deathTs]));
    const spawnTs = median(spawns);
    const deathTs = median(deaths);
    return {
      spawnTs,
      deathTs,
      confirmations: spawns.length,
      spreadMs: spawnTs == null ? 0 : Math.max(0, ...spawns.map((t) => Math.abs(t - spawnTs))),
    };
  }

  private prune(now: number) {
    for (const [id, b] of this.bosses) if (now - b.lastAt > LIVE_KEEP_MS) this.bosses.delete(id);
    if (this.bosses.size > MAX_BOSSES) {
      const oldest = [...this.bosses.values()].sort((a, b) => a.lastAt - b.lastAt).slice(0, this.bosses.size - MAX_BOSSES);
      for (const b of oldest) this.bosses.delete(b.id);
    }
  }
}
