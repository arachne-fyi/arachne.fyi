import { PRICE_WATCHLIST } from '@arachne/shared';
import type { PriceLine, Prices } from './prices.ts';

/**
 * Bazaar price history from SkyCofl (sky.coflnet.com), to fill in what our own poller missed:
 * the months before the server first ran, and any stretch the PC was off or the Hypixel API
 * was down. Our own snapshots always win; SkyCofl points are only added inside gaps.
 *
 * SkyCofl's API needs no key but is rate limited per IP (30 requests / 10 s, 100 / min), so
 * requests go one at a time with a pause between them. Pages that use the data should credit
 * SkyCofl, and a commercial product is asked to support them with a premium+ subscription.
 * See https://sky.coflnet.com/wiki/api.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 86_400_000;
/** Up to this many days back, SkyCofl serves 2-hourly points; older history is daily. */
const RECENT_DAYS = 90;
/** No own snapshot for this long counts as a gap (same rule as the Admin page's price gaps). */
export const GAP_MS = 30 * MIN;

export interface CoflPoint {
  ts: number;
  /** SkyCofl `sell`: what selling instantly gets you, our `instant`. */
  instant: number | null;
  /** SkyCofl `buy`: what instant buyers pay, i.e. where sell offers sit, our `offer`. */
  offer: number | null;
}

