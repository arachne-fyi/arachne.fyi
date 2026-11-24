import { join } from 'node:path';
import { Auth } from './auth.ts';
import type { Config } from './config.ts';
import { Db } from './db.ts';
import { Indexer } from './indexer.ts';
import { Ingest } from './ingest.ts';
import { Insights, Views } from './insights.ts';
import { Prices } from './prices.ts';
import { Progress } from './progress.ts';
import { Push } from './push.ts';
import { Notifier } from './social.ts';
import { Stats } from './stats.ts';
import { DayLog } from './store/log.ts';

/** Everything the routes need, wired together once. Tests build one of these on a temp folder. */
export interface Context {
  config: Config;
  db: Db;
  events: DayLog;
  priceLog: DayLog;
  prices: Prices;
  indexer: Indexer;
  stats: Stats;
  insights: Insights;
  views: Views;
  progress: Progress;
  notifier: Notifier;
  push: Push;
  auth: Auth;
  ingest: Ingest;
  hub: Hub;
}

/** Fan-out for Server-Sent Events: routes publish, open dashboards receive. */
export class Hub {
  private readonly listeners = new Set<(event: string, data: unknown) => void>();

  subscribe(fn: (event: string, data: unknown) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(event: string, data: unknown): void {
    for (const fn of this.listeners) fn(event, data);
  }

  get size(): number {
    return this.listeners.size;
  }
}

export function createContext(config: Config): Context {
  const db = new Db(config.dataDir);
  const events = new DayLog(join(config.dataDir, 'events'));
  const priceLog = new DayLog(join(config.dataDir, 'prices'));
  const prices = new Prices(db, priceLog);
  const indexer = new Indexer(db, prices);
  indexer.backfillEssence();
  const stats = new Stats(db);
  const auth = new Auth(db, config);
  const ingest = new Ingest(db, events, indexer, stats);
  const insights = new Insights(db, stats);
  const ctx = {
    config,
    db,
    events,
    priceLog,
    prices,
    indexer,
    stats,
    insights,
    views: new Views(db, stats),
    progress: new Progress(db, stats, insights),
    auth,
    ingest,
    hub: new Hub(),
  } as Context;
  ctx.push = new Push(ctx);
  ctx.notifier = new Notifier(ctx);
  return ctx;
}
