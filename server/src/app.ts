import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ITEMS, NPC_PRICES, SCHEMA_VERSION, SUMMON_ITEMS, WINDOWS, itemName, type Window } from '@arachne/shared';
import { SESSION_COOKIE, safeEqual, type User } from './auth.ts';
import type { Context } from './context.ts';
import { IngestError } from './ingest.ts';
import { audit, getSetting, hiddenUsers, postRareDrops, recordAccessRequest, registerExtras, sha256Of } from './extras.ts';
import { PRO_PATHS, grandfather, hasConsent, planOf, privateUsers, registerPlatform, TERMS_VERSION, viewsAsFree } from './platform.ts';
import { registerSecurity } from './security.ts';
import { registerOffline } from './offline.ts';
import { registerFeatures } from './features.ts';
import { registerOg } from './og.ts';
import { registerPurge } from './purge.ts';
import { countBatch, registerFun, todayRank } from './fun.ts';
import { registerSocial } from './social.ts';
import { windowStart } from './stats.ts';

const STATE_COOKIE = 'al_oauth_state';
const JAR_NAME = /^arachne-fyi-[0-9A-Za-z.+_-]+\.jar$/;

/** Tiny fixed-window rate limiter. Enough for a handful of friends; not a DDoS shield. */
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

export async function buildApp(ctx: Context): Promise<FastifyInstance> {
  const { config, auth, stats } = ctx;
  const secure = config.publicUrl.startsWith('https://');
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Behind cloudflared the real client address is in X-Forwarded-For.
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  await app.register(fastifyCookie);
  // Offline dev mode only (no-op otherwise): read only, always signed in.
  registerOffline(app, ctx);
  registerSecurity(app, ctx);
  grandfather(ctx);

  const batchLimit = limiter(120, 60_000);
  const authLimit = limiter(30, 60_000);

  // ---- helpers -----------------------------------------------------------------------

  const sessionUser = (req: FastifyRequest): User | null =>
    auth.sessionUser(req.cookies[SESSION_COOKIE], Date.now());

  /** Cookie-authenticated routes: require a session, and for writes a same-origin request. */
  const requireUser = (req: FastifyRequest, reply: FastifyReply, admin = false): User | null => {
    const user = sessionUser(req);
    if (!user) {
      reply.code(401).send({ error: 'not_logged_in' });
      return null;
    }
    if (req.method !== 'GET') {
      // SameSite=Lax already stops cross-site POSTs; this is a second, explicit check.
      const origin = req.headers.origin;
      if (origin && origin !== config.publicUrl && !(config.devAuth && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
        reply.code(403).send({ error: 'bad_origin' });
        return null;
      }
    }
    if (admin && user.role !== 'admin') {
      reply.code(403).send({ error: 'admin_only' });
      return null;
    }
    // "View as": an admin reading a normal page with ?as=<user id> sees it as that person.
    // Reads only (GET), and never on admin pages.
    const as = Number((req.query as { as?: string } | undefined)?.as);
    if (!admin && req.method === 'GET' && user.role === 'admin' && Number.isInteger(as) && as !== user.id) {
      const target = auth.userById(as);
      if (target) return target;
    }
    return user;
  };

  const setSession = (reply: FastifyReply, userId: number) => {
    const { cookie, expiresAt } = auth.createSession(userId, Date.now());
    reply.setCookie(SESSION_COOKIE, cookie, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      expires: new Date(expiresAt),
    });
  };

  /** Discord serves profile pictures from its CDN by user id and avatar hash. */
  const avatarUrl = (u: User) =>
    u.avatar && /^\d+$/.test(u.discord_id)
      ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=64`
      : null;

  const publicUser = (u: User) => ({
    id: u.id,
    discordId: u.discord_id,
    name: u.name || `user ${u.id}`,
    avatar: avatarUrl(u),
    role: u.role,
    disabled: !!u.disabled,
  });

  const parseWindow = (v: unknown): Window => (WINDOWS.includes(v as Window) ? (v as Window) : 'today');

  // ---- consent and Pro gates -----------------------------------------------------------
  // Anyone logged in has to have accepted the current terms before the API answers, and a
  // few insight pages are Pro only. Both are checked here, on the server, never just in the UI.
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || path.startsWith('/api/public/') || path.startsWith('/api/v1/')) return;
    const user = sessionUser(req);
    if (!user) return;
    if (!/^\/api\/(me$|consent$|me\/delete$|export\/me\.json$)/.test(path) && !hasConsent(ctx, user.id)) {
      return reply.code(428).send({ error: 'consent_required', version: TERMS_VERSION });
    }
    if (PRO_PATHS.has(path) && planOf(ctx, user, Date.now(), viewsAsFree(req)).plan !== 'pro') {
      return reply.code(402).send({ error: 'pro_required', path });
    }
  });

  // ---- health ------------------------------------------------------------------------

  app.get('/healthz', async () => ({ ok: true, time: Date.now(), schema: SCHEMA_VERSION }));

  // ---- mod → server ------------------------------------------------------------------

  app.post('/api/v1/batch', async (req, reply) => {
    const now = Date.now();
    const user = auth.tokenUser(req.headers.authorization, now);
    if (!user) return reply.code(401).send({ error: 'invalid_token' });
    if (!batchLimit(String(user.id), now)) return reply.code(429).send({ error: 'slow_down' });
    try {
      const result = ctx.ingest.handle(user, req.body, now);
      countBatch(result.accepted, result.reply.duplicates, result.reply.rejected.length, now);
      // Where you stand today, for the HUD's "#2 of 5" line.
      (result.reply as Record<string, unknown>).rank = todayRank(ctx, user.id, now);
      // Tell open dashboards something changed; they refetch what they are showing.
      ctx.hub.publish('ingest', { account: result.account, accepted: result.accepted, kinds: result.kinds, at: now });
      if (result.accepted > 0) {
        postRareDrops(ctx, result.account, now);
        ctx.notifier.onIngest(result.account, now);
      }
      return result.reply;
    } catch (err) {
      if (err instanceof IngestError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }
  });

  /** Lets the mod check a freshly pasted token without sending events. */
  app.get('/api/v1/whoami', async (req, reply) => {
    const user = auth.tokenUser(req.headers.authorization, Date.now());
    if (!user) return reply.code(401).send({ error: 'invalid_token' });
    return { user: user.name || `user ${user.id}`, schema: SCHEMA_VERSION };
  });

  // ---- login -------------------------------------------------------------------------

  app.get('/auth/discord', async (req, reply) => {
    if (!config.discord.clientId || !config.discord.clientSecret) {
      return reply.code(503).send({ error: 'discord_not_configured' });
    }
    const state = randomBytes(24).toString('base64url');
    reply.setCookie(STATE_COOKIE, state, { path: '/auth', httpOnly: true, sameSite: 'lax', secure, maxAge: 600 });
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: config.discord.clientId,
      response_type: 'code',
      redirect_uri: `${config.publicUrl}/auth/discord/callback`,
      scope: 'identify',
      state,
    }).toString();
    return reply.redirect(url.toString());
  });

  app.get('/auth/discord/callback', async (req, reply) => {
    const now = Date.now();
    if (!authLimit(req.ip, now)) return reply.code(429).send({ error: 'slow_down' });
    const { code, state } = req.query as { code?: string; state?: string };
    const expected = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/auth' });
    // The state cookie proves this callback belongs to a login this browser started.
    if (!code || !state || !expected || !safeEqual(state, expected)) {
      return reply.redirect('/?login=failed');
    }
    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.discord.clientId,
          client_secret: config.discord.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${config.publicUrl}/auth/discord/callback`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
      const token = (await tokenRes.json()) as { access_token: string; token_type: string };
      const meRes = await fetch('https://discord.com/api/users/@me', {
        headers: { authorization: `${token.token_type} ${token.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!meRes.ok) throw new Error(`profile fetch failed: ${meRes.status}`);
      const me = (await meRes.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };
      // The Discord token is only needed to learn who this is; it is not stored.
      const profile = { id: me.id, name: me.global_name || me.username, avatar: me.avatar ?? null };
      let user = auth.login(profile, now);
      // With open sign-up on, anyone Discord vouches for gets a free account.
      if (!user && getSetting<boolean>(ctx, 'openSignup') && !auth.listUsers().some((u) => u.discord_id === me.id && u.disabled)) {
        auth.allow(me.id, 'user', now, profile.name);
        user = auth.login(profile, now);
      }
      if (!user) {
        req.log.warn({ discordId: me.id }, 'login refused: not on the allowlist');
        // Discord has confirmed who this is, so the admin can let them in from the Admin page.
        recordAccessRequest(ctx, { id: me.id, name: me.global_name || me.username, avatar: me.avatar ?? null }, now);
        return reply.redirect(`/?login=denied&id=${encodeURIComponent(me.id)}`);
      }
      setSession(reply, user.id);
      return reply.redirect('/');
    } catch (err) {
      req.log.error(err, 'discord login failed');
      return reply.redirect('/?login=failed');
    }
  });

  if (config.devAuth) {
    // Local development only (refused at startup on an https PUBLIC_URL).
    app.post('/auth/dev-login', async (req, reply) => {
      const body = z.object({ name: z.string().min(1).max(32).default('dev'), skipConsent: z.boolean().optional() }).parse(req.body ?? {});
      const now = Date.now();
      const discordId = `dev-${body.name.toLowerCase()}`;
      const first = auth.listUsers().length === 0;
      const existing = auth.listUsers().find((u) => u.discord_id === discordId);
      const user = existing ?? auth.allow(discordId, first ? 'admin' : 'user', now, body.name);
      auth.login({ id: discordId, name: body.name, avatar: null }, now);
      // Demo logins accept the terms for you so the demo is usable; the test for the real flow opts out.
      if (!body.skipConsent) {
        ctx.db.run('INSERT OR REPLACE INTO state.consent (user_id, version, accepted_at, age_ok) VALUES (?, ?, ?, 1)', user.id, TERMS_VERSION, now);
      }
      setSession(reply, user.id);
      return { ok: true };
    });
  }

  app.post('/auth/logout', async (req, reply) => {
    auth.destroySession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---- dashboard API -----------------------------------------------------------------

  app.get('/api/me', async (req) => {
    const user = sessionUser(req);
    return {
      user: user ? publicUser(user) : null,
      plan: user ? planOf(ctx, user, Date.now(), viewsAsFree(req)) : null,
      viewingAsFree: viewsAsFree(req),
      consent: user ? { version: TERMS_VERSION, accepted: hasConsent(ctx, user.id) } : null,
      openSignup: !!getSetting<boolean>(ctx, 'openSignup'),
      alphaMode: config.alphaMode,
      devAuth: config.devAuth,
      discord: !!(config.discord.clientId && config.discord.clientSecret),
    };
  });

  app.get('/api/overview', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const now = Date.now();
    const owners = new Map(auth.listUsers().map((u) => [u.id, u.name || `user ${u.id}`]));
    const scope = (req.query as { scope?: string }).scope === 'user' ? stats.accountIds(user.id) : stats.accountIds();
    return {
      serverTime: now,
      insights: ctx.insights.overview(scope, now),
      totals: {
        group: stats.windows(stats.accountIds(), now),
        user: stats.windows(stats.accountIds(user.id), now),
      },
      accounts: stats.accountCards(now, owners),
      online: stats.onlineCount(now),
      pricesUpdatedAt: ctx.prices.updatedAt,
      // Booster Cookie's instant-sell price, for the dashboard's real-money comparison.
      cookieCoins: ctx.prices.latest().find((p) => p.item === 'BOOSTER_COOKIE')?.instant ?? null,
    };
  });

  app.get('/api/series', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const range = (req.query as { range?: string }).range;
    return stats.series(range === '7d' || range === '30d' || range === 'session' ? range : '24h', Date.now());
  });

  app.get('/api/events', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const q = req.query as { limit?: string; account?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    return { events: stats.recentEvents(limit, q.account && /^[0-9a-f]{32}$/.test(q.account) ? q.account : undefined) };
  });

  app.get('/api/fights', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit) || 50, 1), 1000);
    return { fights: stats.recentFights(limit) };
  });

  app.get('/api/loot', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const q = req.query as { window?: string; scope?: string; since?: string; group?: string };
    const now = Date.now();
    let ids = q.scope === 'me' ? stats.accountIds(user.id) : stats.accountIds();
    // `group` (an id): only the members of a group you're in, leaving out anyone who keeps their numbers private.
    const group = Number(q.group);
    if (q.group !== undefined) {
      if (!Number.isInteger(group) || !ctx.db.get('SELECT 1 AS ok FROM state.group_members WHERE group_id = ? AND user_id = ?', group, user.id)) return reply.code(404).send({ error: 'unknown_group' });
      const hidden = privateUsers(ctx);
      ids = ctx.db
        .all<{ user_id: number }>('SELECT user_id FROM state.group_members WHERE group_id = ?', group)
        .filter((r) => !hidden.has(r.user_id) || r.user_id === user.id)
        .flatMap((r) => stats.accountIds(r.user_id));
    }
    // `since` (epoch ms) lets the graphs page match its own 24h / 7d / 30d range.
    const since = Number(q.since);
    const from = Number.isFinite(since) && since > 0 ? since : windowStart(parseWindow(q.window), now);
    return { loot: stats.lootTable(ids, from, Number.MAX_SAFE_INTEGER) };
  });

  app.get('/api/leaderboard', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const window = parseWindow((req.query as { window?: string }).window);
    const hidden = hiddenUsers(ctx);
    const users = auth
      .listUsers()
      .filter((u) => !hidden.has(u.id))
      .map((u) => ({ id: u.id, name: u.name || `user ${u.id}` }));
    // Luck uses all-time drops: a day is too few kills to say anything.
    const rows = stats.leaderboard(window, Date.now(), users).map((r) => {
      let got = 0;
      let want = 0;
      for (const t of ctx.views.dropRates(stats.accountIds(r.userId)).tiers) {
        for (const i of t.items) {
          if (i.wiki == null) continue;
          got += i.fights;
          want += i.wiki * t.kills;
        }
      }
      return { ...r, luck: want >= 5 ? got / want : null };
    });
    return { window, rows };
  });

  app.get('/api/prices', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const latest = new Map(ctx.prices.latest().map((p) => [p.item, p]));
    const ids = [...Object.keys(ITEMS), ...Object.keys(SUMMON_ITEMS)];
    return {
      updatedAt: ctx.prices.updatedAt,
      items: ids.map((id) => ({
        item: id,
        name: itemName(id),
        instant: latest.get(id)?.instant ?? null,
        offer: latest.get(id)?.offer ?? null,
        npc: (NPC_PRICES as Record<string, number>)[id] ?? null,
      })),
      crystalCost: ctx.prices.summon('ARACHNE_CRYSTAL', Date.now()),
    };
  });

  app.patch('/api/accounts/:uuid', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { uuid } = req.params as { uuid: string };
    const patch = z
      .object({ priceMode: z.enum(['INSTANT_SELL', 'SELL_OFFER', 'NPC']).optional(), ironman: z.boolean().optional() })
      .safeParse(req.body);
    if (!patch.success) return reply.code(400).send({ error: 'bad_request' });
    const account = stats.accounts().find((a) => a.uuid === uuid);
    if (!account) return reply.code(404).send({ error: 'not_found' });
    if (account.user_id !== user.id && user.role !== 'admin') return reply.code(403).send({ error: 'not_yours' });
    if (patch.data.priceMode) {
      ctx.db.run('UPDATE state.accounts SET price_mode = ? WHERE uuid = ?', patch.data.priceMode, uuid);
    }
    if (patch.data.ironman !== undefined) {
      ctx.db.run('UPDATE state.accounts SET ironman = ? WHERE uuid = ?', patch.data.ironman ? 1 : 0, uuid);
    }
    stats.invalidate();
    ctx.hub.publish('settings', { account: uuid });
    return { ok: true };
  });

  // ---- mod tokens --------------------------------------------------------------------

  app.get('/api/tokens', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return {
      tokens: auth.listTokens(user.id).map((t) => ({
        id: t.id,
        label: t.label,
        prefix: t.prefix,
        createdAt: t.created_at,
        lastUsedAt: t.last_used_at,
        revokedAt: t.revoked_at,
      })),
      endpoint: config.publicUrl,
    };
  });

  app.post('/api/tokens', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z.object({ label: z.string().trim().min(1).max(40) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'label_required' });
    if (auth.listTokens(user.id).filter((t) => !t.revoked_at).length >= 10) {
      return reply.code(400).send({ error: 'too_many_tokens' });
    }
    // The only time the full token is ever sent anywhere.
    return auth.createToken(user.id, body.data.label, Date.now());
  });

  app.delete('/api/tokens/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const ok = auth.revokeToken(user.id, Number((req.params as { id: string }).id), Date.now());
    return ok ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---- admin -------------------------------------------------------------------------

  app.get('/api/admin/users', async (req, reply) => {
    if (!requireUser(req, reply, true)) return;
    return {
      users: auth.listUsers().map((u) => ({
        ...publicUser(u),
        accounts: stats.accounts(u.id).map((a) => a.name),
        tokens: auth.listTokens(u.id).filter((t) => !t.revoked_at).length,
        lastLoginAt: u.last_login_at ?? null,
        accountInfo: stats.accounts(u.id).map((a) => ({ name: a.name, modVersion: a.mod_version, lastSeen: a.last_seen })),
        tokenInfo: auth
          .listTokens(u.id)
          .filter((t) => !t.revoked_at)
          .map((t) => ({ id: t.id, label: t.label, prefix: t.prefix, lastUsedAt: t.last_used_at })),
      })),
    };
  });

  app.post('/api/admin/users', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const body = z
      .object({ discordId: z.string().regex(/^\d{15,22}$/), role: z.enum(['admin', 'user']).default('user') })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_discord_id' });
    audit(ctx, me.id, 'user.allow', `${body.data.discordId} as ${body.data.role}`);
    return { user: publicUser(auth.allow(body.data.discordId, body.data.role, Date.now())) };
  });

  app.patch('/api/admin/users/:id', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const id = Number((req.params as { id: string }).id);
    const body = z.object({ role: z.enum(['admin', 'user']).optional(), disabled: z.boolean().optional() }).safeParse(req.body);
    if (!body.success || !auth.userById(id)) return reply.code(400).send({ error: 'bad_request' });
    // Guard against an admin locking the last admin (themselves) out.
    if (id === me.id && (body.data.disabled || body.data.role === 'user')) {
      return reply.code(400).send({ error: 'cannot_demote_yourself' });
    }
    auth.updateUser(id, body.data);
    const who = auth.userById(id);
    audit(ctx, me.id, 'user.change', `${who?.name || id}: ${JSON.stringify(body.data)}`);
    return { ok: true };
  });

  // Admin revokes someone's token (a lost PC, a leaked token).
  app.delete('/api/admin/tokens/:id', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const tokenId = Number((req.params as { id: string }).id);
    const owner = ctx.db.get<{ user_id: number; label: string }>('SELECT user_id, label FROM state.tokens WHERE id = ?', tokenId);
    if (!owner || !auth.revokeToken(owner.user_id, tokenId, Date.now(), true)) return reply.code(404).send({ error: 'not_found' });
    audit(ctx, me.id, 'token.revoke', `${owner.label} of ${auth.userById(owner.user_id)?.name ?? owner.user_id}`);
    return { ok: true };
  });

  // ---- live updates ------------------------------------------------------------------

  app.get('/api/stream', (req, reply) => {
    if (!requireUser(req, reply)) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const unsubscribe = ctx.hub.subscribe(send);
    // Proxies (Cloudflare included) drop idle connections; a comment line keeps this one open.
    const beat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(beat);
      unsubscribe();
    });
  });

  // ---- mod jar download --------------------------------------------------------------

  const downloads = join(config.dataDir, 'downloads');
  mkdirSync(downloads, { recursive: true });
  const latestJar = () => {
    const jars = readdirSync(downloads)
      .filter((f) => JAR_NAME.test(f))
      .map((f) => ({ file: f, ...statSync(join(downloads, f)) }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return jars[0] ? { file: jars[0].file, size: jars[0].size, updatedAt: Math.floor(jars[0].mtimeMs) } : null;
  };

  app.get('/api/public/mod', async () => ({ jar: latestJar() }));

  /**
   * Every uploaded build, grouped by Minecraft version, newest first. The Minecraft version
   * comes from the file name: arachne-fyi-<mod version>+<minecraft version>.jar
   * (Fabric's usual naming). Files without "+<version>" are listed under "Other".
   */
  app.get('/api/public/versions', async () => {
    const jars = readdirSync(downloads)
      .filter((f) => JAR_NAME.test(f))
      .map((file) => {
        const stat = statSync(join(downloads, file));
        const [, mod = file, minecraft = 'Other'] = /^arachne-fyi-([^+]+?)(?:\+(.+))?\.jar$/.exec(file) ?? [];
        return { file, mod, minecraft, size: stat.size, uploadedAt: Math.floor(stat.mtimeMs), sha256: sha256Of(join(downloads, file)) };
      })
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
    const groups = new Map<string, typeof jars>();
    for (const jar of jars) groups.set(jar.minecraft, [...(groups.get(jar.minecraft) ?? []), jar]);
    return { versions: [...groups].map(([minecraft, builds]) => ({ minecraft, builds })) };
  });

  await app.register(fastifyStatic, { root: downloads, prefix: '/download/files/', decorateReply: !config.webDir, index: false });
  app.get('/download/latest', async (_req, reply) => {
    const jar = latestJar();
    if (!jar) return reply.code(404).send({ error: 'no_jar_uploaded' });
    return reply.redirect(`/download/files/${encodeURIComponent(jar.file)}`);
  });

  app.addContentTypeParser(
    ['application/java-archive', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );
  app.put('/api/admin/mod-jar/:name', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const { name } = req.params as { name: string };
    const body = req.body as Buffer;
    // A jar is a zip; zips start with "PK".
    if (!JAR_NAME.test(name) || !Buffer.isBuffer(body) || body.length < 100 || body[0] !== 0x50 || body[1] !== 0x4b) {
      return reply.code(400).send({ error: 'expected arachne-fyi-<version>.jar' });
    }
    const tmp = join(downloads, `.upload-${randomBytes(6).toString('hex')}`);
    writeFileSync(tmp, body);
    renameSync(tmp, join(downloads, name));
    audit(ctx, me.id, 'jar.upload', name);
    return { jar: latestJar() };
  });

  registerExtras(app, ctx, requireUser, downloads);
  registerSocial(app, ctx, requireUser, ctx.notifier);
  registerFun(app, ctx, requireUser);
  registerPlatform(app, ctx, requireUser);
  registerFeatures(app, ctx, requireUser);
  registerPurge(app, ctx, requireUser);

  // ---- dashboard + landing page ------------------------------------------------------

  if (config.webDir && existsSync(join(config.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDir, prefix: '/', index: false });
    const isLanding = (req: FastifyRequest) =>
      !!config.landingHost && (req.hostname ?? '').toLowerCase().split(':')[0] === config.landingHost;
    // '/', '/u/:name', '/join/:code' and '/groups/:id' get link-preview tags written in (og.ts).
    registerOg(app, ctx, config.webDir);
    // Public download page, on both hostnames: arachne.fyi/download and app.arachne.fyi/download.
    app.get('/download', (_req, reply) => reply.sendFile('download.html', config.webDir));
    // Public help and status pages, on both hostnames.
    app.get('/help', (_req, reply) => reply.sendFile('help.html', config.webDir));
    app.get('/status', (_req, reply) => reply.sendFile('status.html', config.webDir));
    app.get('/tools', (_req, reply) => reply.sendFile('tools.html', config.webDir));
    for (const page of ['terms', 'privacy', 'cookies', 'changelog']) {
      app.get(`/${page}`, (_req, reply) => reply.sendFile(`${page}.html`, config.webDir));
    }
    // Sign-in page. The login cookie belongs to the dashboard host, so the landing host sends people there.
    app.get('/signin', (req, reply) => (isLanding(req) ? reply.redirect(`${config.publicUrl}/signin`) : reply.sendFile('signin.html', config.webDir)));
    // Stream overlay (a secret key in the address) and opt-in public profiles.
    app.get('/overlay/:key', (_req, reply) => reply.sendFile('overlay.html', config.webDir));
    // Client-side routes (/tokens, /leaderboard, ...) all load the single-page app.
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/auth/') || req.url.startsWith('/download/') || req.url.startsWith('/assets/')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (isLanding(req)) return reply.redirect('/');
      return reply.sendFile('index.html', config.webDir);
    });
  }

  return app;
}
