import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { User } from './auth.ts';
import type { Context } from './context.ts';
import { audit, getSetting, putSetting } from './extras.ts';

type RequireUser = (req: FastifyRequest, reply: FastifyReply, admin?: boolean) => User | null;

/**
 * Version of the terms, privacy notice and cookie notice. Change it when any of them changes
 * in a way people should agree to again: everyone is asked on their next visit.
 */
export const TERMS_VERSION = '2026-11-17';

export const GROUP_MAX = 5;
export const LIMITS = {
  free: { owned: 1, joined: 3 },
  pro: { owned: 5, joined: 10 },
} as const;

/** Pages that need Pro. They answer 402 for everyone else, so the data never reaches the browser. */
export const PRO_PATHS = new Set(['/api/heatmap', '/api/calendar', '/api/damage', '/api/whatif', '/api/drop-rates', '/api/wrapped']);

/** Paths a person without a current consent can still use. */
const CONSENT_FREE = /^\/api\/(me$|consent$|public\/|me\/delete$|export\/me\.json$)/;

const DAY = 86_400_000;

function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now: number): boolean => {
    const h = hits.get(key);
    if (!h || now >= h.reset) {
      if (hits.size > 5_000) hits.clear();
      hits.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    return ++h.n <= max;
  };
}

// ---- plans ---------------------------------------------------------------------------

export interface PlanInfo {
  plan: 'free' | 'pro';
  until: number | null;
  source: string;
}

/**
 * "View as free user": the browser sends this header while the switch is on. It can only ever
 * lower a plan, never raise it, so anyone may send it; nothing to check.
 */
export const VIEW_FREE_HEADER = 'x-view-plan';
export const viewsAsFree = (req: { headers: Record<string, string | string[] | undefined> }) => req.headers[VIEW_FREE_HEADER] === 'free';

export function planOf(ctx: Context, user: { id: number; role: string }, now: number, asFree = false): PlanInfo {
  if (asFree) return { plan: 'free', until: null, source: 'preview' };
  if (user.role === 'admin') return { plan: 'pro', until: null, source: 'admin' };
  const row = ctx.db.get<{ plan: 'free' | 'pro'; until: number | null; source: string }>('SELECT plan, until, source FROM state.plans WHERE user_id = ?', user.id);
  if (row && row.plan === 'pro' && (row.until == null || row.until > now)) return { plan: 'pro', until: row.until, source: row.source };
  return { plan: 'free', until: null, source: '' };
}

/** Everyone who already had access before plans existed keeps Pro, once. */
export function grandfather(ctx: Context): void {
  if (getSetting(ctx, 'plansInit')) return;
  const now = Date.now();
  ctx.db.run(
    `INSERT OR IGNORE INTO state.plans (user_id, plan, until, source, updated_at)
     SELECT id, 'pro', NULL, 'founder', ? FROM state.users`,
    now,
  );
  putSetting(ctx, 'plansInit', now);
}

function grantPro(ctx: Context, userId: number, days: number, source: string, now: number): void {
  const row = ctx.db.get<{ plan: string; until: number | null }>('SELECT plan, until FROM state.plans WHERE user_id = ?', userId);
  let until: number | null;
  if (row && row.plan === 'pro' && row.until == null) until = null; // already has no end date
  else {
    const base = row && row.plan === 'pro' && row.until && row.until > now ? row.until : now;
    until = base + days * DAY;
  }
  ctx.db.run(
    `INSERT INTO state.plans (user_id, plan, until, source, updated_at) VALUES (?, 'pro', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET plan = 'pro', until = excluded.until, source = excluded.source, updated_at = excluded.updated_at`,
    userId,
    until,
    source,
    now,
  );
}

// ---- privacy -------------------------------------------------------------------------

/** People who chose not to appear on shared boards, feeds and groups. */
export function privateUsers(ctx: Context): Set<number> {
  return new Set(ctx.db.all<{ user_id: number }>('SELECT user_id FROM state.privacy WHERE visible = 0').map((r) => r.user_id));
}

// ---- consent -------------------------------------------------------------------------

