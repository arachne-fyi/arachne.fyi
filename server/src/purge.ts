import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { User } from './auth.ts';
import type { Context } from './context.ts';
import { audit, putSetting } from './extras.ts';

type RequireUser = (req: FastifyRequest, reply: FastifyReply, admin?: boolean) => User | null;

/**
 * Wipe the farming data, for testing. Only exists when the server was started with
 * ALPHA_MODE=1: without it the route is never registered and the script refuses to run.
 *
 * Normal: every event (NDJSON day files and the index). People, logins, tokens, plans and
 * Bazaar prices stay, so you can log straight back in and farm again.
 * Everything: also accounts, groups, comments, challenges and the anonymous totals.
 */
export function purgeData(ctx: Context, everything: boolean): { files: number } {
  let files = 0;
  for (const name of readdirSync(ctx.events.dir)) {
    if (/^\d{4}-\d{2}-\d{2}\.ndjson(\.gz)?$/.test(name)) {
      rmSync(join(ctx.events.dir, name));
      files++;
    }
  }
  ctx.db.tx(() => {
    for (const t of ['events', 'fights', 'uptime', 'hourly']) ctx.db.run(`DELETE FROM ${t}`);
    if (everything) {
      for (const t of ['accounts', 'groups', 'group_members', 'reactions', 'comments', 'challenges', 'sent']) ctx.db.run(`DELETE FROM state.${t}`);
      putSetting(ctx, 'globalErased', null);
      putSetting(ctx, 'teamGoal', null);
    }
  });
  ctx.stats.dataReplaced();
  return { files };
}

export function registerPurge(app: FastifyInstance, ctx: Context, requireUser: RequireUser): void {
  if (!ctx.config.alphaMode) return; // the route does not exist on a normal server
  app.post('/api/admin/purge', async (req, reply) => {
    const me = requireUser(req, reply, true);
    if (!me) return;
    const body = z.object({ confirm: z.literal('PURGE'), everything: z.boolean().default(false) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'type_purge' });
    const r = purgeData(ctx, body.data.everything);
    audit(ctx, me.id, body.data.everything ? 'purge.everything' : 'purge.events', `${r.files} day files`);
    ctx.hub.publish('ingest', { purged: true });
    return { ok: true, ...r };
  });
}
