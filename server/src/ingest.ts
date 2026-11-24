import {
  BatchRequest,
  DEFAULT_POLL_MS,
  Event,
  MAX_FUTURE_MS,
  isAlphaOrigin,
  type BatchReply,
} from '@arachne/shared';
import type { User } from './auth.ts';
import type { Db } from './db.ts';
import type { EventLine, Indexer } from './indexer.ts';
import type { Stats } from './stats.ts';
import type { DayLog } from './store/log.ts';

export class IngestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Clock differences smaller than this are network latency, not a wrong clock. */
const SKEW_IGNORE_MS = 5_000;

export interface IngestResult {
  reply: BatchReply;
  account: string;
  accepted: number;
  kinds: string[];
}

/**
 * The write path. For one batch:
 *
 *   1. check the account belongs to the token's user
 *   2. validate each event on its own (one bad event never blocks the rest)
 *   3. drop events whose id is already indexed (this is what makes retries safe)
 *   4. append the survivors to today's NDJSON file and fsync
 *   5. index them in SQLite
 *   6. reply with fresh totals for the HUD
 *
 * Step 4 comes before step 5, so a crash in between leaves the event on disk and
 * missing from the index. The client retries, the id is not in the index, and the event
 * is appended a second time. That is fine: the rebuild dedupes on id, first line wins.
 */
export class Ingest {
  constructor(
    private readonly db: Db,
    private readonly log: DayLog,
    private readonly indexer: Indexer,
    private readonly stats: Stats,
  ) {}

  handle(user: User, body: unknown, now: number): IngestResult {
    const parsed = BatchRequest.safeParse(body);
    if (!parsed.success) {
      throw new IngestError(400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid batch');
    }
    const batch = parsed.data;
    const account = batch.account.uuid;

    const existing = this.db.get<{ user_id: number | null }>(
      'SELECT user_id FROM state.accounts WHERE uuid = ?',
      account,
    );
    if (existing && existing.user_id != null && existing.user_id !== user.id) {
      throw new IngestError(403, 'account_owned_by_other_user', 'This Minecraft account is paired to someone else.');
    }

    const rawSkew = now - batch.sentAt;
    const skew = Math.abs(rawSkew) > SKEW_IGNORE_MS ? rawSkew : 0;

    const rejected: BatchReply['rejected'] = [];
    const lines: EventLine[] = [];
    const seen = new Set<string>();
    let duplicates = 0;
    let ignored = 0;
    for (const raw of batch.events) {
      const result = Event.safeParse(raw);
      if (!result.success) {
        const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : null;
        const issue = result.error.issues[0];
        rejected.push({ id, reason: `${issue?.path.join('.') || 'event'}: ${issue?.message ?? 'invalid'}` });
        continue;
      }
      const event = result.data;
      // Alpha network: not real progress. Dropped before the log and the index, so it is never
      // stored, counted, or shown; reported as settled so the mod stops resending it.
      if (isAlphaOrigin(event.origin)) {
        ignored++;
        continue;
      }
      if (event.ts + skew > now + MAX_FUTURE_MS) {
        rejected.push({ id: event.id, reason: 'ts: too far in the future' });
        continue;
      }
      if (seen.has(event.id) || this.db.get('SELECT 1 FROM events WHERE id = ?', event.id)) {
        duplicates++;
        continue;
      }
      seen.add(event.id);
      lines.push({ r: now, u: user.id, a: account, n: batch.account.name, k: skew, e: event });
    }

    this.log.append(lines, now);

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO state.accounts (uuid, user_id, name, first_seen, last_seen, mod_version, state_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uuid) DO UPDATE SET
           user_id = excluded.user_id, name = excluded.name, last_seen = excluded.last_seen,
           mod_version = excluded.mod_version, state_json = excluded.state_json`,
        account,
        user.id,
        batch.account.name,
        now,
        now,
        batch.mod.version,
        batch.state ? JSON.stringify(batch.state) : null,
      );
      this.indexer.index(account, lines, now);
    });
    if (lines.length > 0) this.stats.invalidate();

    // "group" is the user's group (up to 5 people), not everyone on the server.
    const group = this.stats.hudGroup(user.id);
    const groupIds = group.userIds.flatMap((id) => this.stats.accountIds(id));
    const userIds = this.stats.accountIds(user.id);
    return {
      account,
      accepted: lines.length,
      kinds: [...new Set(lines.map((l) => l.e.kind))],
      reply: {
        accepted: lines.length,
        duplicates,
        rejected,
        ignored,
        serverTime: now,
        nextPollMs: DEFAULT_POLL_MS,
        totals: {
          group: this.stats.windows(groupIds, now),
          user: this.stats.windows(userIds, now),
          account: this.stats.windows([account], now),
        },
        focus: {
          group: this.stats.focus(groupIds, now),
          user: this.stats.focus(userIds, now),
          account: this.stats.focus([account], now),
        },
        groupTag: group.tag,
        online: this.stats.onlineAmong(groupIds, now),
      },
    };
  }
}
