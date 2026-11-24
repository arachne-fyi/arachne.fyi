import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TITLES, isUnlocked, itemName, rankTitleFor, titleById, type Totals } from '@arachne/shared';
import type { User } from './auth.ts';
import type { Context } from './context.ts';
import { priceColumn } from './stats.ts';

type RequireUser = (req: FastifyRequest, reply: FastifyReply, admin?: boolean) => User | null;

/** Everything a public profile can show. The owner turns each one on or off. */
export const PUBLIC_FIELDS = ['title', 'profit', 'kills', 'perHour', 'crystals', 'callings', 'time', 'bestDrop', 'lastSeen', 'badges', 'accounts'] as const;
export type PublicField = (typeof PUBLIC_FIELDS)[number];
/** What was public before fields could be chosen, plus the title. Account names stay private until asked. */
const DEFAULT_PUBLIC: PublicField[] = ['title', 'profit', 'kills', 'perHour', 'crystals', 'badges'];

export interface Prefs {
  armour: 'ITEM' | 'ESSENCE';
  title: string | null;
  public: PublicField[];
}

export function prefs(ctx: Context, userId: number): Prefs {
  const row = ctx.db.get<{ armour: 'ITEM' | 'ESSENCE'; title: string | null; public: string | null }>(
    'SELECT armour, title, public FROM state.user_prefs WHERE user_id = ?',
    userId,
  );
  const pub = row?.public ? (JSON.parse(row.public) as string[]).filter((f): f is PublicField => (PUBLIC_FIELDS as readonly string[]).includes(f)) : DEFAULT_PUBLIC;
  return { armour: row?.armour ?? 'ITEM', title: row?.title ?? null, public: pub };
}

function savePrefs(ctx: Context, userId: number, p: Prefs): void {
  ctx.db.run(
    `INSERT INTO state.user_prefs (user_id, armour, title, public) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET armour = excluded.armour, title = excluded.title, public = excluded.public`,
    userId,
    p.armour,
    p.title,
    JSON.stringify(p.public),
  );
}

/** Titles with whether this person has unlocked each, worked out on the server. */
export function titlesFor(ctx: Context, userId: number) {
  const ids = ctx.stats.accountIds(userId);
  const kills = ctx.stats.totals(ids, 0, Number.MAX_SAFE_INTEGER).kills;
  const badges = new Set(ctx.progress.badges(ids, Date.now()).filter((b) => b.earned).map((b) => b.id));
  return { kills, list: TITLES.map((t) => ({ ...t, unlocked: isUnlocked(t, { kills, badges }) })) };
}

/** The title to show: the chosen one if it is still unlocked, otherwise the kill-rank title. */
export function shownTitle(ctx: Context, userId: number): string {
  const { kills, list } = titlesFor(ctx, userId);
  const chosen = list.find((t) => t.id === prefs(ctx, userId).title && t.unlocked);
  return (chosen ?? rankTitleFor(kills)).name;
}

// ---- public profile -----------------------------------------------------------------

function bestDrop(ctx: Context, uuids: string[]) {
  let best: { item: string; name: string; value: number; ts: number } | null = null;
  for (const a of ctx.stats.accounts().filter((x) => uuids.includes(x.uuid))) {
    const r = ctx.db.get<{ item: string; v: number; ts: number }>(
      `SELECT item, count * ${priceColumn(a)} AS v, ts FROM events WHERE account = ? AND kind = 'LOOT' ORDER BY v DESC LIMIT 1`,
      a.uuid,
    );
    if (r && (!best || r.v > best.value)) best = { item: r.item, name: itemName(r.item), value: r.v, ts: r.ts };
  }
  return best;
}

/** The numbers for one set of accounts, keeping only the fields the owner made public. */
function numbers(ctx: Context, uuids: string[], lastSeen: number, show: Set<PublicField>) {
  const t: Totals = ctx.stats.totals(uuids, 0, Number.MAX_SAFE_INTEGER);
  return {
    profit: show.has('profit') ? t.profit : undefined,
    kills: show.has('kills') ? t.kills : undefined,
    perHour: show.has('perHour') ? (t.uptimeMs > 0 ? t.profitPerClientHour : null) : undefined,
    crystals: show.has('crystals') ? t.crystals : undefined,
    callings: show.has('callings') ? t.callings : undefined,
    uptimeMs: show.has('time') ? t.uptimeMs : undefined,
    bestDrop: show.has('bestDrop') ? bestDrop(ctx, uuids) : undefined,
    lastSeen: show.has('lastSeen') ? lastSeen : undefined,
  };
}

export type PublicProfile = ReturnType<typeof publicProfile>;

