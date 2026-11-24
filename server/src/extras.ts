import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ITEMS, KILL_DAMAGE_THRESHOLD, KILL_DAMAGE_WINDOW_MS, SUMMON_ITEMS, fightOutcome, itemName } from '@arachne/shared';
import type { User } from './auth.ts';
import type { Context } from './context.ts';
import { toFacts } from './indexer.ts';
import { RARE_DROPS } from './insights.ts';
import { priceColumn } from './stats.ts';
import { ingestHealth } from './fun.ts';
import { DatabaseSync } from 'node:sqlite';

type RequireUser = (req: FastifyRequest, reply: FastifyReply, admin?: boolean) => User | null;

// ---- small state helpers -------------------------------------------------------------

export function audit(ctx: Context, userId: number | null, action: string, detail = ''): void {
  ctx.db.run('INSERT INTO state.audit (ts, user_id, action, detail) VALUES (?, ?, ?, ?)', Date.now(), userId, action, detail);
}

export function getSetting<T>(ctx: Context, key: string): T | null {
  const row = ctx.db.get<{ value: string }>('SELECT value FROM state.settings WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : null;
}

export function putSetting(ctx: Context, key: string, value: unknown): void {
  if (value === null) ctx.db.run('DELETE FROM state.settings WHERE key = ?', key);
  else ctx.db.run('INSERT OR REPLACE INTO state.settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));
}

/** People an admin has taken off the leaderboard and challenges (they still see their own numbers). */
export function hiddenUsers(ctx: Context): Set<number> {
  const set = new Set(getSetting<number[]>(ctx, 'hiddenUsers') ?? []);
  // People who chose not to be shown to others are left off the boards too.
  for (const r of ctx.db.all<{ user_id: number }>('SELECT user_id FROM state.privacy WHERE visible = 0')) set.add(r.user_id);
  return set;
}

/** Somebody logged in with Discord but is not on the allowlist: remember them for the admin. */
export function recordAccessRequest(ctx: Context, profile: { id: string; name: string; avatar: string | null }, now: number) {
  ctx.db.run(
    `INSERT INTO state.access_requests (discord_id, name, avatar, created_at, last_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, last_at = excluded.last_at`,
    profile.id,
    profile.name,
    profile.avatar,
    now,
    now,
  );
}

// ---- files ---------------------------------------------------------------------------

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    total += s.isDirectory() ? dirSize(p) : s.size;
  }
  return total;
}

const fileSize = (p: string) => (existsSync(p) ? statSync(p).size : 0);

const checksums = new Map<string, { mtime: number; sha256: string }>();
/** SHA-256 of a download, cached until the file changes. */
export function sha256Of(path: string): string {
  const mtime = statSync(path).mtimeMs;
  const hit = checksums.get(path);
  if (hit && hit.mtime === mtime) return hit.sha256;
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  checksums.set(path, { mtime, sha256 });
  return sha256;
}

/**
 * Copy state.db (users, tokens, settings) once a day, keeping the last 14 copies.
 * index.db is not copied: it is rebuilt from the NDJSON files.
 */
export function backupState(ctx: Context, now: number): string | null {
  const dir = ctx.config.backupDir;
  mkdirSync(dir, { recursive: true });
  const name = `state-${new Date(now).toISOString().slice(0, 10)}.db`;
  const target = join(dir, name);
  if (existsSync(target)) return null;
  ctx.db.raw.exec(`VACUUM state INTO '${target.replace(/'/g, "''")}'`);
  const old = readdirSync(dir)
    .filter((f) => /^state-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(14);
  for (const f of old) rmSync(join(dir, f));
  return target;
}

export function lastBackup(ctx: Context): { file: string; at: number; size: number } | null {
  const dir = ctx.config.backupDir;
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^state-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  const f = files.at(-1);
  if (!f) return null;
  const s = statSync(join(dir, f));
  return { file: f, at: Math.floor(s.mtimeMs), size: s.size };
}

// ---- Discord rare-drop posts ---------------------------------------------------------

/**
 * After a batch is stored, post its big drops to the Discord webhook (if one is set).
 * Looks at the events received in that batch, so a resent batch never posts twice.
 */
export function postRareDrops(ctx: Context, account: string, receivedAt: number): void {
  const url = ctx.config.discordWebhookUrl;
  if (!url) return;
  const a = ctx.stats.accounts().find((x) => x.uuid === account);
  if (!a) return;
  const col = priceColumn(a);
  const rows = ctx.db.all<{ item: string; count: number; v: number }>(
    `SELECT item, count, count * ${col} AS v FROM events WHERE account = ? AND received_at = ? AND kind = 'LOOT'`,
    account,
    receivedAt,
  );
  const rare = new Set<string>(RARE_DROPS);
  const lines = rows
    .filter((r) => rare.has(r.item) || r.v >= ctx.config.rareDropMinCoins)
    .map((r) => `**${a.name}** dropped ${r.count}x ${itemName(r.item)} (${shortCoins(r.v)})`);
  if (lines.length === 0) return;
  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Arachne.fyi', content: lines.join('\n').slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    /* Discord down or the webhook was deleted: drops are still stored, just not posted */
  });
}

