import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { itemName, union } from '@arachne/shared';
import type { User } from './auth.ts';
import type { Context } from './context.ts';
import { hiddenUsers } from './extras.ts';
import { RARE_DROPS } from './insights.ts';
import { weekStart } from './progress.ts';
import { priceColumn } from './stats.ts';

type RequireUser = (req: FastifyRequest, reply: FastifyReply, admin?: boolean) => User | null;

const DAY = 86_400_000;
const REACTIONS = ['fire', 'clap', 'cry', 'spider'] as const;
/** Only real Discord webhooks: anything else would let the server be pointed at other sites. */
const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,100}$/;

export const NotifySettings = z.object({
  webhook: z.string().regex(WEBHOOK).or(z.literal('')).default(''),
  /** Post my drops worth at least this much (rare drops are always posted). 0 = only rare. */
  minCoins: z.number().min(0).max(1e12).default(0),
  rare: z.boolean().default(true),
  recap: z.boolean().default(true),
  dry: z.boolean().default(true),
  offline: z.boolean().default(false),
  digest: z.boolean().default(true),
  /** Quiet hours, UTC, e.g. 23 to 7. Equal numbers mean no quiet hours. */
  quietFrom: z.number().int().min(0).max(23).default(0),
  quietTo: z.number().int().min(0).max(23).default(0),
});
export type NotifySettings = z.infer<typeof NotifySettings>;

const shortCoins = (v: number) =>
  Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v));
const dur = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

/** Per-person Discord messages: their drops, session recaps, dry streaks, a weekly digest. */
export class Notifier {
  constructor(private readonly ctx: Context) {}

  settings(userId: number): NotifySettings {
    const row = this.ctx.db.get<{ json: string }>('SELECT json FROM state.user_settings WHERE user_id = ?', userId);
    const parsed = NotifySettings.safeParse(row ? JSON.parse(row.json) : {});
    return parsed.success ? parsed.data : NotifySettings.parse({});
  }

  save(userId: number, s: NotifySettings): void {
    this.ctx.db.run('INSERT OR REPLACE INTO state.user_settings (user_id, json) VALUES (?, ?)', userId, JSON.stringify(s));
  }

  /** Somewhere to send to: a webhook or at least one browser. */
  private reachable(userId: number, s: NotifySettings): boolean {
    return !!s.webhook || this.ctx.push.count(userId) > 0;
  }

  /** True the first time `key` is seen; remembered across restarts. */
  private once(key: string, now: number): boolean {
    return this.ctx.db.run('INSERT OR IGNORE INTO state.sent (key, ts) VALUES (?, ?)', key, now).changes > 0;
  }

  private quiet(s: NotifySettings, now: number): boolean {
    if (s.quietFrom === s.quietTo) return false;
    const h = new Date(now).getUTCHours();
    return s.quietFrom < s.quietTo ? h >= s.quietFrom && h < s.quietTo : h >= s.quietFrom || h < s.quietTo;
  }

