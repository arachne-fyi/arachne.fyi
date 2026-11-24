import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SCHEMA_VERSION } from '@arachne/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { createContext, type Context } from '../src/context.ts';

export interface Harness {
  ctx: Context;
  app: FastifyInstance;
  dir: string;
  /** Create an allowlisted user and a mod token for them. */
  user(name: string, role?: 'admin' | 'user'): { id: number; token: string };
  batch(token: string, account: Acct, events: unknown[], sentAt?: number): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

export interface Acct {
  uuid: string;
  name: string;
}

export const acct = (name: string): Acct => ({ uuid: randomUUID(), name });
export const eid = () => randomUUID();

export async function harness(dir = mkdtempSync(join(tmpdir(), 'arachne-test-')), overrides: Partial<Config> = {}): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent';
  const config = loadConfig({
    dataDir: dir,
    webDir: '',
    devAuth: true,
    publicUrl: 'http://localhost:8787',
    bazaar: { enabled: false, pollMs: 1e9, url: '' },
    backupDir: join(dir, 'backups'),
    discordWebhookUrl: '',
    ...overrides,
  });
  const ctx = createContext(config);
  const app = await buildApp(ctx);
  let n = 0;
  return {
    ctx,
    app,
    dir,
    user(name, role = 'user') {
      const u = ctx.auth.allow(`10000000000000000${n++}`, role, Date.now(), name);
      return { id: u.id, token: ctx.auth.createToken(u.id, 'test', Date.now()).token };
    },
    async batch(token, account, events, sentAt = Date.now()) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/batch',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          schema: SCHEMA_VERSION,
          account,
          mod: { version: 'test', minecraft: '26.2' },
          sentAt,
          events,
        },
      });
      return { status: res.statusCode, body: res.json() };
    },
    async close() {
      await app.close();
      ctx.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** One complete fight as the mod would report it. Times are ms offsets from `t0`. */
export function fightEvents(t0: number, opts: { damage?: number | null; loot?: [string, number][]; fight?: string } = {}) {
  const fight = opts.fight ?? eid().slice(0, 12);
  const events: any[] = [
    { id: eid(), ts: t0 - 20_000, kind: 'PLACE', item: 'ARACHNE_CRYSTAL', count: 1 },
    { id: eid(), ts: t0, kind: 'SPAWN', fight, tier: 'CRYSTAL', confirmed: true },
    { id: eid(), ts: t0 + 10_000, kind: 'DEATH', fight },
  ];
  if (opts.damage !== null) {
    events.push({ id: eid(), ts: t0 + 10_400, kind: 'DAMAGE', fight, damage: opts.damage ?? 250_000 });
  }
  for (const [item, count] of opts.loot ?? []) {
    events.push({ id: eid(), ts: t0 + 11_000, kind: 'LOOT', item, count, source: 'armor_stand', fight });
  }
  return events;
}