function shortCoins(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

// ---- CSV -----------------------------------------------------------------------------

function csv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const iso = (ts: number | null) => (ts == null ? null : new Date(ts).toISOString());

// ---- routes --------------------------------------------------------------------------

export function registerExtras(app: FastifyInstance, ctx: Context, requireUser: RequireUser, downloads: string): void {
  const { db, stats, auth, insights } = ctx;

  // Announcement banner: everyone logged in sees it; admins edit it.
  app.get('/api/announcement', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return { announcement: getSetting<{ text: string; at: number; by: string }>(ctx, 'announcement') };
  });
  app.put('/api/admin/announcement', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const body = z.object({ text: z.string().trim().max(300) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    putSetting(ctx, 'announcement', body.data.text ? { text: body.data.text, at: Date.now(), by: me.name } : null);
    audit(ctx, me.id, body.data.text ? 'announcement.set' : 'announcement.clear', body.data.text);
    ctx.hub.publish('settings', { announcement: true });
    return { ok: true };
  });

  // Records and insights for the logged-in person or everyone.
  app.get('/api/records', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const scope = (req.query as { scope?: string }).scope;
    return insights.records(scope === 'me' ? stats.accountIds(user.id) : stats.accountIds());
  });

  // People waiting to be let in.
  app.get('/api/admin/requests', async (req, reply) => {
    if (!requireUser(req, reply, true)) return;
    const allowed = new Set(auth.listUsers().map((u) => u.discord_id));
    return {
      requests: db
        .all<{ discord_id: string; name: string; avatar: string | null; created_at: number; last_at: number }>(
          'SELECT * FROM state.access_requests WHERE dismissed = 0 ORDER BY last_at DESC',
        )
        .filter((r) => !allowed.has(r.discord_id))
        .map((r) => ({
          discordId: r.discord_id,
          name: r.name,
          avatar:
            r.avatar && /^\d+$/.test(r.discord_id) ? `https://cdn.discordapp.com/avatars/${r.discord_id}/${r.avatar}.png?size=64` : null,
          firstAt: r.created_at,
          lastAt: r.last_at,
        })),
    };
  });
  app.post('/api/admin/requests/:id/:action', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const { id, action } = req.params as { id: string; action: string };
    const row = db.get<{ name: string }>('SELECT name FROM state.access_requests WHERE discord_id = ?', id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (action === 'approve') {
      auth.allow(id, 'user', Date.now(), row.name);
      audit(ctx, me.id, 'request.approve', `${row.name} (${id})`);
    } else if (action === 'dismiss') {
      audit(ctx, me.id, 'request.dismiss', `${row.name} (${id})`);
    } else return reply.code(400).send({ error: 'bad_action' });
    db.run('UPDATE state.access_requests SET dismissed = 1 WHERE discord_id = ?', id);
    return { ok: true };
  });

  app.put('/api/admin/users/:id/hidden', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const id = Number((req.params as { id: string }).id);
    const body = z.object({ hidden: z.boolean() }).safeParse(req.body);
    if (!body.success || !auth.userById(id)) return reply.code(400).send({ error: 'bad_request' });
    const set = new Set(getSetting<number[]>(ctx, 'hiddenUsers') ?? []);
    if (body.data.hidden) set.add(id);
    else set.delete(id);
    putSetting(ctx, 'hiddenUsers', [...set]);
    audit(ctx, me.id, body.data.hidden ? 'user.hide' : 'user.unhide', auth.userById(id)?.name ?? String(id));
    return { ok: true };
  });

  /** Data that looks wrong: worth a look before it skews anyone's numbers. */
  app.get('/api/admin/suspicious', async (req, reply) => {
    if (!requireUser(req, reply, true)) return;
    const names = new Map(stats.accounts().map((a) => [a.uuid, a.name]));
    const out: { kind: string; account: string; ts: number; detail: string }[] = [];
    for (const f of db.all<{ account: string; death_ts: number; damage: number }>(
      'SELECT account, death_ts, damage FROM fights WHERE damage > 200000000 ORDER BY death_ts DESC LIMIT 50',
    )) {
      out.push({ kind: 'Huge damage', account: names.get(f.account) ?? f.account, ts: f.death_ts, detail: `${f.damage.toLocaleString('en-GB')} damage in one fight` });
    }
    for (const f of db.all<{ account: string; death_ts: number; ms: number }>(
      `SELECT account, death_ts, death_ts - spawn_ts AS ms FROM fights WHERE confirmed = 1 AND spawn_ts IS NOT NULL AND death_ts IS NOT NULL
       AND death_ts - spawn_ts < 2000 ORDER BY death_ts DESC LIMIT 50`,
    )) {
      out.push({ kind: 'Too fast', account: names.get(f.account) ?? f.account, ts: f.death_ts, detail: `boss died ${(f.ms / 1000).toFixed(1)}s after spawning` });
    }
    for (const e of db.all<{ account: string; ts: number; item: string; count: number }>(
      "SELECT account, ts, item, count FROM events WHERE kind = 'LOOT' AND count > 2000 AND item NOT IN ('STRING', 'ESSENCE_SPIDER') ORDER BY ts DESC LIMIT 50",
    )) {
      out.push({ kind: 'Big stack', account: names.get(e.account) ?? e.account, ts: e.ts, detail: `${e.count}x ${itemName(e.item)} in one drop` });
    }
    for (const e of db.all<{ account: string; ts: number; received_at: number }>(
      'SELECT account, ts, received_at FROM events WHERE received_at - ts > 86400000 ORDER BY ts DESC LIMIT 20',
    )) {
      out.push({ kind: 'Arrived late', account: names.get(e.account) ?? e.account, ts: e.ts, detail: `sent ${Math.round((e.received_at - e.ts) / 3_600_000)}h after it happened` });
    }
    return { items: out.sort((a, b) => b.ts - a.ts).slice(0, 100) };
  });

  /** Rebuild index.db from the event files: after a rule change, or if numbers look off. */
  let rebuilding = false;
  app.post('/api/admin/rebuild', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    if (rebuilding) return reply.code(409).send({ error: 'already_running' });
    rebuilding = true;
    try {
      const { rebuildIndex } = await import('./store/rebuild.ts');
      const report = await rebuildIndex(ctx);
      ctx.stats.invalidate();
      audit(ctx, me.id, 'index.rebuild', JSON.stringify(report).slice(0, 200));
      ctx.hub.publish('settings', { rebuilt: true });
      return report;
    } finally {
      rebuilding = false;
    }
  });

  app.get('/api/admin/audit', async (req, reply) => {
    if (!requireUser(req, reply, true)) return;
    const names = new Map(auth.listUsers().map((u) => [u.id, u.name || `user ${u.id}`]));
    return {
      entries: db
        .all<{ id: number; ts: number; user_id: number | null; action: string; detail: string }>(
          'SELECT * FROM state.audit ORDER BY id DESC LIMIT 200',
        )
        .map((e) => ({ id: e.id, ts: e.ts, by: e.user_id == null ? 'server' : (names.get(e.user_id) ?? `user ${e.user_id}`), action: e.action, detail: e.detail })),
    };
  });

  /** Stretches in the last 7 days with no Bazaar snapshot for over 30 minutes (PC off, API down). */
  const priceGaps = () => {
    const ts = db
      .all<{ ts: number }>("SELECT ts FROM prices WHERE item = 'ARACHNE_FRAGMENT' AND ts >= ? ORDER BY ts", Date.now() - 7 * 86_400_000)
      .map((r) => r.ts);
    const gaps: { from: number; to: number }[] = [];
    for (let i = 1; i < ts.length; i++) if (ts[i]! - ts[i - 1]! > 30 * 60_000) gaps.push({ from: ts[i - 1]!, to: ts[i]! });
    return gaps.slice(-20);
  };

  // Disk use, so the host PC does not fill up unnoticed.
  app.get('/api/admin/storage', async (req, reply) => {
    if (!requireUser(req, reply, true)) return;
    const dir = ctx.config.dataDir;
    return {
      events: dirSize(join(dir, 'events')),
      prices: dirSize(join(dir, 'prices')),
      indexDb: fileSize(join(dir, 'index.db')) + fileSize(join(dir, 'index.db-wal')),
      stateDb: fileSize(join(dir, 'state.db')) + fileSize(join(dir, 'state.db-wal')),
      downloads: dirSize(downloads),
      backups: dirSize(ctx.config.backupDir),
      eventCount: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n ?? 0,
      lastBackup: lastBackup(ctx),
      webhook: !!ctx.config.discordWebhookUrl,
      hidden: getSetting<number[]>(ctx, 'hiddenUsers') ?? [],
      ingest: { ...ingestHealth, lastMinute: ingestHealth.lastMinute.length },
      priceGaps: priceGaps(),
    };
  });
  app.post('/api/admin/backup', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    // Today's copy may already exist; make a fresh one on demand.
    const today = join(ctx.config.backupDir, `state-${new Date().toISOString().slice(0, 10)}.db`);
    if (existsSync(today)) rmSync(today);
    const file = backupState(ctx, Date.now());
    // Prove the copy is usable: open it and count the people in it.
    let users = -1;
    if (file) {
      const copy = new DatabaseSync(file, { readOnly: true });
      try {
        users = copy.prepare('SELECT COUNT(*) AS n FROM users').get()?.n as number;
      } finally {
        copy.close();
      }
    }
    audit(ctx, me.id, 'backup.now', `checked: ${users} people in the copy`);
    return { lastBackup: lastBackup(ctx), checkedUsers: users };
  });

  // ---- downloads of your own data ---------------------------------------------------

  const scopeIds = (user: User, scope: unknown) => (scope === 'me' ? stats.accountIds(user.id) : stats.accountIds());

  app.get('/api/export/drops.csv', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const ids = new Set(scopeIds(user, (req.query as { scope?: string }).scope));
    const accounts = stats.accounts().filter((a) => ids.has(a.uuid));
    const rows: (string | number | null)[][] = [['time_utc', 'account', 'kind', 'item_id', 'item', 'count', 'unit_value', 'value']];
    for (const a of accounts) {
      const col = priceColumn(a);
      for (const e of db.all<{ ts: number; kind: string; item: string | null; count: number; amount: number; u: number }>(
        `SELECT ts, kind, item, count, amount, ${col} AS u FROM events WHERE account = ? AND kind IN ('LOOT', 'PLACE', 'COINS') ORDER BY ts`,
        a.uuid,
      )) {
        const value = e.kind === 'COINS' ? e.amount : e.count * e.u * (e.kind === 'PLACE' ? -1 : 1);
        rows.push([iso(e.ts), a.name, e.kind, e.item, e.item ? itemName(e.item) : 'Coins', e.count, e.kind === 'COINS' ? null : Math.round(e.u), Math.round(value)]);
      }
    }
    rows.splice(1, rows.length - 1, ...rows.slice(1).sort((x, y) => String(x[0]).localeCompare(String(y[0]))));
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="arachne-drops.csv"')
      .send(csv(rows));
  });

  app.get('/api/export/fights.csv', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const ids = scopeIds(user, (req.query as { scope?: string }).scope);
    const names = new Map(stats.accounts().map((a) => [a.uuid, a.name]));
    const rows: (string | number | null)[][] = [['spawn_utc', 'death_utc', 'account', 'tier', 'damage', 'counted_kill', 'outcome', 'seconds']];
    if (ids.length > 0) {
      for (const f of db.all<Parameters<typeof toFacts>[0] & { account: string; tier: string; anchor_ts: number; confirmed: number }>(
        `SELECT * FROM fights WHERE account IN (${ids.map(() => '?').join(',')}) ORDER BY anchor_ts`,
        ...ids,
      )) {
        const counted = f.damage != null && f.damage >= KILL_DAMAGE_THRESHOLD && (f.damage_ts == null || f.death_ts == null || f.damage_ts - f.death_ts <= KILL_DAMAGE_WINDOW_MS);
        rows.push([
          iso(f.spawn_ts),
          iso(f.death_ts),
          names.get(f.account) ?? f.account,
          f.tier,
          f.damage,
          counted ? 'yes' : 'no',
          fightOutcome(toFacts(f)),
          f.spawn_ts != null && f.death_ts != null && f.confirmed ? Math.round((f.death_ts - f.spawn_ts) / 1000) : null,
        ]);
      }
    }
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="arachne-fights.csv"')
      .send(csv(rows));
  });

  // Everything stored about you, in one file.
  app.get('/api/export/me.json', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const accounts = stats.accounts(user.id);
    const ids = accounts.map((a) => a.uuid);
    const inList = ids.map(() => '?').join(',');
    const body = {
      exportedAt: new Date().toISOString(),
      user: { discordId: user.discord_id, name: user.name, role: user.role, createdAt: iso(user.created_at ?? null) },
      tokens: auth.listTokens(user.id).map((t) => ({ label: t.label, prefix: t.prefix, createdAt: iso(t.created_at), lastUsedAt: iso(t.last_used_at), revokedAt: iso(t.revoked_at) })),
      accounts,
      events: ids.length ? db.all(`SELECT * FROM events WHERE account IN (${inList}) ORDER BY ts`, ...ids) : [],
      fights: ids.length ? db.all(`SELECT * FROM fights WHERE account IN (${inList}) ORDER BY anchor_ts`, ...ids) : [],
    };
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="arachne-my-data.json"')
      .send(JSON.stringify(body, null, 1));
  });

  // ---- graphs and drop pages --------------------------------------------------------

  const DAY = 86_400_000;
  /** `days` from the query, clamped; 0 means all of history. */
  const sinceDays = (q: unknown, fallback: number) => {
    const n = Number((q as { days?: string }).days);
    const days = Number.isFinite(n) && n >= 0 ? Math.min(n, 3650) : fallback;
    return days === 0 ? 0 : Date.now() - days * DAY;
  };

  app.get('/api/drop-rates', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return ctx.views.dropRates(scopeIds(user, (req.query as { scope?: string }).scope));
  });
  app.get('/api/heatmap', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return ctx.views.heatmap(scopeIds(user, (req.query as { scope?: string }).scope), sinceDays(req.query, 28), Date.now());
  });
  app.get('/api/calendar', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return ctx.views.calendar(scopeIds(user, (req.query as { scope?: string }).scope), 182, Date.now());
  });
  app.get('/api/whatif', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return ctx.views.whatIf(scopeIds(user, (req.query as { scope?: string }).scope), sinceDays(req.query, 7));
  });
  app.get('/api/damage', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return ctx.views.damage(scopeIds(user, (req.query as { scope?: string }).scope), sinceDays(req.query, 7));
  });
  app.get('/api/prices/history', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const item = String((req.query as { item?: string }).item ?? '');
    if (!/^[A-Z0-9_]{1,64}$/.test(item)) return reply.code(400).send({ error: 'bad_item' });
    return { item, points: priceHistory(item, sinceDays(req.query, 7)) };
  });

  /** Hourly averages, so a month is ~720 points, not ~8,600 snapshots. */
  const priceHistory = (item: string, from: number) =>
    db.all<{ t: number; instant: number | null; offer: number | null }>(
      `SELECT (ts / 3600000) * 3600000 AS t, AVG(instant) AS instant, AVG(offer) AS offer
       FROM prices WHERE item = ? AND ts >= ? GROUP BY t ORDER BY t`,
      item,
      from,
    );

  /** Latest instant-sell price of every tracked item, and how it moved over 24 hours. */
  const market = () => {
    const now = Date.now();
    const ids = [...Object.keys(ITEMS), ...Object.keys(SUMMON_ITEMS), 'BOOSTER_COOKIE'];
    return ids.map((id) => {
      const latest = db.get<{ instant: number | null; offer: number | null; ts: number }>(
        'SELECT instant, offer, ts FROM prices WHERE item = ? ORDER BY ts DESC LIMIT 1',
        id,
      );
      const before = db.get<{ instant: number | null }>(
        'SELECT instant FROM prices WHERE item = ? AND ts <= ? ORDER BY ts DESC LIMIT 1',
        id,
        now - DAY,
      );
      const price = latest?.instant ?? null;
      const old = before?.instant ?? null;
      // Where today's price sits among the last 30 days (0 = lowest, 1 = highest): "sell now or hold?".
      const month = price == null ? [] : db.all<{ p: number }>('SELECT instant AS p FROM prices WHERE item = ? AND ts >= ? AND instant IS NOT NULL', id, now - 30 * DAY);
      const percentile = month.length >= 24 ? month.filter((m) => m.p < price!).length / month.length : null;
      const offer = latest?.offer ?? null;
      return {
        item: id,
        name: itemName(id),
        price,
        change: price != null && old ? (price - old) / old : null,
        at: latest?.ts ?? null,
        /** Gap between instant sell and sell offer, as a share of the offer. Big = thin market. */
        spread: price != null && offer ? (offer - price) / offer : null,
        percentile,
      };
    });
  };
  app.get('/api/prices/movers', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return { items: market() };
  });

  // ---- public, no login -------------------------------------------------------------

  /** Prices for the public calculators and ticker. Bazaar data is public anyway. */
  app.get('/api/public/prices', async () => {
    const now = Date.now();
    return {
      updatedAt: ctx.prices.updatedAt || null,
      items: market(),
      crystal: ctx.prices.summon('ARACHNE_CRYSTAL', now),
      calling: ctx.prices.summon('ARACHNE_KEEPER_FRAGMENT', now),
    };
  });

  /** A small "up" / "down" image for a README or a Discord channel topic. */
  app.get('/api/public/badge.svg', async (_req, reply) => {
    const last = db.get<{ t: number | null }>('SELECT MAX(received_at) AS t FROM events')?.t ?? 0;
    const recent = Date.now() - last < 6 * 3_600_000;
    const text = recent ? 'up, tracking' : 'up, quiet';
    const w = 70 + text.length * 7;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="Arachne.fyi: ${text}">
<rect width="70" height="20" fill="#2a221b"/><rect x="70" width="${w - 70}" height="20" fill="${recent ? '#3f9a52' : '#c77a12'}"/>
<g fill="#fff" font-family="Verdana,sans-serif" font-size="11"><text x="6" y="14">arachne</text><text x="76" y="14">${text}</text></g></svg>`;
    return reply.header('content-type', 'image/svg+xml').header('cache-control', 'no-cache, max-age=60').send(svg);
  });

  /** Counters for a monitoring tool, only from this PC (the tunnel always comes from localhost, so also require no proxy header). */
  app.get('/metrics', async (req, reply) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const n = (sql: string) => db.get<{ n: number }>(sql)?.n ?? 0;
    const lines = [
      `arachne_events_total ${n('SELECT COUNT(*) AS n FROM events')}`,
      `arachne_fights_total ${n('SELECT COUNT(*) AS n FROM fights')}`,
      `arachne_accounts_online ${stats.onlineCount(Date.now())}`,
      `arachne_live_dashboards ${ctx.hub.size}`,
      `arachne_prices_age_seconds ${ctx.prices.updatedAt ? Math.round((Date.now() - ctx.prices.updatedAt) / 1000) : -1}`,
      `arachne_last_event_age_seconds ${Math.round((Date.now() - (db.get<{ t: number | null }>('SELECT MAX(received_at) AS t FROM events')?.t ?? 0)) / 1000)}`,
    ];
    return reply.header('content-type', 'text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });

  /** Drop rates seen across everyone, with no names: what the calculators use. */
  app.get('/api/public/rates', async () => ctx.views.dropRates(stats.accountIds()));

  /** Is the server up, and when did it last hear from a mod. No names, just counts. */
  app.get('/api/public/status', async () => {
    const now = Date.now();
    const last = db.get<{ t: number | null }>('SELECT MAX(received_at) AS t FROM events')?.t ?? null;
    const all = stats.totals(stats.accountIds(), 0, Number.MAX_SAFE_INTEGER);
    return {
      ok: true,
      serverTime: now,
      lastEventAt: last,
      pricesUpdatedAt: ctx.prices.updatedAt || null,
      online: stats.onlineCount(now),
      kills: all.kills,
      tracked: all.lootValue + all.coins,
    };
  });
}