  /**
   * Send `text` to one person: their browsers (push) and their Discord webhook, unless it is
   * their quiet hours.
   */
  send(userId: number, text: string, now: number, ignoreQuiet = false): void {
    const s = this.settings(userId);
    if (!ignoreQuiet && this.quiet(s, now)) return;
    // Push has no markdown: drop Discord's ** bold markers.
    this.ctx.push.send(userId, 'Arachne.fyi', text.replace(/\*\*/g, ''));
    if (!s.webhook) return;
    void fetch(s.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Arachne.fyi', content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      /* their webhook is gone or Discord is down; nothing to do */
    });
  }

  /** After a batch: the owner's drops and dry-streak milestones. */
  onIngest(account: string, receivedAt: number): void {
    const a = this.ctx.stats.accounts().find((x) => x.uuid === account);
    if (!a?.user_id) return;
    const s = this.settings(a.user_id);
    if (!this.reachable(a.user_id, s)) return;
    const col = priceColumn(a);
    const rare = new Set<string>(RARE_DROPS);
    const drops = this.ctx.db
      .all<{ item: string; count: number; v: number }>(
        `SELECT item, count, count * ${col} AS v FROM events WHERE account = ? AND received_at = ? AND kind = 'LOOT'`,
        account,
        receivedAt,
      )
      .filter((r) => (s.rare && rare.has(r.item)) || (s.minCoins > 0 && r.v >= s.minCoins));
    if (drops.length > 0) {
      this.send(a.user_id, drops.map((r) => `**${a.name}**: ${r.count}x ${itemName(r.item)} (${shortCoins(r.v)})`).join('\n'), receivedAt);
    }
    if (s.dry) {
      for (const d of this.ctx.insights.dryStreaks(this.ctx.stats.accountIds(a.user_id))) {
        const step = d.item === 'DARK_QUEENS_SOUL_DROP' ? 100 : 250;
        const mark = Math.floor(d.current / step) * step;
        if (mark > 0 && this.once(`dry:${a.user_id}:${d.item}:${d.lastAt ?? 0}:${mark}`, receivedAt)) {
          this.send(a.user_id, `${mark} kills without a ${d.name}. It has to drop soon.`, receivedAt);
        }
      }
    }
  }

  /** Once a minute: session recaps, the mod going quiet mid-fight, and Monday's digest. */
  tick(now: number): void {
    const { stats, db } = this.ctx;
    for (const a of stats.accounts()) {
      if (!a.user_id) continue;
      const s = this.settings(a.user_id);
      if (!this.reachable(a.user_id, s)) continue;

      if (s.recap) {
        // A session = uptime with breaks under 30 minutes. Recap once it has been over for 10.
        const segs = union([stats.segments(a.uuid, now - 2 * DAY, now)]);
        const last = segs.at(-1);
        if (last && now - last.end > 10 * 60_000 && now - last.end < 60 * 60_000) {
          let start = last.start;
          for (let i = segs.length - 2; i >= 0 && start - segs[i]!.end < 30 * 60_000; i--) start = segs[i]!.start;
          if (this.once(`recap:${a.uuid}:${start}`, now)) {
            const t = stats.totals([a.uuid], start, last.end + 5 * 60_000);
            if (t.kills > 0) {
              this.send(
                a.user_id,
                `**${a.name}** session over: ${dur(last.end - start)}, ${t.kills} kills, ${shortCoins(t.profit)} profit (${shortCoins(t.profitPerClientHour)}/h).`,
                now,
              );
            }
          }
        }
      }

      if (s.offline && a.state_json) {
        const st = JSON.parse(a.state_json) as { inArea?: boolean; fighting?: boolean };
        const quietFor = now - a.last_seen;
        if (st.inArea && quietFor > 3 * 60_000 && quietFor < 30 * 60_000 && this.once(`offline:${a.uuid}:${a.last_seen}`, now)) {
          this.send(a.user_id, `**${a.name}** stopped reporting in the Sanctuary ${dur(quietFor)} ago. Game closed or crashed?`, now, true);
        }
      }
    }

    // Monday after 09:00 UTC: last week, per person.
    const thisWeek = weekStart(now);
    if (now - thisWeek >= 9 * 3_600_000) {
      for (const u of this.ctx.auth.listUsers()) {
        const s = this.settings(u.id);
        if (!this.reachable(u.id, s) || !s.digest || !this.once(`digest:${u.id}:${thisWeek}`, now)) continue;
        const ids = stats.accountIds(u.id);
        const t = stats.totals(ids, thisWeek - 7 * DAY, thisWeek);
        if (t.kills === 0) continue;
        this.send(
          u.id,
          `**Your Arachne week**: ${shortCoins(t.profit)} profit, ${t.kills} kills, ${t.crystals} crystals, ${dur(t.uptimeMs)} farming.`,
          now,
          true,
        );
      }
    }
    // Keep the "already sent" list small.
    db.run('DELETE FROM state.sent WHERE ts < ?', now - 30 * DAY);
  }
}

