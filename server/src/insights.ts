import { KILL_DAMAGE_THRESHOLD, KILL_DAMAGE_WINDOW_MS, WIKI_DROP_AMOUNT, WIKI_DROP_CHANCE, itemName, union, type Segment } from '@arachne/shared';
import type { Db } from './db.ts';
import { hourlyColumn, priceColumn, type Stats } from './stats.ts';

const DAY = 86_400_000;
const FOREVER = Number.MAX_SAFE_INTEGER;
/** A break longer than this ends a session. Same rule as the Overview's "This session". */
const SESSION_GAP_MS = 30 * 60_000;
/** Gaps between a death and the next spawn longer than this are breaks, not downtime. */
const DOWNTIME_MAX_MS = 10 * 60_000;
/** How long a dry-streak answer is reused (see Insights.dryStreaks). */
const DRY_CACHE_MS = 15_000;

/** The drops people wait for. "Dry streak" = kills since the last one. */
export const RARE_DROPS = ['DARK_QUEENS_SOUL_DROP', 'ARACHNE_FANG', 'TARANTULA_EPIC', 'TARANTULA_LEGENDARY'] as const;

/** SQL that is true for a fight that counts as a kill (the same rule Stats uses). */
const KILL = `damage >= ${KILL_DAMAGE_THRESHOLD} AND (damage_ts IS NULL OR damage_ts - death_ts <= ${KILL_DAMAGE_WINDOW_MS})`;

const placeholders = (n: number) => new Array(n).fill('?').join(',');

/**
 * Numbers built on top of Stats for the Overview and the Records page. Everything is read
 * from the index on request, like Stats, so a rule change shows up in all history at once.
 */
export class Insights {
  constructor(
    private readonly db: Db,
    private readonly stats: Stats,
  ) {}

  /** Kill timestamps for a set of accounts, oldest first. */
  private killTimes(ids: readonly string[], from = 0): number[] {
    if (ids.length === 0) return [];
    return this.db
      .all<{ t: number }>(
        `SELECT death_ts AS t FROM fights WHERE account IN (${placeholders(ids.length)}) AND death_ts >= ? AND ${KILL} ORDER BY death_ts`,
        ...ids,
        from,
      )
      .map((r) => r.t);
  }

  /**
   * For each rare drop: kills since it last dropped, the longest run of kills without it,
   * and how many have dropped in total.
   */
  private dryCache = new Map<string, { at: number; version: number; value: ReturnType<Insights['readDryStreaks']> }>();

  /**
   * Dry streaks walk every kill ever made, so the answer is kept for DRY_CACHE_MS, or until
   * new data is indexed: the Overview, badges and titles all ask for it on the same page load.
   */
  dryStreaks(ids: readonly string[], now = Date.now()) {
    const key = [...ids].sort().join(',');
    const hit = this.dryCache.get(key);
    if (hit && hit.version === this.stats.version && now - hit.at >= 0 && now - hit.at < DRY_CACHE_MS) return hit.value;
    const value = this.readDryStreaks(ids);
    this.dryCache.set(key, { at: now, version: this.stats.version, value });
    return value;
  }

  private readDryStreaks(ids: readonly string[]) {
    const kills = this.killTimes(ids);
    return RARE_DROPS.map((item) => {
      const drops =
        ids.length === 0
          ? []
          : this.db
              .all<{ t: number; c: number }>(
                `SELECT ts AS t, count AS c FROM events WHERE kind = 'LOOT' AND item = ? AND account IN (${placeholders(ids.length)}) ORDER BY ts`,
                item,
                ...ids,
              )
              .map((r) => r.t);
      // Walk kills and drops together. A drop belongs to the kill just before it.
      let longest = 0;
      let run = 0;
      let d = 0;
      for (const k of kills) {
        while (d < drops.length && drops[d]! < k) {
          longest = Math.max(longest, run);
          run = 0;
          d++;
        }
        run++;
      }
      if (d < drops.length) {
        longest = Math.max(longest, run);
        run = 0;
      }
      const current = run;
      longest = Math.max(longest, current);
      return {
        item,
        name: itemName(item),
        current,
        longest,
        dropped: drops.length,
        lastAt: drops.at(-1) ?? null,
      };
    });
  }

