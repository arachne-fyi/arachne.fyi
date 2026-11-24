import { randomBytes, randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { itemName } from '@arachne/shared';
import type { User } from './auth.ts';
import type { Context } from './context.ts';
import { hiddenUsers } from './extras.ts';
import { hourlyColumn, priceColumn } from './stats.ts';
import { publicProfile } from './features.ts';

type RequireUser = (req: FastifyRequest, reply: FastifyReply, admin?: boolean) => User | null;

const DAY = 86_400_000;
const short = (v: number) =>
  Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** What came in through /api/v1/batch since the server started, for the Admin page. */
export const ingestHealth = { since: Date.now(), batches: 0, accepted: 0, duplicates: 0, rejected: 0, lastMinute: [] as number[] };
export function countBatch(accepted: number, duplicates: number, rejected: number, now: number) {
  ingestHealth.batches++;
  ingestHealth.accepted += accepted;
  ingestHealth.duplicates += duplicates;
  ingestHealth.rejected += rejected;
  ingestHealth.lastMinute = ingestHealth.lastMinute.filter((t) => now - t < 60_000);
  for (let i = 0; i < Math.min(accepted, 500); i++) ingestHealth.lastMinute.push(now);
}

/** Where this person sits by today's profit, 1 = top. Sent back to the mod for its HUD. */
export function todayRank(ctx: Context, userId: number, now: number): { rank: number; of: number } | null {
  const hidden = hiddenUsers(ctx);
  // Within your group when you're in one (the HUD's "#2 of 5"), else among everyone.
  const group = ctx.stats.hudGroup(userId);
  const inGroup = group.tag === null ? null : new Set(group.userIds);
  const rows = ctx.auth
    .listUsers()
    .filter((u) => !u.disabled && !hidden.has(u.id) && (!inGroup || inGroup.has(u.id)))
    .map((u) => ({ id: u.id, ids: ctx.stats.accountIds(u.id) }))
    .filter((u) => u.ids.length > 0)
    .map((u) => ({ id: u.id, p: ctx.stats.window(u.ids, 'today', now).profit }))
    .sort((a, b) => b.p - a.p);
  const i = rows.findIndex((r) => r.id === userId);
  return i < 0 ? null : { rank: i + 1, of: rows.length };
}

interface Extra {
  /** Secret for the stream overlay URL. */
  overlayKey?: string;
  /** Opt-in public profile name (lowercase, url-safe). */
  publicName?: string;
}

/** Someone's public profile, by the name they picked. Undefined if they have none. */
export function userByPublicName(ctx: Context, name: string): User | undefined {
  return ctx.auth.listUsers().find((u) => {
    if (u.disabled) return false;
    const row = ctx.db.get<{ value: string }>('SELECT value FROM state.settings WHERE key = ?', `extra:${u.id}`);
    return !!row && (JSON.parse(row.value) as Extra).publicName === name;
  });
}

export function registerFun(app: FastifyInstance, ctx: Context, requireUser: RequireUser): void {
  const { db, stats, auth } = ctx;

  const extra = (userId: number): Extra => {
    const row = db.get<{ value: string }>('SELECT value FROM state.settings WHERE key = ?', `extra:${userId}`);
    return row ? (JSON.parse(row.value) as Extra) : {};
  };
  const putExtra = (userId: number, e: Extra) =>
    db.run('INSERT OR REPLACE INTO state.settings (key, value) VALUES (?, ?)', `extra:${userId}`, JSON.stringify(e));
  const userByExtra = (pick: (e: Extra) => string | undefined, value: string): User | undefined =>
    auth.listUsers().find((u) => !u.disabled && pick(extra(u.id)) === value);

  // ---- pairing with a short code ----------------------------------------------------

  /** Codes waiting for a mod: code → token, for 10 minutes. Memory only; a restart clears them. */
  const codes = new Map<string, { token: string; userId: number; expires: number }>();
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups

  app.post('/api/pair-code', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const now = Date.now();
    for (const [c, v] of codes) if (v.expires < now) codes.delete(c);
    const label = z.object({ label: z.string().trim().min(1).max(40) }).safeParse(req.body ?? {});
    const { token } = auth.createToken(user.id, label.success ? label.data.label : 'Paired with a code', now);
    let code = '';
    do code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    while (codes.has(code));
    codes.set(code, { token, userId: user.id, expires: now + 10 * 60_000 });
    // The server's own address, so a dashboard that isn't app.arachne.fyi can show the full command.
    return { code, expiresAt: now + 10 * 60_000, endpoint: ctx.config.publicUrl };
  });

  const pairLimit = new Map<string, number[]>();
  /** The mod trades a code for its token. Single use. */
  app.post('/api/v1/pair', async (req, reply) => {
    const now = Date.now();
    const hits = (pairLimit.get(req.ip) ?? []).filter((t) => now - t < 60_000);
    hits.push(now);
    pairLimit.set(req.ip, hits);
    if (hits.length > 10) return reply.code(429).send({ error: 'slow_down' });
    const body = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/) }).safeParse(req.body);
    const hit = body.success ? codes.get(body.data.code) : undefined;
    if (!hit || hit.expires < now) return reply.code(404).send({ error: 'unknown_code' });
    codes.delete(body.data!.code);
    return { token: hit.token, endpoint: ctx.config.publicUrl, user: auth.userById(hit.userId)?.name ?? '' };
  });

  // ---- your public bits: overlay and profile ----------------------------------------

  app.get('/api/me/sharing', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const e = extra(user.id);
    return { overlayKey: e.overlayKey ?? null, publicName: e.publicName ?? null, base: ctx.config.publicUrl };
  });
  app.put('/api/me/sharing', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({ overlay: z.enum(['new', 'off']).optional(), publicName: z.string().regex(/^[a-z0-9_-]{3,24}$/).or(z.literal('')).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_name' });
    const e = extra(user.id);
    if (body.data.overlay === 'new') e.overlayKey = randomBytes(12).toString('base64url');
    if (body.data.overlay === 'off') delete e.overlayKey;
    if (body.data.publicName !== undefined) {
      if (body.data.publicName && userByExtra((x) => x.publicName, body.data.publicName) && extra(user.id).publicName !== body.data.publicName) {
        return reply.code(409).send({ error: 'name_taken' });
      }
      if (body.data.publicName) e.publicName = body.data.publicName;
      else delete e.publicName;
    }
    putExtra(user.id, e);
    return { ok: true };
  });

  /** Numbers for a stream overlay: today's session for whoever owns this key. */
  app.get('/api/public/overlay/:key', async (req, reply) => {
    const key = (req.params as { key: string }).key;
    const user = key.length >= 12 ? userByExtra((e) => e.overlayKey, key) : undefined;
    if (!user) return reply.code(404).send({ error: 'unknown_overlay' });
    const now = Date.now();
    const ids = stats.accountIds(user.id);
    const t = stats.window(ids, 'today', now);
    const last = ctx.insights.recentKills(ids, 1)[0] ?? null;
    const week = stats.window(ids, 'week', now);
    return {
      name: user.name,
      profit: t.profit,
      kills: t.kills,
      perHour: t.wallUptimeMs > 0 ? t.profitPerWallHour : null,
      uptimeMs: t.wallUptimeMs,
      crystals: t.crystals,
      callings: t.callings,
      loot: t.lootValue + t.coins,
      costs: t.costs,
      weekProfit: week.profit,
      weekKills: week.kills,
      lastKill: last,
    };
  });

  /** A public profile someone chose to turn on, with only the fields they made public. */
  const profile = (name: string) => {
    const user = userByExtra((e) => e.publicName, name);
    return user ? publicProfile(ctx, user) : null;
  };
  app.get('/api/public/profile/:name', async (req, reply) => {
    const p = profile((req.params as { name: string }).name);
    return p ?? reply.code(404).send({ error: 'no_profile' });
  });

  /** The same profile as a small image, to paste into forums or Discord. */
  app.get('/api/public/card/:name.svg', async (req, reply) => {
    const p = profile((req.params as { name: string }).name);
    if (!p) return reply.code(404).send({ error: 'no_profile' });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120" viewBox="0 0 420 120" role="img" aria-label="${esc(p.name)} on Arachne.fyi">
<rect width="420" height="120" fill="#1b1510"/><rect x="2" y="2" width="416" height="116" fill="none" stroke="#ffa62b" stroke-width="4"/>
<g font-family="Consolas,monospace" fill="#f5ecdb">
<text x="20" y="34" font-size="20" font-weight="700">${esc(p.name)}</text>
<text x="400" y="34" font-size="13" text-anchor="end" fill="#b8aa93">arachne.fyi</text>
<text x="20" y="74" font-size="28" font-weight="700" fill="#ffa62b">${p.total.profit === undefined ? '-' : esc(short(p.total.profit))}</text>
<text x="20" y="98" font-size="13" fill="#b8aa93">profit</text>
<text x="190" y="74" font-size="22" font-weight="700">${p.total.kills === undefined ? '-' : p.total.kills.toLocaleString('en-GB')}</text>
<text x="190" y="98" font-size="13" fill="#b8aa93">kills</text>
<text x="310" y="74" font-size="22" font-weight="700">${p.total.perHour == null ? '-' : esc(short(p.total.perHour))}</text>
<text x="310" y="98" font-size="13" fill="#b8aa93">per hour</text>
</g></svg>`;
    return reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=300').send(svg);
  });

  // ---- year in review ----------------------------------------------------------------

  app.get('/api/wrapped', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const year = Number((req.query as { year?: string }).year) || new Date().getUTCFullYear();
    const from = Date.UTC(year, 0, 1);
    const to = Date.UTC(year + 1, 0, 1);
    const ids = stats.accountIds(user.id);
    const t = stats.totals(ids, from, to);
    const accounts = stats.accounts(user.id);
    // Best month and favourite hour, from the hourly table.
    const months = new Array<number>(12).fill(0);
    const hours = new Array<number>(24).fill(0);
    for (const a of accounts) {
      const col = priceColumn(a);
      const v = hourlyColumn(col);
      for (const r of db.all<{ hour: number; p: number }>(
        `SELECT hour, SUM(CASE WHEN kind = 'PLACE' THEN -${v} WHEN kind = 'COINS' THEN amount ELSE ${v} END) AS p
         FROM hourly WHERE account = ? AND hour >= ? AND hour < ? GROUP BY hour`,
        a.uuid,
        from,
        to,
      )) {
        months[new Date(r.hour).getUTCMonth()]! += r.p;
        hours[new Date(r.hour).getUTCHours()]! += r.p;
      }
    }
    let bestDrop: { item: string; name: string; value: number; ts: number } | null = null;
    for (const a of accounts) {
      const col = priceColumn(a);
      const r = db.get<{ item: string; v: number; ts: number }>(
        `SELECT item, count * ${col} AS v, ts FROM events WHERE account = ? AND kind = 'LOOT' AND ts >= ? AND ts < ? ORDER BY v DESC LIMIT 1`,
        a.uuid,
        from,
        to,
      );
      if (r && (!bestDrop || r.v > bestDrop.value)) bestDrop = { item: r.item, name: itemName(r.item), value: r.v, ts: r.ts };
    }
    const days =
      ids.length === 0
        ? 0
        : (db.get<{ n: number }>(
            `SELECT COUNT(DISTINCT death_ts / ${DAY}) AS n FROM fights WHERE account IN (${ids.map(() => '?').join(',')}) AND death_ts >= ? AND death_ts < ?`,
            ...ids,
            from,
            to,
          )?.n ?? 0);
    const top = (arr: number[]) => arr.reduce((b, v, i) => (v > arr[b]! ? i : b), 0);
    return {
      year,
      totals: t,
      days,
      bestMonth: t.kills > 0 ? { month: top(months), profit: months[top(months)]! } : null,
      favouriteHour: t.kills > 0 ? top(hours) : null,
      bestDrop,
      badges: ctx.progress.badges(ids, Date.now()).filter((b) => b.earned).length,
    };
  });
}