export function registerSocial(app: FastifyInstance, ctx: Context, requireUser: RequireUser, notifier: Notifier): void {
  const { db, stats, auth } = ctx;
  const names = () => new Map(auth.listUsers().map((u) => [u.id, u.name || `user ${u.id}`]));
  const scopeIds = (user: User, scope: unknown) => (scope === 'me' ? stats.accountIds(user.id) : stats.accountIds());

  app.get('/api/progress', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const ids = scopeIds(user, (req.query as { scope?: string }).scope);
    const now = Date.now();
    return {
      streak: ctx.progress.streak(ids, now),
      quests: ctx.progress.quests(ids, now),
      badges: ctx.progress.badges(ids, now),
      collection: ctx.progress.collection(ids),
    };
  });

  // ---- team goal ------------------------------------------------------------------

  app.get('/api/team-goal', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const row = db.get<{ value: string }>("SELECT value FROM state.settings WHERE key = 'teamGoal'");
    const goal = row ? (JSON.parse(row.value) as number) : 0;
    const now = Date.now();
    const from = weekStart(now);
    return { goal, from, profit: goal > 0 ? stats.totals(stats.accountIds(), from, Number.MAX_SAFE_INTEGER).profit : 0 };
  });
  app.put('/api/admin/team-goal', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const body = z.object({ goal: z.number().min(0).max(1e13) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    db.run("INSERT OR REPLACE INTO state.settings (key, value) VALUES ('teamGoal', ?)", JSON.stringify(body.data.goal));
    db.run('INSERT INTO state.audit (ts, user_id, action, detail) VALUES (?, ?, ?, ?)', Date.now(), me.id, 'teamgoal.set', String(body.data.goal));
    ctx.hub.publish('settings', { teamGoal: true });
    return { ok: true };
  });

  // ---- rare-drop feed, reactions, comments -----------------------------------------

  app.get('/api/feed', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const now = Date.now();
    const from = now - 30 * DAY;
    const who = names();
    const rows: { id: string; ts: number; account: string; accountName: string; owner: string; item: string; name: string; count: number; value: number }[] = [];
    for (const a of stats.accounts()) {
      const col = priceColumn(a);
      for (const r of db.all<{ id: string; ts: number; item: string; count: number; v: number }>(
        `SELECT id, ts, item, count, count * ${col} AS v FROM events WHERE account = ? AND kind = 'LOOT' AND ts >= ?
         AND (item IN (${RARE_DROPS.map(() => '?').join(',')}) OR count * ${col} >= ?) ORDER BY ts DESC LIMIT 200`,
        a.uuid,
        from,
        ...RARE_DROPS,
        ctx.config.rareDropMinCoins,
      )) {
        rows.push({ id: r.id, ts: r.ts, account: a.uuid, accountName: a.name, owner: a.user_id != null ? (who.get(a.user_id) ?? '') : '', item: r.item, name: itemName(r.item), count: r.count, value: r.v });
      }
    }
    rows.sort((x, y) => y.ts - x.ts);
    const page = rows.slice(0, 100);
    const ids = page.map((r) => r.id);
    const reactions = ids.length
      ? db.all<{ event_id: string; user_id: number; kind: string }>(
          `SELECT event_id, user_id, kind FROM state.reactions WHERE event_id IN (${ids.map(() => '?').join(',')})`,
          ...ids,
        )
      : [];
    const comments = ids.length
      ? db.all<{ target: string; n: number }>(
          `SELECT target, COUNT(*) AS n FROM state.comments WHERE target IN (${ids.map(() => '?').join(',')}) GROUP BY target`,
          ...ids,
        )
      : [];
    return {
      dropOfTheWeek: ctx.progress.dropOfTheWeek(now),
      drops: page.map((r) => ({
        ...r,
        reactions: Object.fromEntries(REACTIONS.map((k) => [k, reactions.filter((x) => x.event_id === r.id && x.kind === k).length])),
        mine: reactions.filter((x) => x.event_id === r.id && x.user_id === user.id).map((x) => x.kind),
        comments: comments.find((c) => c.target === r.id)?.n ?? 0,
      })),
    };
  });

  app.post('/api/reactions', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z.object({ eventId: z.string().max(64), kind: z.enum(REACTIONS) }).safeParse(req.body);
    if (!body.success || !db.get('SELECT 1 FROM events WHERE id = ?', body.data.eventId)) return reply.code(400).send({ error: 'bad_request' });
    const del = db.run('DELETE FROM state.reactions WHERE event_id = ? AND user_id = ? AND kind = ?', body.data.eventId, user.id, body.data.kind);
    if (del.changes === 0) {
      db.run('INSERT INTO state.reactions (event_id, user_id, kind, ts) VALUES (?, ?, ?, ?)', body.data.eventId, user.id, body.data.kind, Date.now());
    }
    ctx.hub.publish('settings', { reactions: true });
    return { ok: true, on: del.changes === 0 };
  });

  app.get('/api/comments', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const target = String((req.query as { target?: string }).target ?? '');
    const who = names();
    return {
      comments: db
        .all<{ id: number; user_id: number; text: string; ts: number }>('SELECT id, user_id, text, ts FROM state.comments WHERE target = ? ORDER BY ts', target)
        .map((c) => ({ id: c.id, userId: c.user_id, by: who.get(c.user_id) ?? 'someone', text: c.text, ts: c.ts })),
    };
  });
  app.post('/api/comments', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z.object({ target: z.string().min(4).max(120), text: z.string().trim().min(1).max(280) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    db.run('INSERT INTO state.comments (target, user_id, text, ts) VALUES (?, ?, ?, ?)', body.data.target, user.id, body.data.text, Date.now());
    ctx.hub.publish('settings', { comments: true });
    return { ok: true };
  });
  app.delete('/api/comments/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    const res =
      user.role === 'admin'
        ? db.run('DELETE FROM state.comments WHERE id = ?', id)
        : db.run('DELETE FROM state.comments WHERE id = ? AND user_id = ?', id, user.id);
    return res.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---- challenges -------------------------------------------------------------------

  app.get('/api/challenges', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const now = Date.now();
    const who = names();
    const hidden = hiddenUsers(ctx);
    const users = auth.listUsers().filter((u) => !u.disabled && !hidden.has(u.id));
    return {
      challenges: db
        .all<{ id: number; title: string; metric: 'kills' | 'profit' | 'crystals'; start_ts: number; end_ts: number; created_by: number }>(
          'SELECT * FROM state.challenges WHERE end_ts > ? ORDER BY start_ts DESC LIMIT 20',
          now - 14 * DAY,
        )
        .map((c) => ({
          id: c.id,
          title: c.title,
          metric: c.metric,
          start: c.start_ts,
          end: c.end_ts,
          by: who.get(c.created_by) ?? 'someone',
          createdBy: c.created_by,
          standings: users
            .map((u) => {
              const ids = stats.accountIds(u.id);
              const t = ids.length ? stats.totals(ids, c.start_ts, Math.min(c.end_ts, now + 1)) : null;
              return { name: u.name || `user ${u.id}`, value: t ? t[c.metric] : 0 };
            })
            .filter((s) => s.value !== 0)
            .sort((a, b) => b.value - a.value),
        })),
    };
  });
  app.post('/api/challenges', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        title: z.string().trim().min(1).max(60),
        metric: z.enum(['kills', 'profit', 'crystals']),
        start: z.number().int(),
        hours: z.number().int().min(1).max(24 * 31),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const { title, metric, start, hours } = body.data;
    db.run(
      'INSERT INTO state.challenges (title, metric, start_ts, end_ts, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      title,
      metric,
      start,
      start + hours * 3_600_000,
      user.id,
      Date.now(),
    );
    return { ok: true };
  });
  app.delete('/api/challenges/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    const res =
      user.role === 'admin'
        ? db.run('DELETE FROM state.challenges WHERE id = ?', id)
        : db.run('DELETE FROM state.challenges WHERE id = ? AND created_by = ?', id, user.id);
    return res.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---- your notification settings -----------------------------------------------------

  app.get('/api/me/notify', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const s = notifier.settings(user.id);
    // The webhook URL is a secret of sorts: only say whether one is set, and its ending.
    return { ...s, webhook: s.webhook ? `…${s.webhook.slice(-6)}` : '', hasWebhook: !!s.webhook };
  });
  app.put('/api/me/notify', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const current = notifier.settings(user.id);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    // An unchanged masked URL ("…abc123") keeps the saved one.
    const webhook = typeof raw.webhook === 'string' && raw.webhook.startsWith('…') ? current.webhook : raw.webhook;
    const parsed = NotifySettings.safeParse({ ...current, ...raw, webhook });
    if (!parsed.success) return reply.code(400).send({ error: 'bad_webhook' });
    notifier.save(user.id, parsed.data);
    return { ok: true };
  });
  app.get('/api/push/key', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { publicKey: ctx.push.publicKey, ready: ctx.push.ready, subscriptions: ctx.push.count(user.id) };
  });
  app.post('/api/push/subscribe', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) })
      .safeParse(req.body);
    if (!body.success || !body.data.endpoint.startsWith('https://')) return reply.code(400).send({ error: 'bad_subscription' });
    ctx.push.subscribe(user.id, body.data, Date.now());
    return { ok: true };
  });
  app.post('/api/push/unsubscribe', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = z.object({ endpoint: z.string().max(1000) }).safeParse(req.body);
    if (body.success) ctx.db.run('DELETE FROM state.push_subs WHERE endpoint = ? AND user_id = ?', body.data.endpoint, user.id);
    return { ok: true };
  });

  app.post('/api/me/notify/test', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!notifier.settings(user.id).webhook && ctx.push.count(user.id) === 0) return reply.code(400).send({ error: 'no_webhook' });
    notifier.send(user.id, 'Test from Arachne.fyi: notifications work.', Date.now(), true);
    return { ok: true };
  });
}