  /** Loot value of the last `n` kills, oldest first: the "profit per kill" sparkline. */
  recentKills(ids: readonly string[], n = 20) {
    if (ids.length === 0) return [];
    const accounts = new Map(this.stats.accounts().map((a) => [a.uuid, a]));
    const fights = this.db
      .all<{ account: string; fight: string; t: number }>(
        `SELECT account, fight, death_ts AS t FROM fights WHERE account IN (${placeholders(ids.length)}) AND ${KILL}
         ORDER BY death_ts DESC LIMIT ?`,
        ...ids,
        n,
      )
      .reverse();
    return fights.map((f) => {
      const a = accounts.get(f.account);
      const col = a ? priceColumn(a) : 'p_instant';
      const v =
        this.db.get<{ v: number | null }>(
          `SELECT SUM(count * ${col}) AS v FROM events WHERE account = ? AND fight = ? AND kind = 'LOOT'`,
          f.account,
          f.fight,
        )?.v ?? 0;
      return { ts: f.t, value: v };
    });
  }

  /** Average wait between a boss dying and the next one spawning, per account, since `from`. */
  downtime(ids: readonly string[], from: number) {
    let total = 0;
    let gaps = 0;
    for (const id of ids) {
      const rows = this.db.all<{ s: number | null; d: number | null }>(
        'SELECT spawn_ts AS s, death_ts AS d FROM fights WHERE account = ? AND anchor_ts >= ? ORDER BY anchor_ts',
        id,
        from,
      );
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1]!.d;
        const next = rows[i]!.s;
        if (prev == null || next == null) continue;
        const gap = next - prev;
        if (gap > 0 && gap <= DOWNTIME_MAX_MS) {
          total += gap;
          gaps++;
        }
      }
    }
    return { averageMs: gaps > 0 ? total / gaps : null, gaps };
  }

  /** How many different UTC days had at least one kill. */
  daysFarmed(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    return (
      this.db.get<{ n: number }>(
        `SELECT COUNT(DISTINCT death_ts / ${DAY}) AS n FROM fights WHERE account IN (${placeholders(ids.length)}) AND ${KILL}`,
        ...ids,
      )?.n ?? 0
    );
  }

  /** Everything the Overview adds on top of the plain totals. */
  overview(ids: readonly string[], now: number) {
    const today = Math.floor(now / DAY) * DAY;
    return {
      yesterday: this.stats.totals(ids, today - DAY, today),
      daysFarmed: this.daysFarmed(ids),
      dry: this.dryStreaks(ids),
      recentKills: this.recentKills(ids),
      downtime: this.downtime(ids, today),
    };
  }

  /** Personal bests for the Records page. */
  records(ids: readonly string[]) {
    const accounts = this.stats.accounts().filter((a) => ids.includes(a.uuid));
    // Profit per hour and per day, added up across the accounts in their own price modes.
    const hours = new Map<number, number>();
    for (const a of accounts) {
      const col = priceColumn(a);
      const v = hourlyColumn(col);
      for (const r of this.db.all<{ hour: number; p: number }>(
        `SELECT hour, SUM(CASE WHEN kind = 'PLACE' THEN -${v} WHEN kind = 'COINS' THEN amount ELSE ${v} END) AS p
         FROM hourly WHERE account = ? GROUP BY hour`,
        a.uuid,
      )) {
        hours.set(r.hour, (hours.get(r.hour) ?? 0) + r.p);
      }
    }
    const days = new Map<number, number>();
    for (const [h, p] of hours) {
      const d = Math.floor(h / DAY) * DAY;
      days.set(d, (days.get(d) ?? 0) + p);
    }
    const best = (m: Map<number, number>) => {
      let at: number | null = null;
      let value = 0;
      for (const [k, v] of m) {
        if (at === null || v > value) {
          at = k;
          value = v;
        }
      }
      return at === null ? null : { at, value };
    };

    // Best single fight by loot value.
    let bestFight: { at: number; value: number; account: string } | null = null;
    for (const a of accounts) {
      const col = priceColumn(a);
      const r = this.db.get<{ t: number; v: number }>(
        `SELECT MAX(ts) AS t, SUM(count * ${col}) AS v FROM events WHERE account = ? AND kind = 'LOOT' AND fight IS NOT NULL
         GROUP BY fight ORDER BY v DESC LIMIT 1`,
        a.uuid,
      );
      if (r && (!bestFight || r.v > bestFight.value)) bestFight = { at: r.t, value: r.v, account: a.name };
    }

    const kills = this.killTimes(ids);
    const killDays = new Map<number, number>();
    for (const k of kills) {
      const d = Math.floor(k / DAY) * DAY;
      killDays.set(d, (killDays.get(d) ?? 0) + 1);
    }

    const fastest =
      ids.length === 0
        ? null
        : (this.db.get<{ ms: number | null; t: number | null }>(
            `SELECT MIN(death_ts - spawn_ts) AS ms, death_ts AS t FROM fights
             WHERE account IN (${placeholders(ids.length)}) AND confirmed = 1 AND spawn_ts IS NOT NULL AND ${KILL} AND death_ts > spawn_ts`,
            ...ids,
          ) ?? null);

    // Longest session: uptime of all the accounts merged, breaks under 30 minutes joined up.
    const segs = union(accounts.map((a) => this.stats.segments(a.uuid, 0, FOREVER)));
    let longest: Segment | null = null;
    let cur: Segment | null = null;
    for (const s of segs) {
      if (cur && s.start - cur.end < SESSION_GAP_MS) cur = { start: cur.start, end: s.end };
      else cur = { ...s };
      if (!longest || cur.end - cur.start > longest.end - longest.start) longest = cur;
    }

    return {
      bestHour: best(hours),
      bestDay: best(days),
      bestFight,
      mostKillsDay: best(killDays),
      fastestKill: fastest?.ms != null ? { ms: fastest.ms, at: fastest.t } : null,
      longestSession: longest ? { ms: longest.end - longest.start, at: longest.start } : null,
      dry: this.dryStreaks(ids),
      lifetime: { ...this.stats.totals(ids, 0, FOREVER), daysFarmed: this.daysFarmed(ids) },
    };
  }
}