export function hasConsent(ctx: Context, userId: number): boolean {
  const row = ctx.db.get<{ version: string; age_ok: number }>('SELECT version, age_ok FROM state.consent WHERE user_id = ?', userId);
  return !!row && row.version === TERMS_VERSION && row.age_ok === 1;
}

// ---- global stats --------------------------------------------------------------------

interface Erased {
  kills: number;
  drops: number;
  coins: number;
}

let globalCache: { at: number; value: { coins: number; drops: number; kills: number } } | null = null;

/** Anonymous totals across everyone. Numbers from deleted accounts stay in as a plain sum. */
export function globalStats(ctx: Context, now: number) {
  if (globalCache && now - globalCache.at < 60_000) return globalCache.value;
  const ids = ctx.stats.accountIds();
  const t = ctx.stats.totals(ids, 0, Number.MAX_SAFE_INTEGER);
  const drops = ctx.stats.lootTable(ids, 0, Number.MAX_SAFE_INTEGER).reduce((n, l) => n + l.count, 0);
  const gone = getSetting<Erased>(ctx, 'globalErased') ?? { kills: 0, drops: 0, coins: 0 };
  const value = {
    coins: Math.round(t.lootValue + t.coins) + gone.coins,
    drops: drops + gone.drops,
    kills: t.kills + gone.kills,
  };
  globalCache = { at: now, value };
  return value;
}

// ---- erasing someone -----------------------------------------------------------------

/** Remove every line for these accounts from the NDJSON day files (plain and gzipped). */
function purgeLogs(ctx: Context, uuids: string[]): void {
  const mine = new Set(uuids);
  for (const file of ctx.events.files()) {
    const gz = file.endsWith('.gz');
    const text = (gz ? gunzipSync(readFileSync(file)) : readFileSync(file)).toString('utf8');
    let changed = false;
    const kept = text.split('\n').filter((line) => {
      if (!line) return false;
      try {
        const account = (JSON.parse(line) as { account?: string }).account;
        if (account && mine.has(account)) {
          changed = true;
          return false;
        }
      } catch {
        /* keep lines we cannot read */
      }
      return true;
    });
    if (!changed) continue;
    const out = kept.length ? kept.join('\n') + '\n' : '';
    writeFileSync(file, gz ? gzipSync(out) : out);
  }
}

/** Delete a person and everything that is theirs. The anonymous global totals keep their share. */
export function eraseUser(ctx: Context, userId: number, now: number): void {
  const uuids = ctx.stats.accountIds(userId);
  if (uuids.length) {
    const t = ctx.stats.totals(uuids, 0, Number.MAX_SAFE_INTEGER);
    const drops = ctx.stats.lootTable(uuids, 0, Number.MAX_SAFE_INTEGER).reduce((n, l) => n + l.count, 0);
    const gone = getSetting<Erased>(ctx, 'globalErased') ?? { kills: 0, drops: 0, coins: 0 };
    putSetting(ctx, 'globalErased', {
      kills: gone.kills + t.kills,
      drops: gone.drops + drops,
      coins: gone.coins + Math.round(t.lootValue + t.coins),
    });
    purgeLogs(ctx, uuids);
  }
  ctx.db.tx(() => {
    for (const uuid of uuids) {
      for (const table of ['events', 'fights', 'uptime', 'hourly']) ctx.db.run(`DELETE FROM ${table} WHERE account = ?`, uuid);
      ctx.db.run('DELETE FROM state.accounts WHERE uuid = ?', uuid);
    }
    // Groups: pass ownership on to the longest-standing member, or close an empty group.
    for (const g of ctx.db.all<{ id: number }>("SELECT group_id AS id FROM state.group_members WHERE user_id = ? AND role = 'owner'", userId)) {
      const next = ctx.db.get<{ user_id: number }>('SELECT user_id FROM state.group_members WHERE group_id = ? AND user_id != ? ORDER BY (role = \'mod\') DESC, joined_at LIMIT 1', g.id, userId);
      if (next) {
        ctx.db.run("UPDATE state.group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?", g.id, next.user_id);
        ctx.db.run('UPDATE state.groups SET owner_id = ? WHERE id = ?', next.user_id, g.id);
      } else ctx.db.run('DELETE FROM state.groups WHERE id = ?', g.id);
    }
    for (const sql of [
      'DELETE FROM state.group_members WHERE user_id = ?',
      'DELETE FROM state.reactions WHERE user_id = ?',
      'DELETE FROM state.comments WHERE user_id = ?',
      'DELETE FROM state.user_settings WHERE user_id = ?',
      'DELETE FROM state.push_subs WHERE user_id = ?',
      'DELETE FROM state.consent WHERE user_id = ?',
      'DELETE FROM state.plans WHERE user_id = ?',
      'DELETE FROM state.privacy WHERE user_id = ?',
      'DELETE FROM state.code_uses WHERE user_id = ?',
      'DELETE FROM state.challenges WHERE created_by = ?',
      'DELETE FROM state.users WHERE id = ?', // sessions and tokens go with it
    ]) {
      try {
        ctx.db.run(sql, userId);
      } catch {
        /* a table that does not exist yet (push) is fine */
      }
    }
  });
  globalCache = null;
  // No name, no id: just that an erasure happened.
  audit(ctx, null, 'user.erased', `${uuids.length} account(s)`);
  void now;
}

