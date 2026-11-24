import { ITEMS, KILL_DAMAGE_THRESHOLD, KILL_DAMAGE_WINDOW_MS, itemName, rarity } from '@arachne/shared';
import type { Db } from './db.ts';
import type { Insights } from './insights.ts';
import { priceColumn, type Stats } from './stats.ts';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const KILL = `damage >= ${KILL_DAMAGE_THRESHOLD} AND (damage_ts IS NULL OR damage_ts - death_ts <= ${KILL_DAMAGE_WINDOW_MS})`;
const ph = (n: number) => new Array(n).fill('?').join(',');

/** Monday 00:00 UTC of the week containing `t`. */
export function weekStart(t: number): number {
  const day = Math.floor(t / DAY) * DAY;
  const dow = (new Date(day).getUTCDay() + 6) % 7;
  return day - dow * DAY;
}

/** ISO-ish week number since 1970, used to rotate the weekly quests. */
const weekNumber = (t: number) => Math.floor((weekStart(t) - weekStart(0)) / WEEK);

interface QuestDef {
  id: string;
  text: string;
  goal: number;
  metric: 'kills' | 'crystals' | 'profit' | 'hours' | 'rare' | 'days';
}

/** Twelve quests; three a week, chosen by week number so everyone gets the same ones. */
const QUESTS: QuestDef[] = [
  { id: 'k50', text: 'Kill Arachne 50 times', goal: 50, metric: 'kills' },
  { id: 'k150', text: 'Kill Arachne 150 times', goal: 150, metric: 'kills' },
  { id: 'c20', text: 'Place 20 crystals', goal: 20, metric: 'crystals' },
  { id: 'c60', text: 'Place 60 crystals', goal: 60, metric: 'crystals' },
  { id: 'p5m', text: 'Make 5M profit', goal: 5_000_000, metric: 'profit' },
  { id: 'p25m', text: 'Make 25M profit', goal: 25_000_000, metric: 'profit' },
  { id: 'h3', text: 'Farm for 3 hours', goal: 3, metric: 'hours' },
  { id: 'h10', text: 'Farm for 10 hours', goal: 10, metric: 'hours' },
  { id: 'r1', text: 'Get a rare drop', goal: 1, metric: 'rare' },
  { id: 'r3', text: 'Get 3 rare drops', goal: 3, metric: 'rare' },
  { id: 'd3', text: 'Farm on 3 different days', goal: 3, metric: 'days' },
  { id: 'd5', text: 'Farm on 5 different days', goal: 5, metric: 'days' },
];

const RARE = ['DARK_QUEENS_SOUL_DROP', 'ARACHNE_FANG', 'TARANTULA_EPIC', 'TARANTULA_LEGENDARY'];

/**
 * Badges, streaks, weekly quests and the collection book. All worked out from the index
 * when asked; nothing is stored, so they appear for old history too.
 */
export class Progress {
  constructor(
    private readonly db: Db,
    private readonly stats: Stats,
    private readonly insights: Insights,
  ) {}

  private killDays(ids: readonly string[]): number[] {
    if (ids.length === 0) return [];
    return this.db
      .all<{ d: number }>(`SELECT DISTINCT (death_ts / ${DAY}) AS d FROM fights WHERE account IN (${ph(ids.length)}) AND ${KILL} ORDER BY d`, ...ids)
      .map((r) => r.d);
  }

