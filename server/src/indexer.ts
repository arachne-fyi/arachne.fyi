import { uptimeSegments, type Event, type FightFacts } from '@arachne/shared';
import type { Db } from './db.ts';
import type { Prices } from './prices.ts';

const HOUR = 3_600_000;

/** One line of an events file: an accepted event plus who sent it and when. */
export interface EventLine {
  /** Server receive time, epoch ms. */
  r: number;
  /** User id that owned the token. */
  u: number;
  /** Account UUID (lowercase, no dashes) and name at the time. */
  a: string;
  n: string;
  /** Clock correction applied to this batch: server time minus the client's `sentAt`. */
  k: number;
  /** The event exactly as the client sent it. */
  e: Event;
}

/** Event time on the server's clock. */
export function correctedTs(line: EventLine): number {
  return line.e.ts + line.k;
}

/**
 * Turns event lines into index rows. Used by live ingest and by the rebuild, so both
 * always produce the same index.
 */
export class Indexer {
  constructor(
    private readonly db: Db,
    private readonly prices: Prices,
  ) {}

  /**
   * Index lines for a single account. Returns how many were new. Call inside a transaction.
   * Lines whose id is already indexed are skipped, which is what makes replays harmless.
   */
  index(account: string, lines: readonly EventLine[], now: number): number {
    let added = 0;
    let earliestFightTs = Infinity;
    for (const line of lines) {
      const e = line.e;
      const ts = correctedTs(line);
      let item: string | null = null;
      let count = 0;
      let amount = 0;
      let unit = { instant: 0, offer: 0, npc: 0 };
      let asEssence = { instant: 0, offer: 0 };
      let source: string | null = null;
      switch (e.kind) {
        case 'LOOT':
          item = e.item;
          count = e.count;
          source = e.source;
          unit = this.prices.loot(e.item, ts);
          asEssence = this.prices.lootAsEssence(e.item, ts);
          break;
        case 'PLACE':
          item = e.item;
          count = e.count;
          unit = this.prices.summon(e.item, ts);
          asEssence = unit;
          break;
        case 'COINS':
          amount = e.amount;
          source = e.source;
          break;
        default:
          break;
      }
      const fight = 'fight' in e ? (e.fight ?? null) : null;
      const res = this.db.run(
        `INSERT OR IGNORE INTO events
           (id, account, ts, kind, fight, item, count, amount, p_instant, p_offer, p_npc, pe_instant, pe_offer, source, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id,
        account,
        ts,
        e.kind,
        fight,
        item,
        count,
        amount,
        unit.instant,
        unit.offer,
        unit.npc,
        asEssence.instant,
        asEssence.offer,
        source,
        line.r,
      );
      if (res.changes === 0) continue;
      added++;
      if (e.kind === 'LOOT' || e.kind === 'PLACE' || e.kind === 'COINS') {
        this.db.run(
          `INSERT INTO hourly (account, hour, kind, item, count, v_instant, v_offer, v_npc, ve_instant, ve_offer, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (account, hour, kind, item) DO UPDATE SET
             count = count + excluded.count, v_instant = v_instant + excluded.v_instant,
             v_offer = v_offer + excluded.v_offer, v_npc = v_npc + excluded.v_npc,
             ve_instant = COALESCE(ve_instant, 0) + excluded.ve_instant, ve_offer = COALESCE(ve_offer, 0) + excluded.ve_offer,
             amount = amount + excluded.amount`,
          account,
          Math.floor(ts / HOUR) * HOUR,
          e.kind,
          item ?? '',
          count,
          count * unit.instant,
          count * unit.offer,
          count * unit.npc,
          count * asEssence.instant,
          count * asEssence.offer,
          amount,
        );
      }
      if (this.applyToFight(account, e, ts)) earliestFightTs = Math.min(earliestFightTs, ts);
    }
    if (earliestFightTs !== Infinity) this.recomputeUptime(account, earliestFightTs, now);
    return added;
  }

  /**
   * Fill the essence columns for rows indexed before they existed. Cheap when there is
   * nothing to do, so it runs at every start.
   */
  backfillEssence(): number {
    const todo = this.db.all<{ id: string; ts: number; kind: string; item: string | null; p_instant: number; p_offer: number }>(
      'SELECT id, ts, kind, item, p_instant, p_offer FROM events WHERE pe_instant IS NULL',
    );
    if (todo.length === 0 && !this.db.get('SELECT 1 FROM hourly WHERE ve_instant IS NULL LIMIT 1')) return 0;
    this.db.tx(() => {
      for (const r of todo) {
        const p = r.kind === 'LOOT' && r.item ? this.prices.lootAsEssence(r.item, r.ts) : { instant: r.p_instant, offer: r.p_offer };
        this.db.run('UPDATE events SET pe_instant = ?, pe_offer = ? WHERE id = ?', p.instant, p.offer, r.id);
      }
      // Rebuild the hourly essence sums from the events they cover.
      this.db.run(
        `UPDATE hourly SET
           ve_instant = (SELECT COALESCE(SUM(count * pe_instant), 0) FROM events e
                         WHERE e.account = hourly.account AND e.kind = hourly.kind AND COALESCE(e.item, '') = hourly.item
                           AND e.ts >= hourly.hour AND e.ts < hourly.hour + 3600000),
           ve_offer   = (SELECT COALESCE(SUM(count * pe_offer), 0) FROM events e
                         WHERE e.account = hourly.account AND e.kind = hourly.kind AND COALESCE(e.item, '') = hourly.item
                           AND e.ts >= hourly.hour AND e.ts < hourly.hour + 3600000)
         WHERE ve_instant IS NULL`,
      );
    });
    return todo.length;
  }

  /** Fold a fight-lifecycle event into the `fights` row. Returns true if the row changed. */
  private applyToFight(account: string, e: Event, ts: number): boolean {
    if (e.kind !== 'SPAWN' && e.kind !== 'DEATH' && e.kind !== 'DAMAGE' && e.kind !== 'INTERRUPT') {
      return false;
    }
    this.db.run(
      'INSERT OR IGNORE INTO fights (account, fight, anchor_ts) VALUES (?, ?, ?)',
      account,
      e.fight,
      ts,
    );
    switch (e.kind) {
      case 'SPAWN':
        // A confirmed spawn line beats a recovered one; otherwise keep the earliest time seen.
        this.db.run(
          `UPDATE fights SET
             spawn_ts = CASE WHEN spawn_ts IS NULL OR (? = 1 AND confirmed = 0) OR ? < spawn_ts THEN ? ELSE spawn_ts END,
             confirmed = MAX(confirmed, ?),
             tier = CASE WHEN ? != 'UNKNOWN' THEN ? ELSE tier END
           WHERE account = ? AND fight = ?`,
          e.confirmed ? 1 : 0,
          ts,
          ts,
          e.confirmed ? 1 : 0,
          e.tier,
          e.tier,
          account,
          e.fight,
        );
        break;
      case 'DEATH':
        this.db.run(
          'UPDATE fights SET death_ts = COALESCE(death_ts, ?) WHERE account = ? AND fight = ?',
          ts,
          account,
          e.fight,
        );
        break;
      case 'DAMAGE':
        this.db.run(
          'UPDATE fights SET damage = COALESCE(damage, ?), damage_ts = COALESCE(damage_ts, ?) WHERE account = ? AND fight = ?',
          e.damage,
          ts,
          account,
          e.fight,
        );
        break;
      case 'INTERRUPT':
        this.db.run(
          'UPDATE fights SET interrupt_ts = COALESCE(interrupt_ts, ?) WHERE account = ? AND fight = ?',
          ts,
          account,
          e.fight,
        );
        break;
    }
    this.db.run(
      'UPDATE fights SET anchor_ts = COALESCE(spawn_ts, death_ts, interrupt_ts, anchor_ts) WHERE account = ? AND fight = ?',
      account,
      e.fight,
    );
    return true;
  }

  /**
   * Recompute uptime segments for an account from `fromTs` onward.
   *
   * Segments further apart than the grace period cannot affect each other, so it is
   * enough to restart from the beginning of the segment that contains (or precedes)
   * the earliest changed fight.
   */
  recomputeUptime(account: string, fromTs: number, now: number): void {
    const boundary =
      this.db.get<{ start: number }>(
        'SELECT start FROM uptime WHERE account = ? AND start <= ? ORDER BY start DESC LIMIT 1',
        account,
        fromTs,
      )?.start ?? 0;
    const fights = this.db.all<FightRow>(
      `SELECT spawn_ts, death_ts, damage, damage_ts, interrupt_ts FROM fights
       WHERE account = ? AND anchor_ts >= ? ORDER BY anchor_ts`,
      account,
      boundary,
    );
    this.db.run('DELETE FROM uptime WHERE account = ? AND start >= ?', account, boundary);
    for (const seg of uptimeSegments(fights.map(toFacts), now)) {
      this.db.run(
        'INSERT OR REPLACE INTO uptime (account, start, end) VALUES (?, ?, ?)',
        account,
        seg.start,
        seg.end,
      );
    }
  }

  /**
   * Segments that end "now" (a fight still open, or inside the 30s grace) go stale as
   * time passes. Call this on a timer for accounts with recent activity.
   */
  refreshLiveUptime(now: number): void {
    const recent = this.db.all<{ account: string; ts: number }>(
      'SELECT account, MIN(anchor_ts) AS ts FROM fights WHERE anchor_ts >= ? GROUP BY account',
      now - 15 * 60_000,
    );
    if (recent.length === 0) return;
    this.db.tx(() => {
      for (const r of recent) this.recomputeUptime(r.account, r.ts, now);
    });
  }
}

interface FightRow {
  spawn_ts: number | null;
  death_ts: number | null;
  damage: number | null;
  damage_ts: number | null;
  interrupt_ts: number | null;
}

export function toFacts(r: FightRow): FightFacts {
  return {
    spawnTs: r.spawn_ts,
    deathTs: r.death_ts,
    damage: r.damage,
    damageTs: r.damage_ts,
    interruptTs: r.interrupt_ts,
  };
}