// ---- routes --------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = (len: number) => Array.from(randomBytes(len), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

export function registerPlatform(app: FastifyInstance, ctx: Context, requireUser: RequireUser): void {
  const { db, stats } = ctx;
  const redeemLimit = limiter(10, 60_000);
  const joinLimit = limiter(10, 60_000);

  // -- who am I: plan, consent -------------------------------------------------------

  app.get('/api/consent', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { version: TERMS_VERSION, accepted: hasConsent(ctx, user.id) };
  });
  app.post('/api/consent', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z.object({ terms: z.literal(true), age: z.literal(true) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'must_accept' });
    ctx.db.run(
      `INSERT INTO state.consent (user_id, version, accepted_at, age_ok) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, accepted_at = excluded.accepted_at, age_ok = 1`,
      user.id,
      TERMS_VERSION,
      Date.now(),
    );
    return { ok: true };
  });

  app.get('/api/me/plan', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const now = Date.now();
    const plan = planOf(ctx, user, now, viewsAsFree(req));
    const owned = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM state.group_members WHERE user_id = ? AND role = 'owner'", user.id)?.n ?? 0;
    const joined = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM state.group_members WHERE user_id = ?', user.id)?.n ?? 0;
    return { ...plan, limits: LIMITS[plan.plan], owned, joined, proPaths: [...PRO_PATHS] };
  });

  // -- privacy and data rights -------------------------------------------------------

  app.get('/api/me/privacy', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { visible: !privateUsers(ctx).has(user.id) };
  });
  app.put('/api/me/privacy', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z.object({ visible: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    db.run('INSERT INTO state.privacy (user_id, visible) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET visible = excluded.visible', user.id, body.data.visible ? 1 : 0);
    return { ok: true };
  });

  /** Right to erasure. Typing DELETE is the only confirmation; there is no undo. */
  app.post('/api/me/delete', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z.object({ confirm: z.literal('DELETE') }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'type_delete' });
    if (user.role === 'admin' && db.get<{ n: number }>("SELECT COUNT(*) AS n FROM state.users WHERE role = 'admin' AND disabled = 0")?.n === 1) {
      return reply.code(409).send({ error: 'last_admin' });
    }
    eraseUser(ctx, user.id, Date.now());
    reply.clearCookie('al_session', { path: '/' });
    return { ok: true };
  });

  // -- global, anonymous numbers (home page) ----------------------------------------

  app.get('/api/public/global', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return { ...globalStats(ctx, Date.now()), at: Date.now() };
  });

  // -- Pro codes --------------------------------------------------------------------

  app.post('/api/redeem', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const now = Date.now();
    if (!redeemLimit(`u${user.id}`, now)) return reply.code(429).send({ error: 'slow_down' });
    const body = z.object({ code: z.string().trim().toUpperCase().max(40) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const c = db.get<{ code: string; days: number; expires_at: number; max_uses: number; uses: number }>('SELECT * FROM state.codes WHERE code = ?', body.data.code);
    if (!c) return reply.code(404).send({ error: 'unknown_code' });
    if (c.expires_at <= now) return reply.code(410).send({ error: 'expired' });
    if (c.uses >= c.max_uses) return reply.code(410).send({ error: 'used_up' });
    if (db.get('SELECT 1 FROM state.code_uses WHERE code = ? AND user_id = ?', c.code, user.id)) return reply.code(409).send({ error: 'already_used' });
    db.tx(() => {
      db.run('INSERT INTO state.code_uses (code, user_id, ts) VALUES (?, ?, ?)', c.code, user.id, now);
      db.run('UPDATE state.codes SET uses = uses + 1 WHERE code = ?', c.code);
      grantPro(ctx, user.id, c.days, `code:${c.code}`, now);
    });
    return { ok: true, days: c.days, plan: planOf(ctx, user, now, viewsAsFree(req)) };
  });

  app.get('/api/admin/codes', async (req, reply) => {
    if (!requireUser(req, reply, true)) return;
    const now = Date.now();
    return {
      codes: db
        .all<{ code: string; days: number; created_at: number; expires_at: number; max_uses: number; uses: number; note: string }>('SELECT * FROM state.codes ORDER BY created_at DESC LIMIT 100')
        .map((c) => ({ code: c.code, days: c.days, createdAt: c.created_at, expiresAt: c.expires_at, maxUses: c.max_uses, uses: c.uses, note: c.note, live: c.expires_at > now && c.uses < c.max_uses })),
    };
  });
  app.post('/api/admin/codes', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const body = z
      .object({
        days: z.number().int().min(1).max(366).default(30),
        validMinutes: z.number().int().min(1).max(10_080).default(10),
        maxUses: z.number().int().min(1).max(1000).default(1),
        count: z.number().int().min(1).max(20).default(1),
        note: z.string().trim().max(80).default(''),
      })
      .safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const now = Date.now();
    const made: string[] = [];
    for (let i = 0; i < body.data.count; i++) {
      const code = `ARF-${randomCode(4)}-${randomCode(4)}`;
      db.run(
        'INSERT INTO state.codes (code, plan, days, created_by, created_at, expires_at, max_uses, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        code,
        'pro',
        body.data.days,
        me.id,
        now,
        now + body.data.validMinutes * 60_000,
        body.data.maxUses,
        body.data.note,
      );
      made.push(code);
    }
    audit(ctx, me.id, 'codes.create', `${made.length} x ${body.data.days}d, ${body.data.validMinutes} min, ${body.data.maxUses} use(s)`);
    return { codes: made };
  });
  app.delete('/api/admin/codes/:code', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const { code } = req.params as { code: string };
    db.run('UPDATE state.codes SET expires_at = 0 WHERE code = ?', code);
    audit(ctx, me.id, 'codes.revoke', code);
    return { ok: true };
  });

  app.get('/api/admin/plans', async (req, reply) => {
    if (!requireUser(req, reply, true)) return;
    const now = Date.now();
    return {
      plans: ctx.auth.listUsers().map((u) => ({ userId: u.id, ...planOf(ctx, u, now) })),
      openSignup: !!getSetting<boolean>(ctx, 'openSignup'),
    };
  });
  app.put('/api/admin/users/:id/plan', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const id = Number((req.params as { id: string }).id);
    const body = z.object({ plan: z.enum(['free', 'pro']), days: z.number().int().min(1).max(3660).optional() }).safeParse(req.body);
    if (!body.success || !ctx.auth.userById(id)) return reply.code(400).send({ error: 'bad_request' });
    const now = Date.now();
    if (body.data.plan === 'free') db.run("INSERT INTO state.plans (user_id, plan, until, source, updated_at) VALUES (?, 'free', NULL, 'given', ?) ON CONFLICT(user_id) DO UPDATE SET plan = 'free', until = NULL, source = 'given', updated_at = excluded.updated_at", id, now);
    else if (body.data.days) {
      db.run('DELETE FROM state.plans WHERE user_id = ?', id);
      grantPro(ctx, id, body.data.days, 'given', now);
    } else db.run("INSERT INTO state.plans (user_id, plan, until, source, updated_at) VALUES (?, 'pro', NULL, 'given', ?) ON CONFLICT(user_id) DO UPDATE SET plan = 'pro', until = NULL, source = 'given', updated_at = excluded.updated_at", id, now);
    audit(ctx, me.id, 'plan.set', `user ${id} -> ${body.data.plan}${body.data.days ? ` ${body.data.days}d` : ''}`);
    return { ok: true };
  });
  app.put('/api/admin/open-signup', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const body = z.object({ open: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    putSetting(ctx, 'openSignup', body.data.open ? true : null);
    audit(ctx, me.id, body.data.open ? 'signup.open' : 'signup.closed');
    return { ok: true };
  });

  // -- groups -----------------------------------------------------------------------

  interface GroupRow {
    id: number;
    code: string;
    name: string;
    tag: string;
    description: string;
    owner_id: number;
    created_at: number;
  }
  const memberOf = (groupId: number, userId: number) =>
    db.get<{ role: 'owner' | 'mod' | 'member'; show_tag: number }>('SELECT role, show_tag FROM state.group_members WHERE group_id = ? AND user_id = ?', groupId, userId);
  const countOf = (groupId: number) => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM state.group_members WHERE group_id = ?', groupId)?.n ?? 0;
  const mine = (id: number, userId: number) => ({ g: db.get<GroupRow>('SELECT * FROM state.groups WHERE id = ?', id), m: memberOf(id, userId) });
  const newCode = () => {
    for (;;) {
      const code = randomCode(6);
      if (!db.get('SELECT 1 FROM state.groups WHERE code = ?', code)) return code;
    }
  };
  const groupJson = (g: GroupRow, role: string, showTag: number) => ({
    id: g.id,
    name: g.name,
    tag: g.tag,
    description: g.description,
    role,
    showTag: !!showTag,
    members: countOf(g.id),
    max: GROUP_MAX,
    code: role === 'member' ? null : g.code,
  });
  const GroupInput = z.object({
    name: z.string().trim().min(2).max(32),
    tag: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,4}$/, 'tag'),
    description: z.string().trim().max(160).default(''),
  });

  app.get('/api/groups', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = db.all<GroupRow & { role: string; show_tag: number }>(
      'SELECT g.*, m.role, m.show_tag FROM state.group_members m JOIN state.groups g ON g.id = m.group_id WHERE m.user_id = ? ORDER BY m.joined_at',
      user.id,
    );
    return { groups: rows.map((g) => groupJson(g, g.role, g.show_tag)) };
  });

  app.post('/api/groups', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = GroupInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_group', detail: 'Name 2-32 characters; tag 2-4 letters or numbers.' });
    const plan = planOf(ctx, user, Date.now(), viewsAsFree(req));
    const owned = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM state.group_members WHERE user_id = ? AND role = 'owner'", user.id)?.n ?? 0;
    const joined = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM state.group_members WHERE user_id = ?', user.id)?.n ?? 0;
    if (owned >= LIMITS[plan.plan].owned) return reply.code(402).send({ error: 'group_limit', plan: plan.plan, limit: LIMITS[plan.plan].owned });
    if (joined >= LIMITS[plan.plan].joined) return reply.code(402).send({ error: 'join_limit', plan: plan.plan, limit: LIMITS[plan.plan].joined });
    const now = Date.now();
    const id = db.tx(() => {
      const r = db.run('INSERT INTO state.groups (code, name, tag, description, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', newCode(), body.data.name, body.data.tag, body.data.description, user.id, now);
      const gid = Number(r.lastInsertRowid);
      db.run("INSERT INTO state.group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)", gid, user.id, now);
      return gid;
    });
    return { id };
  });

  /** What the Discord embed and the join page show. No personal data. */
  app.get('/api/public/group/:code', async (req, reply) => {
    const code = String((req.params as { code: string }).code).toUpperCase();
    const g = db.get<GroupRow>('SELECT * FROM state.groups WHERE code = ?', code);
    if (!g) return reply.code(404).send({ error: 'unknown_group' });
    return { name: g.name, tag: g.tag, description: g.description, members: countOf(g.id), max: GROUP_MAX };
  });

  app.post('/api/groups/join', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const now = Date.now();
    if (!joinLimit(`u${user.id}`, now)) return reply.code(429).send({ error: 'slow_down' });
    const body = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_code' });
    const g = db.get<GroupRow>('SELECT * FROM state.groups WHERE code = ?', body.data.code);
    if (!g) return reply.code(404).send({ error: 'unknown_group' });
    if (memberOf(g.id, user.id)) return { id: g.id, already: true };
    const plan = planOf(ctx, user, now, viewsAsFree(req));
    const joined = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM state.group_members WHERE user_id = ?', user.id)?.n ?? 0;
    if (joined >= LIMITS[plan.plan].joined) return reply.code(402).send({ error: 'join_limit', plan: plan.plan, limit: LIMITS[plan.plan].joined });
    const full = db.tx(() => {
      if (countOf(g.id) >= GROUP_MAX) return true;
      db.run("INSERT INTO state.group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", g.id, user.id, now);
      return false;
    });
    if (full) return reply.code(409).send({ error: 'group_full', max: GROUP_MAX });
    return { id: g.id };
  });

  app.get('/api/groups/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    const { g, m } = mine(id, user.id);
    if (!g || !m) return reply.code(404).send({ error: 'unknown_group' });
    const now = Date.now();
    const hidden = privateUsers(ctx);
    const members = db.all<{ user_id: number; role: string; joined_at: number }>('SELECT user_id, role, joined_at FROM state.group_members WHERE group_id = ? ORDER BY joined_at', id).map((r) => {
      const u = ctx.auth.userById(r.user_id);
      const shown = !hidden.has(r.user_id) || r.user_id === user.id;
      const ids = stats.accountIds(r.user_id);
      return {
        userId: r.user_id,
        name: u?.name || `user ${r.user_id}`,
        role: r.role,
        joinedAt: r.joined_at,
        hidden: !shown,
        today: shown ? stats.window(ids, 'today', now) : null,
        week: shown ? stats.window(ids, 'week', now) : null,
        all: shown ? stats.window(ids, 'all', now) : null,
      };
    });
    const ids = members.filter((x) => !x.hidden).flatMap((x) => stats.accountIds(x.userId));
    return { group: groupJson(g, m.role, m.show_tag), members, totals: stats.windows(ids, now) };
  });

  app.patch('/api/groups/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    const { g, m } = mine(id, user.id);
    if (!g || !m) return reply.code(404).send({ error: 'unknown_group' });
    if (m.role === 'member') return reply.code(403).send({ error: 'not_allowed' });
    const body = GroupInput.partial().extend({ newCode: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_group' });
    const d = body.data;
    db.run('UPDATE state.groups SET name = ?, tag = ?, description = ?, code = ? WHERE id = ?', d.name ?? g.name, d.tag ?? g.tag, d.description ?? g.description, d.newCode ? newCode() : g.code, id);
    return { ok: true };
  });

  app.put('/api/groups/:id/me', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    const body = z.object({ showTag: z.boolean() }).safeParse(req.body);
    if (!body.success || !memberOf(id, user.id)) return reply.code(400).send({ error: 'bad_request' });
    db.run('UPDATE state.group_members SET show_tag = ? WHERE group_id = ? AND user_id = ?', body.data.showTag ? 1 : 0, id, user.id);
    return { ok: true };
  });

  app.delete('/api/groups/:id/members/:uid', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id: rawId, uid: rawUid } = req.params as { id: string; uid: string };
    const id = Number(rawId);
    const uid = Number(rawUid);
    const { g, m } = mine(id, user.id);
    if (!g || !m) return reply.code(404).send({ error: 'unknown_group' });
    const target = memberOf(id, uid);
    if (!target) return reply.code(404).send({ error: 'not_a_member' });
    const self = uid === user.id;
    if (self && m.role === 'owner') return reply.code(409).send({ error: 'owner_cannot_leave' });
    if (!self && (m.role === 'member' || target.role === 'owner' || (m.role === 'mod' && target.role === 'mod'))) return reply.code(403).send({ error: 'not_allowed' });
    db.run('DELETE FROM state.group_members WHERE group_id = ? AND user_id = ?', id, uid);
    return { ok: true };
  });

  app.put('/api/groups/:id/members/:uid/role', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id: rawId, uid: rawUid } = req.params as { id: string; uid: string };
    const id = Number(rawId);
    const uid = Number(rawUid);
    const { g, m } = mine(id, user.id);
    const body = z.object({ role: z.enum(['mod', 'member']) }).safeParse(req.body);
    if (!g || !m || m.role !== 'owner' || !body.success || uid === user.id || !memberOf(id, uid)) return reply.code(403).send({ error: 'not_allowed' });
    db.run('UPDATE state.group_members SET role = ? WHERE group_id = ? AND user_id = ?', body.data.role, id, uid);
    return { ok: true };
  });

  app.delete('/api/groups/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    const { g, m } = mine(id, user.id);
    if (!g || !m || m.role !== 'owner') return reply.code(403).send({ error: 'not_allowed' });
    db.run('DELETE FROM state.groups WHERE id = ?', id);
    return { ok: true };
  });

  /** Post an invite embed to a Discord channel through a webhook the owner pastes. */
  app.post('/api/groups/:id/discord', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    const { g, m } = mine(id, user.id);
    if (!g || !m || m.role === 'member') return reply.code(403).send({ error: 'not_allowed' });
    const body = z.object({ webhook: z.string().regex(/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_webhook' });
    const link = `${ctx.config.publicUrl}/join/${g.code}`;
    const res = await fetch(body.data.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'Arachne.fyi',
        embeds: [
          {
            title: `Join ${g.name} on Arachne.fyi`,
            url: link,
            description: `${g.description || 'Track your Arachne farming together.'}\n\n**Join:** ${link}\n**Code:** \`${g.code}\``,
            color: 0xe8a13a,
            footer: { text: `[${g.tag}] · up to ${GROUP_MAX} members` },
          },
        ],
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res || !res.ok) return reply.code(502).send({ error: 'discord_failed' });
    return { ok: true };
  });

  // -- the mod asks who else is on Arachne.fyi (badge + tag) -------------------------

  const lookupLimit = limiter(30, 60_000);
  app.post('/api/v1/lookup', async (req, reply) => {
    const now = Date.now();
    const user = ctx.auth.tokenUser(req.headers.authorization, now);
    if (!user) return reply.code(401).send({ error: 'invalid_token' });
    if (!lookupLimit(`u${user.id}`, now)) return reply.code(429).send({ error: 'slow_down' });
    const body = z.object({ names: z.array(z.string().regex(/^\w{1,16}$/)).max(60) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const hidden = privateUsers(ctx);
    const out: Record<string, { tag: string | null }> = {};
    for (const name of body.data.names) {
      const a = db.get<{ user_id: number | null }>('SELECT user_id FROM state.accounts WHERE name = ? COLLATE NOCASE AND user_id IS NOT NULL ORDER BY last_seen DESC LIMIT 1', name);
      if (!a || a.user_id == null || hidden.has(a.user_id)) continue;
      const g = db.get<{ tag: string }>(
        'SELECT g.tag FROM state.group_members m JOIN state.groups g ON g.id = m.group_id WHERE m.user_id = ? AND m.show_tag = 1 ORDER BY m.joined_at LIMIT 1',
        a.user_id,
      );
      out[name] = { tag: g?.tag ?? null };
    }
    return { players: out };
  });

  // -- text files crawlers and researchers look for ---------------------------------

  app.get('/.well-known/security.txt', async (_req, reply) => {
    reply.header('content-type', 'text/plain; charset=utf-8');
    return `Contact: mailto:contact@arachne.fyi\nExpires: 2027-11-17T00:00:00.000Z\nPreferred-Languages: en\nCanonical: ${ctx.config.publicUrl}/.well-known/security.txt\n`;
  });
  app.get('/robots.txt', async (_req, reply) => {
    reply.header('content-type', 'text/plain; charset=utf-8');
    return 'User-agent: *\nDisallow: /api/\nDisallow: /auth/\nDisallow: /overlay/\nAllow: /\n';
  });

  void existsSync;
}
