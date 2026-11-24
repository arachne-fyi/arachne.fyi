import { createRequire } from 'node:module';
import type WebPush from 'web-push';

// web-push is CommonJS; loading it with require works the same under tsx, node and esbuild.
const webpush = createRequire(import.meta.url)('web-push') as typeof WebPush;
import type { Context } from './context.ts';

/**
 * Browser push notifications (an installed dashboard on a phone, or a desktop browser).
 * The VAPID key pair that identifies this server is made once and kept in state.db.
 * Subscriptions are per browser; a person can have several.
 */
export class Push {
  ready = false;
  readonly publicKey: string;

  constructor(private readonly ctx: Context) {
    const db = ctx.db;
    db.raw.exec(`CREATE TABLE IF NOT EXISTS state.push_subs (
      endpoint   TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      json       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    let keys = db.get<{ value: string }>("SELECT value FROM state.settings WHERE key = 'vapid'");
    if (!keys) {
      const fresh = webpush.generateVAPIDKeys();
      db.run("INSERT INTO state.settings (key, value) VALUES ('vapid', ?)", JSON.stringify(fresh));
      keys = { value: JSON.stringify(fresh) };
    }
    const k = JSON.parse(keys.value) as { publicKey: string; privateKey: string };
    this.publicKey = k.publicKey;
    try {
      // The push services want a way to reach whoever runs the server. A mailto: works with
      // all of them; Apple's refuses a localhost subject.
      webpush.setVapidDetails('mailto:contact@arachne.fyi', k.publicKey, k.privateKey);
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  subscribe(userId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, now: number): void {
    this.ctx.db.run('INSERT OR REPLACE INTO state.push_subs (endpoint, user_id, json, created_at) VALUES (?, ?, ?, ?)', sub.endpoint, userId, JSON.stringify(sub), now);
  }

  unsubscribe(endpoint: string): void {
    this.ctx.db.run('DELETE FROM state.push_subs WHERE endpoint = ?', endpoint);
  }

  count(userId: number): number {
    return this.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM state.push_subs WHERE user_id = ?', userId)?.n ?? 0;
  }

  /** Send to every browser this person subscribed. Dead subscriptions are removed. */
  send(userId: number, title: string, body: string, url = '/'): void {
    if (!this.ready) return;
    for (const row of this.ctx.db.all<{ endpoint: string; json: string }>('SELECT endpoint, json FROM state.push_subs WHERE user_id = ?', userId)) {
      webpush.sendNotification(JSON.parse(row.json), JSON.stringify({ title, body, url }), { TTL: 3600 }).catch((err: { statusCode?: number; body?: string }) => {
        // 404/410: the browser unsubscribed. 403: the subscription was made for an older key
        // pair, so it can never work again. Either way, forget it; the page offers to redo it.
        if (err.statusCode === 404 || err.statusCode === 410 || err.statusCode === 403) this.unsubscribe(row.endpoint);
        console.warn(`push to user ${userId} failed: ${err.statusCode ?? ''} ${String(err.body ?? err).slice(0, 200)}`);
      });
    }
  }
}
