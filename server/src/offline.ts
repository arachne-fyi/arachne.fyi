/*
 * Offline dev mode (OFFLINE=1, started by start-offline.bat).
 *
 * A local, read-only copy of the site for working on the website:
 *  - runs on a throwaway copy of the saved data (data-snapshot\ if it exists, else data\),
 *    made in the system temp folder on every start, so the real files are only ever read
 *  - signs you in automatically (the first admin, or OFFLINE_USER), no Discord
 *  - refuses every write request (anything that is not GET/HEAD/OPTIONS)
 *  - blocks all outgoing network calls (Discord, Hypixel, webhooks, push), and turns off the
 *    bazaar poller, notifications and backups
 * Normal mode never loads any of this: everything checks isOffline() first.
 */
import http from 'node:http';
import https from 'node:https';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE, type User } from './auth.ts';
import type { Config } from './config.ts';
import type { Context } from './context.ts';
import { TERMS_VERSION } from './platform.ts';

const flag = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';
export const isOffline = () => flag(process.env.OFFLINE);

let state: { cookie: string; user: User; source: string; copy: string } | null = null;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const isLocalUrl = (u: string | URL) => {
  try {
    return LOCAL_HOSTS.has(new URL(String(u)).hostname);
  } catch {
    return false;
  }
};

/** Make every outgoing request to a non-local host fail, before anything else loads. */
export function blockNetwork(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isLocalUrl(url)) throw new TypeError(`offline mode: blocked request to ${url}`);
    return realFetch(input, init);
  }) as typeof fetch;
  // web-push and other CommonJS libraries use http(s).request directly.
  for (const mod of [http, https]) {
    for (const name of ['request', 'get'] as const) {
      const real = mod[name] as (...args: unknown[]) => unknown;
      (mod as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        const a = args[0] as string | URL | { hostname?: string; host?: string };
        const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a?.hostname ?? a?.host ?? 'localhost');
        if (!LOCAL_HOSTS.has(String(host).replace(/:\d+$/, ''))) throw new Error(`offline mode: blocked request to ${host}`);
        return real.apply(mod, args);
      };
    }
  }
}

/** Copy the saved data to a temp folder and point the config at it. Nothing is written to the source. */
export function offlineConfig(config: Config): Config {
  const parent = dirname(config.dataDir);
  const wanted = process.env.OFFLINE_DATA ? resolve(parent, process.env.OFFLINE_DATA) : '';
  const snapshot = join(parent, 'data-snapshot');
  const source = wanted || (existsSync(snapshot) ? snapshot : config.dataDir);
  if (!existsSync(join(source, 'state.db'))) throw new Error(`Offline mode: no state.db in ${source}`);

  // Old copies from earlier runs (only ever inside our own temp folder).
  const root = join(tmpdir(), 'arachne-offline');
  mkdirSync(root, { recursive: true });
  for (const old of readdirSync(root)) {
    try {
      rmSync(join(root, old), { recursive: true, force: true });
    } catch {
      /* still open by another offline server: leave it */
    }
  }
  const copy = join(root, `run-${Date.now()}`);
  cpSync(source, copy, {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      // No backups or logs; no -shm (SQLite rebuilds it from the -wal on open).
      return !(name === 'backups' || name.endsWith('.log') || name.endsWith('-shm'));
    },
  });
  const clean = () => {
    try {
      rmSync(copy, { recursive: true, force: true });
    } catch {
      /* removed next start */
    }
  };
  process.once('exit', clean);

  state = { cookie: '', user: null as unknown as User, source, copy };
  return {
    ...config,
    host: '127.0.0.1',
    dataDir: copy,
    backupDir: join(copy, 'backups'),
    discord: { clientId: '', clientSecret: '' },
    adminDiscordIds: [],
    devAuth: false,
    bazaar: { ...config.bazaar, enabled: false },
    discordWebhookUrl: '',
    alphaMode: false,
  };
}

/** Pick the user to sign in as, accept the terms for them, and make one session. All in the copy. */
export function prepareOffline(ctx: Context): void {
  if (!state) return;
  const now = Date.now();
  // No Discord pictures offline: the dashboard falls back to letter avatars.
  ctx.db.run('UPDATE state.users SET avatar = NULL');
  try {
    ctx.db.run('UPDATE state.access_requests SET avatar = NULL');
  } catch {
    /* table not there in older data */
  }
  ctx.push.ready = false;

  const users = ctx.auth.listUsers().filter((u) => !u.disabled);
  const want = (process.env.OFFLINE_USER ?? '').trim().toLowerCase();
  const user =
    (want && users.find((u) => String(u.id) === want || u.discord_id.toLowerCase() === want || u.name.toLowerCase() === want)) ||
    // Your real (Discord) admin account first, then a dev-login admin.
    users.find((u) => u.role === 'admin' && !u.discord_id.startsWith('dev-')) ||
    users.find((u) => u.role === 'admin') ||
    users[0] ||
    ctx.auth.allow('dev-offline', 'admin', now, 'dev');
  ctx.db.run('INSERT OR REPLACE INTO state.consent (user_id, version, accepted_at, age_ok) VALUES (?, ?, ?, 1)', user.id, TERMS_VERSION, now);
  state.cookie = ctx.auth.createSession(user.id, now).cookie;
  state.user = user;
}

export function offlineSummary(): string {
  return state ? `OFFLINE read-only. data copied from ${state.source} to ${state.copy}. signed in as ${state.user.name || `user ${state.user.id}`} (${state.user.role})` : '';
}

/** Read only, and always signed in. Registered right after the cookie plugin. */
export function registerOffline(app: FastifyInstance, ctx: Context): void {
  if (!state) return;
  const s = state;
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      return reply.code(403).send({ error: 'read_only', message: 'Offline dev mode is read only. Nothing was saved.' });
    }
    if (!ctx.auth.sessionUser(req.cookies[SESSION_COOKIE], Date.now())) {
      req.cookies[SESSION_COOKIE] = s.cookie;
      reply.setCookie(SESSION_COOKIE, s.cookie, { path: '/', httpOnly: true, sameSite: 'lax', secure: false });
    }
  });
}
