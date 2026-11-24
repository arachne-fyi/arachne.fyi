import {
  EMPTY_TOTALS,
  KILL_DAMAGE_THRESHOLD,
  KILL_DAMAGE_WINDOW_MS,
  ONLINE_WINDOW_MS,
  RNG_ITEMS,
  WINDOWS,
  clipMs,
  fightOutcome,
  itemName,
  union,
  type Segment,
  type Totals,
  type Window,
  type WindowTotals,
} from '@arachne/shared';
import type { Db } from './db.ts';
import { toFacts } from './indexer.ts';

export type PriceMode = 'INSTANT_SELL' | 'SELL_OFFER' | 'NPC';

interface AccountRow {
  uuid: string;
  user_id: number | null;
  name: string;
  price_mode: PriceMode;
  ironman: number;
  first_seen: number;
  last_seen: number;
  mod_version: string | null;
  state_json: string | null;
  /** The owner's choice: armour valued as the item, or as the essence it salvages into. */
  armour?: 'ITEM' | 'ESSENCE';
}

const FOREVER = Number.MAX_SAFE_INTEGER;
/** Accounts with their owner's armour choice attached. */
const ACCOUNTS = `SELECT a.*, COALESCE(p.armour, 'ITEM') AS armour FROM state.accounts a
  LEFT JOIN state.user_prefs p ON p.user_id = a.user_id`;
const HOUR = 3_600_000;
const SESSION_GAP_MS = 30 * 60_000;

interface Sum {
  kind: string;
  item: string | null;
  c: number;
  v: number;
  amt: number;
}

/** Start of each window. `today` is the UTC day, matching the UTC day files. */
export function windowStart(window: Window, now: number): number {
  if (window === 'today') return Math.floor(now / 86_400_000) * 86_400_000;
  if (window === 'week') return now - 7 * 86_400_000;
  return 0;
}

export type PriceColumn = 'p_instant' | 'p_offer' | 'p_npc' | 'pe_instant' | 'pe_offer';

/**
 * The value column an account's settings select. Ironman always sells to NPCs, and essence
 * only has a Bazaar price, so NPC mode keeps armour at its NPC price whatever the setting.
 */
export function priceColumn(a: Pick<AccountRow, 'price_mode' | 'ironman'> & { armour?: string }): PriceColumn {
  if (a.ironman || a.price_mode === 'NPC') return 'p_npc';
  const essence = a.armour === 'ESSENCE';
  if (a.price_mode === 'SELL_OFFER') return essence ? 'pe_offer' : 'p_offer';
  return essence ? 'pe_instant' : 'p_instant';
}

/** The matching column of the hourly table (p_instant -> v_instant, pe_offer -> ve_offer). */
export const hourlyColumn = (col: PriceColumn) => col.replace(/^p/, 'v') as 'v_instant' | 'v_offer' | 'v_npc' | 've_instant' | 've_offer';

/**
 * The read path: every number the dashboard and the HUD show is computed here from the
 * index. Nothing is stored pre-aggregated, so changing a rule or a price mode takes
 * effect immediately for all history.
 */
export class Stats {
  private cache = new Map<string, { at: number; value: Totals }>();
  private focusCache = new Map<string, { at: number; value: { soulString: number; essence: number } }>();

  constructor(private readonly db: Db) {}

  invalidate(): void {
    this.cache.clear();
    this.focusCache.clear();
  }

  accounts(userId?: number): AccountRow[] {
    return userId === undefined
      ? this.db.all<AccountRow>(`${ACCOUNTS} ORDER BY a.name COLLATE NOCASE`)
      : this.db.all<AccountRow>(`${ACCOUNTS} WHERE a.user_id = ? ORDER BY a.name COLLATE NOCASE`, userId);
  }

  accountIds(userId?: number): string[] {
    return this.accounts(userId).map((a) => a.uuid);
  }