/**
 * A profile someone chose to make public. Fields they turned off are left out of the
 * answer entirely (not sent as null), so nothing private reaches the page or a link preview.
 */
export function publicProfile(ctx: Context, user: User) {
  const p = prefs(ctx, user.id);
  const show = new Set(p.public);
  const accounts = ctx.stats.accounts(user.id);
  const uuids = accounts.map((a) => a.uuid);
  const last = Math.max(0, ...accounts.map((a) => a.last_seen));
  return {
    name: user.name,
    title: show.has('title') ? shownTitle(ctx, user.id) : undefined,
    total: numbers(ctx, uuids, last, show),
    badges: show.has('badges') ? ctx.progress.badges(uuids, Date.now()).filter((b) => b.earned).map((b) => b.name) : undefined,
    accounts: show.has('accounts') ? accounts.map((a) => ({ name: a.name, uuid: a.uuid, ...numbers(ctx, [a.uuid], a.last_seen, show) })) : undefined,
  };
}

// ---- routes -------------------------------------------------------------------------

const short = (v: number) =>
  Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v));

export function registerFeatures(app: FastifyInstance, ctx: Context, requireUser: RequireUser): void {
  app.get('/api/me/prefs', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { list } = titlesFor(ctx, user.id);
    return { ...prefs(ctx, user.id), fields: PUBLIC_FIELDS, titles: list, shownTitle: shownTitle(ctx, user.id) };
  });

  app.put('/api/me/prefs', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        armour: z.enum(['ITEM', 'ESSENCE']).optional(),
        // Only ids from the catalogue: nothing typed by a person is ever stored or shown.
        title: z.string().regex(/^[a-z0-9-]{1,32}$/).nullable().optional(),
        public: z.array(z.enum(PUBLIC_FIELDS)).max(PUBLIC_FIELDS.length).optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const next = { ...prefs(ctx, user.id) };
    if (body.data.armour) next.armour = body.data.armour;
    if (body.data.title !== undefined) {
      if (body.data.title !== null) {
        const t = titleById(body.data.title);
        if (!t) return reply.code(400).send({ error: 'unknown_title' });
        if (!titlesFor(ctx, user.id).list.find((x) => x.id === t.id)?.unlocked) return reply.code(403).send({ error: 'title_locked' });
      }
      next.title = body.data.title;
    }
    if (body.data.public) next.public = [...new Set(body.data.public)];
    savePrefs(ctx, user.id, next);
    // Totals are cached for a few seconds; a new armour rule must show at once.
    if (body.data.armour) ctx.stats.invalidate();
    return { ok: true };
  });

  /**
   * "Post to Discord": a real embed, sent through the webhook saved in your notification
   * settings. A webhook can carry embeds; a copied message cannot, which is why the old
   * button only ever produced plain text.
   */
  app.post('/api/me/share/discord', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z.object({ window: z.enum(['today', 'week', 'all']).default('today') }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const hook = ctx.notifier.settings(user.id).webhook;
    if (!hook) return reply.code(400).send({ error: 'no_webhook' });
    const embed = shareEmbed(ctx, user, body.data.window, Date.now());
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Arachne.fyi', embeds: [embed], allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res || !res.ok) return reply.code(502).send({ error: 'discord_failed' });
    return { ok: true };
  });
}

const WINDOW_WORDS = { today: 'today', week: 'the last 7 days', all: 'all time' } as const;

/** The embed: orange edge, three number fields, a Minecraft head, arachne.fyi underneath. */
export function shareEmbed(ctx: Context, user: User, window: 'today' | 'week' | 'all', now: number) {
  const accounts = ctx.stats.accounts(user.id);
  const t = ctx.stats.window(accounts.map((a) => a.uuid), window, now);
  const head = accounts.sort((a, b) => b.last_seen - a.last_seen)[0];
  const site = ctx.config.publicUrl;
  return {
    title: `${user.name}'s Arachne ${window === 'all' ? 'totals' : window === 'today' ? 'today' : 'week'}`,
    url: site,
    description: `${shownTitle(ctx, user.id)} · ${WINDOW_WORDS[window]}`,
    color: 0xffa62b,
    fields: [
      { name: 'Profit', value: `${short(t.profit)} coins`, inline: true },
      { name: 'Kills', value: t.kills.toLocaleString('en-GB'), inline: true },
      { name: 'Per hour', value: t.wallUptimeMs > 0 ? short(t.profitPerWallHour) : '-', inline: true },
    ],
    thumbnail: head ? { url: `https://mc-heads.net/avatar/${head.uuid}/64` } : undefined,
    footer: { text: 'arachne.fyi' },
    timestamp: new Date(now).toISOString(),
  };
}