  /** Days in a row with at least one kill, ending today or yesterday (UTC), and the best ever. */
  streak(ids: readonly string[], now: number) {
    const days = this.killDays(ids);
    let best = 0;
    let run = 0;
    for (let i = 0; i < days.length; i++) {
      run = i > 0 && days[i]! - days[i - 1]! === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    const today = Math.floor(now / DAY);
    const last = days.at(-1);
    const current = last !== undefined && today - last <= 1 ? run : 0;
    return { current, best, farmedToday: last === today };
  }

  private rareCount(ids: readonly string[], from: number): number {
    if (ids.length === 0) return 0;
    return (
      this.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM events WHERE kind = 'LOOT' AND item IN (${ph(RARE.length)}) AND account IN (${ph(ids.length)}) AND ts >= ?`,
        ...RARE,
        ...ids,
        from,
      )?.n ?? 0
    );
  }

  /** This week's three quests with progress. */
  quests(ids: readonly string[], now: number) {
    const from = weekStart(now);
    const n = weekNumber(now);
    const picks = [QUESTS[(n * 3) % QUESTS.length]!, QUESTS[(n * 3 + 5) % QUESTS.length]!, QUESTS[(n * 3 + 9) % QUESTS.length]!];
    const t = this.stats.totals(ids, from, Number.MAX_SAFE_INTEGER);
    const days = this.killDays(ids).filter((d) => d * DAY >= from).length;
    const value = (q: QuestDef) =>
      q.metric === 'kills'
        ? t.kills
        : q.metric === 'crystals'
          ? t.crystals
          : q.metric === 'profit'
            ? Math.max(0, t.profit)
            : q.metric === 'hours'
              ? t.uptimeMs / 3_600_000
              : q.metric === 'rare'
                ? this.rareCount(ids, from)
                : days;
    return {
      weekStart: from,
      endsAt: from + WEEK,
      quests: picks.map((q) => ({ id: q.id, text: q.text, goal: q.goal, progress: Math.min(q.goal, value(q)), done: value(q) >= q.goal })),
    };
  }

  /** Every catalog item: how many you have had, and when the first one dropped. */
  collection(ids: readonly string[]) {
    const got = new Map<string, { count: number; first: number }>();
    if (ids.length > 0) {
      for (const r of this.db.all<{ item: string; c: number; first: number }>(
        `SELECT item, SUM(count) AS c, MIN(ts) AS first FROM events WHERE kind = 'LOOT' AND account IN (${ph(ids.length)}) GROUP BY item`,
        ...ids,
      )) {
        got.set(r.item, { count: r.c, first: r.first });
      }
    }
    return Object.keys(ITEMS).map((item) => ({
      item,
      name: itemName(item),
      rarity: rarity(item),
      count: got.get(item)?.count ?? 0,
      first: got.get(item)?.first ?? null,
    }));
  }

  /** Badges: earned or not, with what is needed. */
  badges(ids: readonly string[], now: number) {
    const all = this.stats.totals(ids, 0, Number.MAX_SAFE_INTEGER);
    const collection = this.collection(ids);
    const dry = this.insights.dryStreaks(ids);
    const streak = this.streak(ids, now);
    const night =
      ids.length > 0 &&
      !!this.db.get(
        `SELECT 1 FROM fights WHERE account IN (${ph(ids.length)}) AND ${KILL} AND (death_ts % ${DAY}) < ${5 * 3_600_000} AND (death_ts % ${DAY}) >= ${2 * 3_600_000} LIMIT 1`,
        ...ids,
      );
    const has = (item: string) => (collection.find((c) => c.item === item)?.count ?? 0) > 0;
    const list: [string, string, string, boolean][] = [
      ['first-kill', 'First blood', 'Kill Arachne once.', all.kills >= 1],
      ['k100', 'Exterminator', 'Kill Arachne 100 times.', all.kills >= 100],
      ['k1000', 'Pest control', 'Kill Arachne 1,000 times.', all.kills >= 1000],
      ['k5000', 'Arachnophobe', 'Kill Arachne 5,000 times.', all.kills >= 5000],
      ['p10m', 'Silk road', 'Make 10M profit.', all.profit >= 10_000_000],
      ['p100m', 'Spider tycoon', 'Make 100M profit.', all.profit >= 100_000_000],
      ['p1b', 'Billionaire weaver', 'Make 1B profit.', all.profit >= 1_000_000_000],
      ['soul', "Queen's soul", "Get a Dark Queen's Soul.", has('DARK_QUEENS_SOUL_DROP')],
      ['fang', 'Fanged', "Get an Arachne's Fang.", has('ARACHNE_FANG')],
      ['pet', 'Eight-legged friend', 'Get a Tarantula pet.', has('TARANTULA_EPIC') || has('TARANTULA_LEGENDARY')],
      ['legendary', 'Legendary', 'Get a Legendary Tarantula pet.', has('TARANTULA_LEGENDARY')],
      ['armour', 'Fully dressed', "Get all four pieces of Arachne's armour.", ['ARACHNE_HELMET', 'ARACHNE_CHESTPLATE', 'ARACHNE_LEGGINGS', 'ARACHNE_BOOTS'].every(has)],
      ['survivor', 'Dry streak survivor', 'Go 200 kills without a rare drop, and keep going.', dry.some((d) => d.longest >= 200)],
      ['streak7', 'Week of webs', 'Farm 7 days in a row.', streak.best >= 7],
      ['streak30', 'Habitual', 'Farm 30 days in a row.', streak.best >= 30],
      ['night', 'Night owl', 'Kill Arachne between 02:00 and 05:00 UTC.', night],
      ['crystals100', 'Crystal clear', 'Place 100 crystals.', all.crystals >= 100],
      ['collector', 'Collector', 'Get every drop in the collection book once.', collection.every((c) => c.count > 0)],
    ];
    return list.map(([id, name, how, earned]) => ({ id, name, how, earned }));
  }

  /** The most valuable single drop in the last 7 days, across everyone. */
  dropOfTheWeek(now: number) {
    let best: { account: string; item: string; count: number; value: number; ts: number; id: string } | null = null;
    for (const a of this.stats.accounts()) {
      const col = priceColumn(a);
      const r = this.db.get<{ id: string; item: string; count: number; v: number; ts: number }>(
        `SELECT id, item, count, count * ${col} AS v, ts FROM events WHERE account = ? AND kind = 'LOOT' AND ts >= ? ORDER BY v DESC LIMIT 1`,
        a.uuid,
        now - WEEK,
      );
      if (r && r.v > 0 && (!best || r.v > best.value)) best = { account: a.name, item: r.item, count: r.count, value: r.v, ts: r.ts, id: r.id };
    }
    return best && { ...best, name: itemName(best.item) };
  }
}
