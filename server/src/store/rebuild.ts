import { Event } from '@arachne/shared';
import type { Context } from '../context.ts';
import type { EventLine } from '../indexer.ts';
import type { PriceLine } from '../prices.ts';

export interface RebuildReport {
  priceSnapshots: number;
  lines: number;
  indexed: number;
  duplicates: number;
  invalid: number;
  accounts: number;
}

/**
 * Throw the index away and rebuild it from the NDJSON files.
 *
 * Run it after changing a rule in shared/rules.ts, after restoring a backup, or if
 * index.db is lost or damaged. state.db (users, tokens, account settings) is not touched;
 * accounts that appear in the files but are missing from state.db are re-registered.
 */
export async function rebuildIndex(ctx: Context, now = Date.now()): Promise<RebuildReport> {
  const report: RebuildReport = { priceSnapshots: 0, lines: 0, indexed: 0, duplicates: 0, invalid: 0, accounts: 0 };
  ctx.db.clearIndex();

  // Prices first: events are valued against them as they are indexed.
  for await (const raw of ctx.priceLog.read()) {
    const line = raw as PriceLine;
    if (typeof line?.ts !== 'number' || typeof line.prices !== 'object') continue;
    ctx.prices.record(line, false);
    report.priceSnapshots++;
  }

  const accounts = new Map<string, { name: string; user: number; first: number; last: number }>();
  let pending: { account: string; lines: EventLine[] } | null = null;
  const flush = () => {
    if (!pending) return;
    const { account, lines } = pending;
    const added = ctx.db.tx(() => ctx.indexer.index(account, lines, now));
    report.indexed += added;
    report.duplicates += lines.length - added;
    pending = null;
  };

  for await (const raw of ctx.events.read(() => report.invalid++)) {
    report.lines++;
    const line = raw as EventLine;
    const event = Event.safeParse(line?.e);
    if (!event.success || typeof line.a !== 'string' || typeof line.r !== 'number') {
      report.invalid++;
      continue;
    }
    const clean: EventLine = { r: line.r, u: line.u, a: line.a, n: line.n, k: line.k ?? 0, e: event.data };
    const seen = accounts.get(clean.a);
    if (seen) {
      seen.name = clean.n;
      seen.last = clean.r;
    } else {
      accounts.set(clean.a, { name: clean.n, user: clean.u, first: clean.r, last: clean.r });
    }
    // Index in runs of the same account so each run is one transaction.
    if (pending && (pending.account !== clean.a || pending.lines.length >= 1000)) flush();
    pending ??= { account: clean.a, lines: [] };
    pending.lines.push(clean);
  }
  flush();

  for (const [uuid, a] of accounts) {
    const owner = ctx.auth.userById(a.user) ? a.user : null;
    ctx.db.run(
      `INSERT INTO state.accounts (uuid, user_id, name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO NOTHING`,
      uuid,
      owner,
      a.name,
      a.first,
      a.last,
    );
  }
  report.accounts = accounts.size;
  ctx.stats.dataReplaced();
  return report;
}
