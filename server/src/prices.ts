import { CRYSTAL_RECIPE, NPC_PRICES, PRICE_WATCHLIST, SALVAGE, type ItemId } from '@arachne/shared';
import type { Db } from './db.ts';
import type { DayLog } from './store/log.ts';
import { backfillLine, type CoflPoint } from './cofl.ts';

export interface PriceLine {
  ts: number;
  /** item → [instantSell, sellOffer]; null where the Bazaar had no usable quote. */
  prices: Record<string, [number | null, number | null]>;
}

/** The three ways an event can be valued. Stored per event so an account can switch mode later. */
export interface UnitPrices {
  instant: number;
  offer: number;
  npc: number;
}

/**
 * Price history. Snapshots live in `data/prices/*.ndjson` (source of truth) and are
 * mirrored into the `prices` table so "the price at time T" is one indexed lookup.
 */
export class Prices {
  private latestTs = 0;

  constructor(
    private readonly db: Db,
    private readonly log: DayLog | null,
  ) {
    this.latestTs = db.get<{ ts: number | null }>('SELECT MAX(ts) AS ts FROM prices')?.ts ?? 0;
  }

  get updatedAt(): number {
    return this.latestTs;
  }

  /** Record a snapshot. `persist: false` is for rebuilds, where the line is already on disk. */
  record(line: PriceLine, persist = true): void {
    if (persist) this.log?.append([line], line.ts);
    this.db.tx(() => {
      for (const [item, [instant, offer]] of Object.entries(line.prices)) {
        this.db.run(
          'INSERT OR REPLACE INTO prices (item, ts, instant, offer) VALUES (?, ?, ?, ?)',
          item,
          line.ts,
          instant,
          offer,
        );
      }
    });
    this.latestTs = Math.max(this.latestTs, line.ts);
  }

  /** Snapshot times of one item in [from, to], oldest first. Used to find gaps to back-fill. */
  times(item: string, from: number, to: number): number[] {
    return this.db
      .all<{ ts: number }>('SELECT ts FROM prices WHERE item = ? AND ts >= ? AND ts <= ? ORDER BY ts', item, from, to)
      .map((r) => r.ts);
  }

  /**
   * Add back-filled points for one item (from SkyCofl, see cofl.ts). They go to the price log
   * like our own snapshots, so a rebuild keeps them, but don't move `updatedAt`: that stays the
   * time of our own latest poll. Returns how many were added.
   */
  recordBackfill(item: string, points: readonly CoflPoint[]): number {
    if (points.length === 0) return 0;
    this.log?.append(points.map((p) => backfillLine(item, p)), Date.now());
    this.db.tx(() => {
      for (const p of points) {
        this.db.run('INSERT OR IGNORE INTO prices (item, ts, instant, offer) VALUES (?, ?, ?, ?)', item, p.ts, p.instant, p.offer);
      }
    });
    return points.length;
  }

  /** The Bazaar quote in force at `ts`: the last snapshot at or before it, else the first after. */
  private quote(item: string, ts: number): { instant: number | null; offer: number | null } | undefined {
    return (
      this.db.get(
        'SELECT instant, offer FROM prices WHERE item = ? AND ts <= ? ORDER BY ts DESC LIMIT 1',
        item,
        ts,
      ) ??
      this.db.get('SELECT instant, offer FROM prices WHERE item = ? AND ts > ? ORDER BY ts ASC LIMIT 1', item, ts)
    );
  }

  /** Unit sell value of a loot item at `ts`. Items the Bazaar does not list fall back to NPC/George. */
  loot(item: string, ts: number): UnitPrices {
    const npc = NPC_PRICES[item as ItemId] ?? 0;
    const q = this.quote(item, ts);
    return { instant: q?.instant ?? npc, offer: q?.offer ?? npc, npc };
  }

  /**
   * Like loot(), but an item that salvages into essence is worth that essence instead
   * (5 Spider Essence for an Arachne's Armor piece, at the essence's Bazaar price at `ts`).
   */
  lootAsEssence(item: string, ts: number): UnitPrices {
    const s = SALVAGE[item as ItemId];
    if (!s) return this.loot(item, ts);
    const e = this.loot(s.item, ts);
    return { instant: e.instant * s.count, offer: e.offer * s.count, npc: NPC_PRICES[item as ItemId] ?? 0 };
  }

  /** Unit cost of a summon item at `ts`. */
  summon(item: string, ts: number): UnitPrices {
    if (item === 'ARACHNE_CRYSTAL') {
      // Crystals are crafted, so they cost their ingredients (v1.5.0 `Config.recipeCost`).
      const total: UnitPrices = { instant: 0, offer: 0, npc: 0 };
      for (const [ingredient, qty] of Object.entries(CRYSTAL_RECIPE)) {
        const p = this.loot(ingredient, ts);
        total.instant += p.instant * qty;
        total.offer += p.offer * qty;
        total.npc += p.npc * qty;
      }
      return total;
    }
    // Calling fragments: Bazaar price if it is listed there, otherwise unpriced (0) for now.
    const q = this.quote(item, ts);
    return { instant: q?.instant ?? 0, offer: q?.offer ?? 0, npc: 0 };
  }

  /** Latest quote per watched item, for the dashboard's price panel. */
  latest(): { item: string; ts: number; instant: number | null; offer: number | null }[] {
    return this.db.all(
      `SELECT p.item, p.ts, p.instant, p.offer FROM prices p
       JOIN (SELECT item, MAX(ts) AS ts FROM prices GROUP BY item) m ON m.item = p.item AND m.ts = p.ts
       ORDER BY p.item`,
    );
  }
}

const positive = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/**
 * Pick the watched products out of a Bazaar API response.
 *
 * The API names sides by the instant transaction: `sellPrice` is what you get selling
 * instantly (buyer bids), `buyPrice` is what a sell offer would list at (seller asks).
 * Ported from v1.5.0 `BazaarPrices.parse`.
 */
export function parseBazaar(body: unknown, now: number): PriceLine {
  const root = body as { success?: unknown; lastUpdated?: unknown; products?: Record<string, any> };
  if (root?.success !== true || !root.products) throw new Error('Bazaar API reported failure');
  const updated = typeof root.lastUpdated === 'number' ? root.lastUpdated : now;
  if (now - updated > 60 * 60_000) throw new Error('Bazaar snapshot is stale');
  const prices: PriceLine['prices'] = {};
  for (const id of PRICE_WATCHLIST) {
    const quick = root.products[id]?.quick_status;
    if (!quick) continue;
    const instant = positive(quick.sellPrice);
    const offer = positive(quick.buyPrice);
    if (instant != null || offer != null) prices[id] = [instant, offer];
  }
  if (Object.keys(prices).length === 0) throw new Error('No usable Bazaar prices');
  return { ts: Math.min(updated, now), prices };
}

/** Poll the Bazaar on a timer. Failures are logged and retried on the next tick. */
export function startBazaarPoller(
  prices: Prices,
  opts: { url: string; pollMs: number; log: (msg: string) => void; onUpdate?: () => void },
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetch(opts.url, {
        headers: { accept: 'application/json', 'user-agent': 'ArachneFyi-Server/2' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const line = parseBazaar(await res.json(), Date.now());
      if (line.ts > prices.updatedAt) {
        prices.record(line);
        opts.onUpdate?.();
      }
    } catch (err) {
      opts.log(`bazaar poll failed: ${(err as Error).message}`);
    }
  };
  void tick();
  const timer = setInterval(tick, opts.pollMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