  onlineCount(now: number): number {
    return (
      this.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM state.accounts WHERE last_seen >= ?',
        now - ONLINE_WINDOW_MS,
      )?.n ?? 0
    );
  }

  segments(account: string, from: number, to: number): Segment[] {
    return this.db.all<Segment>(
      'SELECT start, end FROM uptime WHERE account = ? AND end > ? AND start < ? ORDER BY start',
      account,
      from,
      to,
    );
  }

  /**
   * Money and counts for one account over [from, to), grouped by kind and item.
   *
   * Whole hours come from the `hourly` table (a few rows per hour); only the ragged edges,
   * the part of an hour before the first whole hour and after the last, are summed from
   * raw events. So a month of history costs about as much as a day.
   */
  private sums(account: AccountRow, from: number, to: number): Sum[] {
    const col = priceColumn(account);
    const valueCol = hourlyColumn(col);
    const out = new Map<string, Sum>();
    const add = (r: Sum) => {
      const key = `${r.kind}|${r.item ?? ''}`;
      const cur = out.get(key);
      if (cur) {
        cur.c += r.c;
        cur.v += r.v;
        cur.amt += r.amt;
      } else out.set(key, { ...r, item: r.item || null });
    };
    const raw = (a: number, b: number) => {
      if (b <= a) return;
      for (const r of this.db.all<Sum>(
        `SELECT kind, item, SUM(count) AS c, SUM(count * ${col}) AS v, SUM(amount) AS amt
         FROM events WHERE account = ? AND ts >= ? AND ts < ? AND kind IN ('LOOT', 'PLACE', 'COINS')
         GROUP BY kind, item`,
        account.uuid,
        a,
        b,
      )) {
        add(r);
      }
    };
    const firstHour = Math.ceil(from / HOUR) * HOUR;
    const lastHour = to >= FOREVER ? FOREVER : Math.floor(to / HOUR) * HOUR;
    if (firstHour >= lastHour) {
      raw(from, to);
    } else {
      raw(from, firstHour);
      for (const r of this.db.all<Sum>(
        `SELECT kind, item, SUM(count) AS c, SUM(${valueCol}) AS v, SUM(amount) AS amt
         FROM hourly WHERE account = ? AND hour >= ? AND hour < ? GROUP BY kind, item`,
        account.uuid,
        firstHour,
        lastHour,
      )) {
        add(r);
      }
      if (lastHour < FOREVER) raw(lastHour, to);
    }
    return [...out.values()];
  }

  /** Totals for one account over [from, to). Rates are filled in by `combine`. */
  private accountTotals(account: AccountRow, from: number, to: number): Totals {
    const t: Totals = { ...EMPTY_TOTALS };
    const rows = this.sums(account, from, to);
    for (const r of rows) {
      if (r.kind === 'LOOT') t.lootValue += r.v;
      else if (r.kind === 'COINS') t.coins += r.amt;
      else {
        t.costs += r.v;
        if (r.item === 'ARACHNE_CRYSTAL') t.crystals += r.c;
        else t.callings += r.c;
      }
    }
    const fights = this.db.get<{ fights: number; kills: number | null }>(
      `SELECT COUNT(*) AS fights,
              SUM(CASE WHEN damage >= ? AND (damage_ts IS NULL OR damage_ts - death_ts <= ?) THEN 1 ELSE 0 END) AS kills
       FROM fights WHERE account = ? AND death_ts >= ? AND death_ts < ?`,
      KILL_DAMAGE_THRESHOLD,
      KILL_DAMAGE_WINDOW_MS,
      account.uuid,
      from,
      to,
    );
    t.fights = fights?.fights ?? 0;
    t.kills = fights?.kills ?? 0;
    t.profit = t.lootValue + t.coins - t.costs;
    t.uptimeMs = clipMs(this.segments(account.uuid, from, to), from, to);
    return t;
  }

  /** Combined totals for a set of accounts over [from, to). */
  totals(accountIds: readonly string[], from: number, to: number, mode?: PriceMode): Totals {
    const wanted = new Set(accountIds);
    // `mode` values every account one way, for "what if I had sold differently".
    const accounts = this.accounts()
      .filter((a) => wanted.has(a.uuid))
      .map((a) => (mode ? { ...a, price_mode: mode, ironman: 0 } : a));
    const sum: Totals = { ...EMPTY_TOTALS };
    for (const a of accounts) {
      const t = this.accountTotals(a, from, to);
      for (const key of ['kills', 'fights', 'crystals', 'callings', 'lootValue', 'coins', 'costs', 'profit', 'uptimeMs'] as const) {
        sum[key] += t[key];
      }
    }
    const wall = union(accounts.map((a) => this.segments(a.uuid, from, to)));
    sum.wallUptimeMs = clipMs(wall, from, to);
    // Two different "per hour" figures, deliberately kept apart:
    //   per client-hour: what one account earns per hour it is up (sum of uptime)
    //   per wall-hour:   what the whole set earns per real hour (overlap counted once)
    sum.profitPerClientHour = sum.uptimeMs > 0 ? (sum.profit / sum.uptimeMs) * 3_600_000 : 0;
    sum.profitPerWallHour = sum.wallUptimeMs > 0 ? (sum.profit / sum.wallUptimeMs) * 3_600_000 : 0;
    return sum;
  }

  window(accountIds: readonly string[], window: Window, now: number): Totals {
    const key = `${window}|${[...accountIds].sort().join(',')}`;
    const hit = this.cache.get(key);
    if (hit && now - hit.at < 5_000) return hit.value;
    const value = this.totals(accountIds, windowStart(window, now), FOREVER);
    this.cache.set(key, { at: now, value });
    return value;
  }

  windows(accountIds: readonly string[], now: number): WindowTotals {
    return {
      today: this.window(accountIds, 'today', now),
      week: this.window(accountIds, 'week', now),
      all: this.window(accountIds, 'all', now),
    };
  }

  /**
   * The group the HUD shows: the user's first group (by join date), leaving out members who
   * keep their numbers private (the user always counts). Someone in no group gets just
   * themselves, so "group" never means everyone on the server.
   */
  hudGroup(userId: number): { tag: string | null; userIds: number[] } {
    const g = this.db.get<{ id: number; tag: string }>(
      'SELECT g.id, g.tag FROM state.group_members m JOIN state.groups g ON g.id = m.group_id WHERE m.user_id = ? ORDER BY m.joined_at LIMIT 1',
      userId,
    );
    if (!g) return { tag: null, userIds: [userId] };
    const hidden = new Set(this.db.all<{ user_id: number }>('SELECT user_id FROM state.privacy WHERE visible = 0').map((r) => r.user_id));
    const userIds = this.db
      .all<{ user_id: number }>('SELECT user_id FROM state.group_members WHERE group_id = ?', g.id)
      .map((r) => r.user_id)
      .filter((id) => id === userId || !hidden.has(id));
    return { tag: g.tag, userIds };
  }

  /** Accounts of the HUD's group. */
  hudGroupAccountIds(userId: number): string[] {
    return this.hudGroup(userId).userIds.flatMap((id) => this.accountIds(id));
  }

  /** Soul String and Spider Essence counts per window, for the HUD (scavenger coins are `coins` in the totals). */
  focus(accountIds: readonly string[], now: number): Record<Window, { soulString: number; essence: number }> {
    const one = (w: Window) => {
      const key = `focus|${w}|${[...accountIds].sort().join(',')}`;
      const hit = this.focusCache.get(key);
      if (hit && now - hit.at < 5_000) return hit.value;
      const rows = this.lootTable(accountIds, windowStart(w, now), FOREVER);
      const count = (item: string) => rows.find((r) => r.item === item)?.count ?? 0;
      const value = { soulString: count('SOUL_STRING'), essence: count('ESSENCE_SPIDER') };
      this.focusCache.set(key, { at: now, value });
      return value;
    };
    return { today: one('today'), week: one('week'), all: one('all') };
  }

  /** Accounts in the given set that sent a batch recently. */
  onlineAmong(accountIds: readonly string[], now: number): number {
    const wanted = new Set(accountIds);
    return this.db
      .all<{ uuid: string }>('SELECT uuid FROM state.accounts WHERE last_seen >= ?', now - ONLINE_WINDOW_MS)
      .filter((r) => wanted.has(r.uuid)).length;
  }

  /** Per-account cards for the dashboard. */
  accountCards(now: number, owners: Map<number, string>) {
    return this.accounts().map((a) => {
      const live = this.db.get<{ end: number }>(
        'SELECT end FROM uptime WHERE account = ? ORDER BY start DESC LIMIT 1',
        a.uuid,
      );
      return {
        uuid: a.uuid,
        name: a.name,
        userId: a.user_id,
        owner: a.user_id != null ? (owners.get(a.user_id) ?? 'unknown') : 'unassigned',
        priceMode: a.price_mode,
        ironman: !!a.ironman,
        modVersion: a.mod_version,
        firstSeen: a.first_seen,
        lastSeen: a.last_seen,
        online: now - a.last_seen <= ONLINE_WINDOW_MS,
        /** True while the uptime clock is running for this account. */
        up: !!live && now - live.end < 5_000,
        state: a.state_json ? (JSON.parse(a.state_json) as { inArea: boolean; fighting: boolean; queued: number }) : null,
        totals: this.windows([a.uuid], now),
      };
    });
  }

  /** Bucketed history for graphs. */
  /**
   * The latest farming session: the most recent stretch where at least one account was
   * up, treating breaks shorter than 30 minutes as part of the same session.
   */
  sessionSpan(now: number): { start: number; end: number } | null {
    const segs = union(
      this.db.all<Segment>('SELECT start, end FROM uptime ORDER BY start DESC LIMIT 5000').map((x) => [x]),
    );
    if (segs.length === 0) return null;
    let i = segs.length - 1;
    const end = segs[i]!.end;
    let start = segs[i]!.start;
    while (i > 0 && start - segs[i - 1]!.end < SESSION_GAP_MS) start = segs[--i]!.start;
    // A session still running ends "now", so the chart's right edge is the present.
    return { start, end: now - end < SESSION_GAP_MS ? Math.max(end, now) : end };
  }

  /** Bucketed history for graphs: a fixed range, or the latest session. */
  series(range: '24h' | '7d' | '30d' | 'session', now: number) {
    let bucketMs: number;
    let from: number;
    let n: number;
    let empty = false;
    const session = range === 'session' ? this.sessionSpan(now) : null;
    if (session) {
      // About 60 bars across the session, using the first "round" bar size that fits
      // (5 minutes, 15 minutes, 1 hour, ...) so labels read "every 15 minutes", not "every 31".
      const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440].map((m) => m * 60_000);
      const want = (session.end - session.start) / 60;
      bucketMs = STEPS.find((step) => step >= want) ?? 1440 * 60_000;
      from = Math.floor(session.start / bucketMs) * bucketMs;
      n = Math.max(1, Math.ceil((session.end - from) / bucketMs));
    } else {
      empty = range === 'session';
      const r = range === 'session' ? '24h' : range;
      bucketMs = r === '24h' ? 15 * 60_000 : r === '7d' ? 2 * HOUR : 86_400_000;
      const span = r === '24h' ? 86_400_000 : r === '7d' ? 7 * 86_400_000 : 30 * 86_400_000;
      // Align bucket edges to the clock so bars do not shift on every refresh.
      from = Math.ceil(now / bucketMs) * bucketMs - span;
      n = span / bucketMs;
    }
    const to = from + n * bucketMs;
    // Whole-hour buckets can be filled from the hourly table instead of every event.
    const table = from % HOUR === 0 && bucketMs % HOUR === 0 ? 'hourly' : 'events';
    const zeros = () => new Array<number>(n).fill(0);
    const accounts = this.accounts().map((a) => {
      const col = priceColumn(a);
      const profit = zeros();
      const loot = zeros();
      const coins = zeros();
      const costs = zeros();
      const crystals = zeros();
      const kills = zeros();
      const uptimeMs = zeros();
      const valueCol = hourlyColumn(col);
      const sql =
        table === 'hourly'
          ? `SELECT CAST((hour - ?) / ? AS INTEGER) AS b,
                SUM(CASE WHEN kind = 'LOOT' THEN ${valueCol} ELSE 0 END) AS loot,
                SUM(CASE WHEN kind = 'COINS' THEN amount ELSE 0 END) AS coins,
                SUM(CASE WHEN kind = 'PLACE' THEN ${valueCol} ELSE 0 END) AS costs,
                SUM(CASE WHEN kind = 'PLACE' AND item = 'ARACHNE_CRYSTAL' THEN count ELSE 0 END) AS crystals
             FROM hourly WHERE account = ? AND hour >= ? AND hour < ? GROUP BY b`
          : `SELECT CAST((ts - ?) / ? AS INTEGER) AS b,
                SUM(CASE WHEN kind = 'LOOT' THEN count * ${col} ELSE 0 END) AS loot,
                SUM(CASE WHEN kind = 'COINS' THEN amount ELSE 0 END) AS coins,
                SUM(CASE WHEN kind = 'PLACE' THEN count * ${col} ELSE 0 END) AS costs,
                SUM(CASE WHEN kind = 'PLACE' AND item = 'ARACHNE_CRYSTAL' THEN count ELSE 0 END) AS crystals
             FROM events WHERE account = ? AND ts >= ? AND ts < ? GROUP BY b`;
      for (const r of this.db.all<{ b: number; loot: number; coins: number; costs: number; crystals: number }>(
        sql,
        from,
        bucketMs,
        a.uuid,
        from,
        to,
      )) {
        if (r.b < 0 || r.b >= n) continue;
        loot[r.b] = r.loot;
        coins[r.b] = r.coins;
        costs[r.b] = r.costs;
        crystals[r.b] = r.crystals;
        profit[r.b] = r.loot + r.coins - r.costs;
      }
      for (const r of this.db.all<{ b: number; k: number }>(
        `SELECT CAST((death_ts - ?) / ? AS INTEGER) AS b, COUNT(*) AS k FROM fights
         WHERE account = ? AND death_ts >= ? AND death_ts < ?
           AND damage >= ? AND (damage_ts IS NULL OR damage_ts - death_ts <= ?) GROUP BY b`,
        from,
        bucketMs,
        a.uuid,
        from,
        to,
        KILL_DAMAGE_THRESHOLD,
        KILL_DAMAGE_WINDOW_MS,
      )) {
        if (r.b >= 0 && r.b < n) kills[r.b] = r.k;
      }
      const segments = this.segments(a.uuid, from, to);
      for (let i = 0; i < n && segments.length > 0; i++) {
        uptimeMs[i] = clipMs(segments, from + i * bucketMs, from + (i + 1) * bucketMs);
      }
      return { uuid: a.uuid, name: a.name, profit, loot, coins, costs, crystals, kills, uptimeMs, segments };
    });
    const wall = union(accounts.map((a) => a.segments));
    const wallUptimeMs = zeros();
    for (let i = 0; i < n && wall.length > 0; i++) {
      wallUptimeMs[i] = clipMs(wall, from + i * bucketMs, from + (i + 1) * bucketMs);
    }
    return { range, from, to, bucketMs, buckets: n, empty, accounts, wallUptimeMs };
  }

  /** One row per person. */
  leaderboard(window: Window, now: number, users: { id: number; name: string }[]) {
    const from = windowStart(window, now);
    return users
      .map((u) => {
        const ids = this.accountIds(u.id);
        const totals = this.totals(ids, from, FOREVER);
        const rng = this.lootTable(ids, from, FOREVER).filter((l) => RNG_ITEMS.has(l.item));
        return {
          userId: u.id,
          name: u.name,
          accounts: ids.length,
          totals,
          rngDrops: rng.reduce((n, l) => n + l.count, 0),
        };
      })
      .filter((r) => r.accounts > 0);
  }

  /** Loot by item for a set of accounts. */
  lootTable(accountIds: readonly string[], from: number, to: number) {
    const wanted = new Set(accountIds);
    const byItem = new Map<string, { item: string; name: string; count: number; value: number }>();
    for (const a of this.accounts()) {
      if (!wanted.has(a.uuid)) continue;
      for (const r of this.sums(a, from, to)) {
        if (r.kind !== 'LOOT' || !r.item) continue;
        const row = byItem.get(r.item) ?? { item: r.item, name: itemName(r.item), count: 0, value: 0 };
        row.count += r.c;
        row.value += r.v;
        byItem.set(r.item, row);
      }
    }
    return [...byItem.values()].sort((a, b) => b.value - a.value);
  }

  /** Newest events first, for the live feed. */
  recentEvents(limit: number, account?: string) {
    const rows = account
      ? this.db.all<EventRow>('SELECT * FROM events WHERE account = ? ORDER BY ts DESC LIMIT ?', account, limit)
      : this.db.all<EventRow>('SELECT * FROM events ORDER BY ts DESC LIMIT ?', limit);
    const names = new Map(this.accounts().map((a) => [a.uuid, a]));
    return rows.map((r) => {
      const a = names.get(r.account);
      const unit = a ? r[priceColumn(a)] : r.p_instant;
      return {
        id: r.id,
        ts: r.ts,
        receivedAt: r.received_at,
        account: r.account,
        accountName: a?.name ?? r.account.slice(0, 8),
        kind: r.kind,
        fight: r.fight,
        item: r.item,
        itemName: r.item ? itemName(r.item) : null,
        count: r.count,
        value: r.kind === 'COINS' ? r.amount : r.count * unit,
        source: r.source,
        /** DAMAGE events only: the damage the fight row recorded. */
        damage:
          r.kind === 'DAMAGE' && r.fight
            ? (this.db.get<{ damage: number | null }>(
                'SELECT damage FROM fights WHERE account = ? AND fight = ?',
                r.account,
                r.fight,
              )?.damage ?? null)
            : null,
      };
    });
  }

  recentFights(limit: number) {
    const names = new Map(this.accounts().map((a) => [a.uuid, a.name]));
    return this.db
      .all<{
        account: string;
        fight: string;
        spawn_ts: number | null;
        death_ts: number | null;
        damage: number | null;
        damage_ts: number | null;
        interrupt_ts: number | null;
        tier: string;
        confirmed: number;
        anchor_ts: number;
      }>('SELECT * FROM fights ORDER BY anchor_ts DESC LIMIT ?', limit)
      .map((f) => ({
        account: f.account,
        accountName: names.get(f.account) ?? f.account.slice(0, 8),
        fight: f.fight,
        ts: f.anchor_ts,
        tier: f.tier,
        confirmed: !!f.confirmed,
        damage: f.damage,
        durationMs: f.spawn_ts != null && f.death_ts != null && f.confirmed ? f.death_ts - f.spawn_ts : null,
        outcome: fightOutcome(toFacts(f)),
      }));
  }
}

interface EventRow {
  id: string;
  account: string;
  ts: number;
  kind: string;
  fight: string | null;
  item: string | null;
  count: number;
  amount: number;
  p_instant: number;
  p_offer: number;
  p_npc: number;
  pe_instant: number;
  pe_offer: number;
  source: string | null;
  received_at: number;
}

export { WINDOWS };