const positive = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** SkyCofl timestamps come without a zone ("2026-11-26T12:00:00") and are UTC. */
function utc(v: unknown): number | null {
  if (typeof v !== 'string' || v.length < 10) return null;
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** One SkyCofl history response, oldest first. Entries without a time or any price are dropped. */
export function parseCoflHistory(body: unknown): CoflPoint[] {
  if (!Array.isArray(body)) throw new Error('SkyCofl history is not a list');
  const out: CoflPoint[] = [];
  for (const e of body as Record<string, unknown>[]) {
    const ts = utc(e?.timestamp);
    if (ts == null) continue;
    const instant = positive(e.sell);
    const offer = positive(e.buy);
    if (instant == null && offer == null) continue;
    out.push({ ts, instant, offer });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * How far apart snapshots may be before it counts as a gap, by age. SkyCofl's own history gets
 * coarser with age (5-minute points for the last day, 2-hourly for weeks, daily for years), so
 * asking for finer than that would find "gaps" in every old stretch on every run.
 */
export function gapLimit(age: number): number {
  if (age <= DAY) return GAP_MS;
  if (age <= RECENT_DAYS * DAY) return 3 * HOUR;
  return 2 * DAY;
}

/** The stretches inside [from, to] where `times` (sorted) leave more than gapLimit uncovered. */
export function gapsIn(times: readonly number[], from: number, to: number, now = to, limit: (age: number) => number = () => GAP_MS): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let prev = from;
  for (const t of times) {
    if (t < from) continue;
    if (t > to) break;
    // Judged by the older end: a stretch reaching back into daily history only needs daily points.
    if (t - prev > limit(now - prev)) out.push({ from: prev, to: t });
    prev = t;
  }
  if (to - prev > limit(now - prev)) out.push({ from: prev, to });
  return out;
}

export interface BackfillOptions {
  /** How far back to fill, in days. */
  days: number;
  /** SkyCofl's address, e.g. https://sky.coflnet.com */
  baseUrl: string;
  /** Items to fill. Defaults to every Bazaar item the server tracks. */
  items?: readonly string[];
  /** Pause between requests, to stay well inside SkyCofl's rate limit. */
  pauseMs?: number;
  log?: (msg: string) => void;
  now?: number;
  fetch?: typeof fetch;
  /** Stop early, e.g. when the server shuts down. */
  signal?: AbortSignal;
}

export interface BackfillReport {
  requests: number;
  added: Record<string, number>;
  failed: string[];
}

/**
 * The requests that cover [start, end], newest last. SkyCofl's range request answers with
 * 2-hourly points for a week and daily points for a year, and its "day" window with 5-minute
 * points, so: years in yearly requests, the last few months in weekly ones, the last day at once.
 */
function plan(start: number, end: number, now: number): { from: number; to: number; path: (tag: string) => string }[] {
  const out: { from: number; to: number; path: (tag: string) => string }[] = [];
  const range = (a: number, b: number, size: number) => {
    for (let from = a; from < b; from += size) {
      const to = Math.min(b, from + size);
      out.push({ from, to, path: (tag) => `/api/bazaar/${tag}/history?start=${iso(from)}&end=${iso(to)}` });
    }
  };
  const recent = now - RECENT_DAYS * DAY;
  const lastDay = now - DAY;
  if (start < recent) range(start, Math.min(end, recent), 365 * DAY);
  if (end > recent && start < lastDay) range(Math.max(start, recent), Math.min(end, lastDay), 7 * DAY);
  if (end > lastDay) out.push({ from: Math.max(start, lastDay), to: end, path: (tag) => `/api/bazaar/${tag}/history/day` });
  return out;
}

/**
 * Fill the price history for every tracked item from SkyCofl. Only time ranges that actually
 * have a gap in our own snapshots are requested, so a second run is cheap.
 */
export async function backfillFromCofl(prices: Prices, opts: BackfillOptions): Promise<BackfillReport> {
  const now = opts.now ?? Date.now();
  const items = opts.items ?? PRICE_WATCHLIST;
  const pause = opts.pauseMs ?? 1_200;
  const get = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  // Leave the last half hour alone: our own poller is about to cover it.
  const end = now - GAP_MS;
  const start = now - opts.days * DAY;
  const report: BackfillReport = { requests: 0, added: {}, failed: [] };

  const request = async (path: string, tries = 0): Promise<CoflPoint[] | 'missing'> => {
    if (report.requests > 0) await sleep(pause, opts.signal);
    report.requests++;
    const res = await get(`${base}${path}`, {
      headers: { accept: 'application/json', 'user-agent': 'ArachneFyi-Server/2 (+https://arachne.fyi)' },
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (res.status === 404) return 'missing';
    if (res.status === 429 && tries < 3) {
      const wait = Number(res.headers.get('retry-after')) * 1000;
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 120_000) : 30_000, opts.signal);
      return request(path, tries + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCoflHistory(await res.json());
  };

  for (const item of items) {
    if (opts.signal?.aborted) break;
    const tag = encodeURIComponent(item);
    try {
      const gaps = gapsIn(prices.times(item, start, end), start, end, now, gapLimit);
      if (gaps.length === 0) continue;
      const points: CoflPoint[] = [];
      let missing = false;
      for (const step of plan(start, end, now)) {
        if (!gaps.some((g) => g.from < step.to && g.to > step.from)) continue;
        const got = await request(step.path(tag));
        if (got === 'missing') {
          missing = true; // not a Bazaar item on SkyCofl
          break;
        }
        points.push(...got.filter((p) => p.ts >= step.from && p.ts <= step.to));
      }
      if (missing) continue;
      const added = prices.recordBackfill(item, inGaps(points, gaps));
      if (added > 0) report.added[item] = added;
    } catch (err) {
      if (opts.signal?.aborted) break;
      report.failed.push(item);
      opts.log?.(`SkyCofl backfill of ${item} failed: ${(err as Error).message}`);
    }
  }
  return report;
}

/** Points that fall inside a gap, at least a quarter gap away from our own snapshots on either side. */
function inGaps(points: readonly CoflPoint[], gaps: readonly { from: number; to: number }[]): CoflPoint[] {
  const margin = GAP_MS / 4;
  const seen = new Set<number>();
  return points.filter((p) => {
    if (seen.has(p.ts)) return false;
    seen.add(p.ts);
    return gaps.some((g) => p.ts > g.from + margin && p.ts < g.to - margin);
  });
}

/** Back-filled points as price log lines, one per item and time. `src` marks where they came from. */
export const backfillLine = (item: string, p: CoflPoint): PriceLine & { src: 'skycofl' } => ({
  ts: p.ts,
  prices: { [item]: [p.instant, p.offer] },
  src: 'skycofl',
});

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
}

/**
 * Run the backfill once soon after start (the whole `days` window) and then every few hours
 * over just the last few days, so a stretch with the PC off is filled in once SkyCofl has it
 * without asking for months of history again. Returns a stop function.
 */
export function startCoflBackfill(
  prices: Prices,
  opts: Omit<BackfillOptions, 'signal' | 'now'> & { everyMs: number; onUpdate?: () => void },
): () => void {
  const stop = new AbortController();
  let running = false;
  let firstRun = true;
  const run = async () => {
    if (running || stop.signal.aborted) return;
    running = true;
    const days = firstRun ? opts.days : Math.min(opts.days, 3);
    firstRun = false;
    try {
      const r = await backfillFromCofl(prices, { ...opts, days, signal: stop.signal });
      const total = Object.values(r.added).reduce((n, v) => n + v, 0);
      if (total > 0) {
        opts.log?.(`SkyCofl backfill added ${total} price point(s): ${Object.entries(r.added).map(([k, v]) => `${k} ${v}`).join(', ')}`);
        opts.onUpdate?.();
      }
    } catch (err) {
      opts.log?.(`SkyCofl backfill failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, opts.everyMs);
  first.unref();
  timer.unref();
  return () => {
    stop.abort();
    clearTimeout(first);
    clearInterval(timer);
  };
}