const WEEK_HOURS = 7 * 24;
/** Fights older than this are settled: their drop-rate totals are cached (Views.tierDrops). */
const DROPS_SETTLE_MS = 15 * 60_000;
/** The drop-rate cache is thrown away and rebuilt this often. */
const DROPS_REBUILD_MS = 6 * 60 * 60_000;

/** Extra read-only views for the Graphs and Drops pages. */
export class Views {
  constructor(
    private readonly db: Db,
    private readonly stats: Stats,
  ) {}

  /**
   * Drop-rate totals per account and summon tier, cached. Fights that started more than
   * DROPS_SETTLE_MS ago are added to the cache once; only the newer ones are read again on
   * each request. The cache is rebuilt from scratch every DROPS_REBUILD_MS, so an event that
   * arrives very late (an offline queue flushed days later) shows up within that time.
   */
  private dropCache = new Map<string, { builtAt: number; cleared: number; upTo: number; kills: number; items: Map<string, { fights: number; total: number }> }>();

  private tierDrops(account: string, tier: 'CALLING' | 'CRYSTAL', now: number) {
    const read = (from: number, to: number) => {
      const kills =
        this.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM fights WHERE account = ? AND tier = ? AND anchor_ts > ? AND anchor_ts <= ? AND ${KILL}`,
          account,
          tier,
          from,
          to,
        )?.n ?? 0;
      // A drop counts once per fight it appeared in, whatever the stack size. Driven from the
      // fights (index fights_account_anchor), each fight's loot found with events_account_fight.
      const items = new Map<string, { fights: number; total: number }>();
      for (const r of this.db.all<{ item: string; fights: number; total: number }>(
        `SELECT e.item AS item, COUNT(DISTINCT e.fight) AS fights, SUM(e.count) AS total
         FROM fights f JOIN events e ON e.account = f.account AND e.fight = f.fight AND e.kind = 'LOOT'
         WHERE f.account = ? AND f.tier = ? AND f.anchor_ts > ? AND f.anchor_ts <= ?
         GROUP BY e.item`,
        account,
        tier,
        from,
        to,
      )) {
        items.set(r.item, { fights: r.fights, total: r.total });
      }
      return { kills, items };
    };
    const key = `${account}|${tier}`;
    const settled = now - DROPS_SETTLE_MS;
    let c = this.dropCache.get(key);
    if (!c || c.cleared !== this.stats.cleared || now - c.builtAt > DROPS_REBUILD_MS || settled < c.upTo) {
      c = { builtAt: now, cleared: this.stats.cleared, upTo: -1, kills: 0, items: new Map() };
      this.dropCache.set(key, c);
    }
    if (settled > c.upTo) {
      const add = read(c.upTo, settled);
      c.kills += add.kills;
      for (const [item, r] of add.items) {
        const sum = c.items.get(item) ?? { fights: 0, total: 0 };
        sum.fights += r.fights;
        sum.total += r.total;
        c.items.set(item, sum);
      }
      c.upTo = settled;
    }
    const recent = read(c.upTo, FOREVER);
    const items = new Map([...c.items].map(([item, r]) => [item, { ...r }]));
    for (const [item, r] of recent.items) {
      const sum = items.get(item) ?? { fights: 0, total: 0 };
      sum.fights += r.fights;
      sum.total += r.total;
      items.set(item, sum);
    }
    return { kills: c.kills + recent.kills, items };
  }

  /**
   * How often each item drops per kill, split by summon (callings = Lv300, crystal = Lv500),
   * next to the wiki's base chance where it gives one. "Luck" is observed / expected
   * across the items that have a wiki figure.
   */
  dropRates(ids: readonly string[], now = Date.now()) {
    const out = (['CALLING', 'CRYSTAL'] as const).map((tier) => {
      // Added up per account (see tierDrops), so a year of fights is read once, not per request.
      let kills = 0;
      const byItem = new Map<string, { fights: number; total: number }>();
      for (const account of ids) {
        const t = this.tierDrops(account, tier, now);
        kills += t.kills;
        for (const [item, r] of t.items) {
          const sum = byItem.get(item) ?? { fights: 0, total: 0 };
          sum.fights += r.fights;
          sum.total += r.total;
          byItem.set(item, sum);
        }
      }
      const rows = [...byItem].map(([item, r]) => ({ item, ...r }));
      const expected = WIKI_DROP_CHANCE[tier] as Record<string, number | undefined>;
      const amounts = WIKI_DROP_AMOUNT[tier] as Record<string, { min: number; max: number } | undefined>;
      const items = rows.map((r) => ({
        item: r.item,
        name: itemName(r.item),
        fights: r.fights,
        total: r.total,
        rate: kills > 0 ? r.fights / kills : 0,
        wiki: expected[r.item] ?? null,
        // Guaranteed drops: the average stack per kill, next to the wiki's range.
        perKill: kills > 0 ? r.total / kills : 0,
        wikiAmount: amounts[r.item] ?? null,
      }));
      for (const [item, chance] of Object.entries(expected)) {
        if (!items.some((i) => i.item === item)) items.push({ item, name: itemName(item), fights: 0, total: 0, rate: 0, wiki: chance ?? null, perKill: 0, wikiAmount: null });
      }
      for (const [item, amount] of Object.entries(amounts)) {
        if (!items.some((i) => i.item === item)) items.push({ item, name: itemName(item), fights: 0, total: 0, rate: 0, wiki: null, perKill: 0, wikiAmount: amount ?? null });
      }
      let got = 0;
      let want = 0;
      for (const i of items) {
        if (i.wiki == null) continue;
        got += i.fights;
        want += i.wiki * kills;
      }
      return { tier, kills, luck: want > 0 ? got / want : null, items: items.sort((a, b) => b.rate - a.rate) };
    });
    return { tiers: out };
  }

  /** Profit per hour of farming for each hour of the week (UTC), 0 = Monday 00:00. */
  heatmap(ids: readonly string[], from: number, now: number) {
    const profit = new Array<number>(WEEK_HOURS).fill(0);
    const upMs = new Array<number>(WEEK_HOURS).fill(0);
    const slot = (t: number) => {
      const d = new Date(t);
      return ((d.getUTCDay() + 6) % 7) * 24 + d.getUTCHours();
    };
    for (const a of this.stats.accounts().filter((x) => ids.includes(x.uuid))) {
      const col = priceColumn(a);
      const v = hourlyColumn(col);
      for (const r of this.db.all<{ hour: number; p: number }>(
        `SELECT hour, SUM(CASE WHEN kind = 'PLACE' THEN -${v} WHEN kind = 'COINS' THEN amount ELSE ${v} END) AS p
         FROM hourly WHERE account = ? AND hour >= ? GROUP BY hour`,
        a.uuid,
        from,
      )) {
        profit[slot(r.hour)]! += r.p;
      }
      for (const s of this.stats.segments(a.uuid, from, now)) {
        // Split each uptime segment at hour boundaries.
        let t = Math.max(s.start, from);
        while (t < s.end) {
          const next = Math.min(s.end, (Math.floor(t / 3_600_000) + 1) * 3_600_000);
          upMs[slot(t)]! += next - t;
          t = next;
        }
      }
    }
    return {
      from,
      cells: profit.map((p, i) => ({ profit: p, uptimeMs: upMs[i]!, perHour: upMs[i]! > 60_000 ? (p / upMs[i]!) * 3_600_000 : null })),
    };
  }

  /** Profit and kills per UTC day for the last `days` days, for the calendar. */
  calendar(ids: readonly string[], days: number, now: number) {
    const start = Math.floor(now / DAY) * DAY - (days - 1) * DAY;
    const out = new Map<number, { profit: number; kills: number }>();
    for (let d = start; d <= now; d += DAY) out.set(d, { profit: 0, kills: 0 });
    for (const a of this.stats.accounts().filter((x) => ids.includes(x.uuid))) {
      const col = priceColumn(a);
      const v = hourlyColumn(col);
      for (const r of this.db.all<{ d: number; p: number }>(
        `SELECT (hour / ${DAY}) * ${DAY} AS d, SUM(CASE WHEN kind = 'PLACE' THEN -${v} WHEN kind = 'COINS' THEN amount ELSE ${v} END) AS p
         FROM hourly WHERE account = ? AND hour >= ? GROUP BY d`,
        a.uuid,
        start,
      )) {
        const c = out.get(r.d);
        if (c) c.profit += r.p;
      }
    }
    if (ids.length > 0) {
      for (const r of this.db.all<{ d: number; k: number }>(
        `SELECT (death_ts / ${DAY}) * ${DAY} AS d, COUNT(*) AS k FROM fights
         WHERE account IN (${placeholders(ids.length)}) AND death_ts >= ? AND ${KILL} GROUP BY d`,
        ...ids,
        start,
      )) {
        const c = out.get(r.d);
        if (c) c.kills = r.k;
      }
    }
    return { days: [...out].map(([day, v]) => ({ day, ...v })) };
  }

  /** The same window valued all three ways. */
  whatIf(ids: readonly string[], from: number) {
    const to = Number.MAX_SAFE_INTEGER;
    return {
      actual: this.stats.totals(ids, from, to).profit,
      INSTANT_SELL: this.stats.totals(ids, from, to, 'INSTANT_SELL').profit,
      SELL_OFFER: this.stats.totals(ids, from, to, 'SELL_OFFER').profit,
      NPC: this.stats.totals(ids, from, to, 'NPC').profit,
    };
  }

  /** Damage per fight, in buckets, for the damage histogram. */
  damage(ids: readonly string[], from: number) {
    if (ids.length === 0) return { values: [] };
    return {
      values: this.db
        .all<{ d: number }>(
          `SELECT damage AS d FROM fights WHERE account IN (${placeholders(ids.length)}) AND death_ts >= ? AND damage IS NOT NULL ORDER BY death_ts DESC LIMIT 5000`,
          ...ids,
          from,
        )
        .map((r) => r.d),
    };
  }
}
