import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harness } from './helpers.ts';
import { backfillFromCofl, gapsIn, parseCoflHistory } from '../src/cofl.ts';
import { rebuildIndex } from '../src/store/rebuild.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

test('SkyCofl history: sell is instant sell, buy is the sell offer, times are UTC', () => {
  const pts = parseCoflHistory([
    { buy: 2579.5, sell: 2400.9, timestamp: '2026-11-26T12:00:00' },
    { buy: 2578.6, sell: 0, timestamp: '2026-11-26T10:00:00' },
    { buy: 0, sell: 0, timestamp: '2026-11-26T08:00:00' },
    { buy: 5, sell: 4 },
  ]);
  assert.deepEqual(pts, [
    { ts: Date.UTC(2026, 10, 26, 10), instant: null, offer: 2578.6 },
    { ts: Date.UTC(2026, 10, 26, 12), instant: 2400.9, offer: 2579.5 },
  ]);
  assert.throws(() => parseCoflHistory({ error: 'nope' }));
});

test('gaps are stretches over 30 minutes without a snapshot', () => {
  assert.deepEqual(gapsIn([0, 5 * MIN, 10 * MIN], 0, 10 * MIN), []);
  assert.deepEqual(gapsIn([0, HOUR, HOUR + 5 * MIN], 0, 3 * HOUR), [
    { from: 0, to: HOUR },
    { from: HOUR + 5 * MIN, to: 3 * HOUR },
  ]);
  assert.deepEqual(gapsIn([], 0, HOUR), [{ from: 0, to: HOUR }]);
});

test('backfill only fills gaps, keeps our own snapshots, skips unknown items and survives a rebuild', async () => {
  const h = await harness();
  try {
    const now = Date.UTC(2026, 10, 26, 12);
    const start = now - 2 * 86_400_000;
    // Our own snapshots every 5 minutes for the last 12 hours only.
    for (let t = now - 12 * HOUR; t <= now; t += 5 * MIN) h.ctx.prices.record({ ts: t, prices: { SOUL_STRING: [100, 110] } });
    const updatedAt = h.ctx.prices.updatedAt;
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (!url.includes('/SOUL_STRING/')) return new Response('not found', { status: 404 });
      // SkyCofl answers with 2-hourly points over the whole two days, newest first.
      const body = [];
      for (let t = now; t >= start; t -= 2 * HOUR) body.push({ buy: 220, sell: 200, timestamp: new Date(t).toISOString().slice(0, 19) });
      return Response.json(body);
    }) as typeof fetch;

    const report = await backfillFromCofl(h.ctx.prices, { baseUrl: 'https://cofl.test', days: 2, now, pauseMs: 0, fetch: fake, items: ['SOUL_STRING', 'NOT_ON_BAZAAR'] });
    assert.deepEqual(report.failed, []);
    // Points from 2 days ago up to (but not inside or next to) our own 12 hours.
    const added = report.added.SOUL_STRING ?? 0;
    assert.ok(added >= 15 && added <= 18, `added ${added}`);
    assert.equal(report.added.NOT_ON_BAZAAR, undefined);
    assert.ok(urls.every((u) => u.startsWith('https://cofl.test/api/bazaar/')));

    const rows = h.ctx.db.all<{ ts: number; instant: number }>('SELECT ts, instant FROM prices WHERE item = ? ORDER BY ts', 'SOUL_STRING');
    assert.ok(rows.filter((r) => r.ts >= now - 12 * HOUR).every((r) => r.instant === 100), 'own snapshots untouched');
    assert.equal(h.ctx.prices.updatedAt, updatedAt, 'back-fill does not move updatedAt');

    // Written to the price log, marked as SkyCofl, so a rebuild keeps them.
    const day = new Date().toISOString().slice(0, 10);
    const log = readFileSync(join(h.dir, 'prices', `${day}.ndjson`), 'utf8');
    assert.ok(log.includes('"src":"skycofl"'));
    const before = rows.length;
    await rebuildIndex(h.ctx);
    assert.equal(h.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM prices WHERE item = ?', 'SOUL_STRING')?.n, before);

    // A second run finds nothing left to fill in the old part.
    urls.length = 0;
    const again = await backfillFromCofl(h.ctx.prices, { baseUrl: 'https://cofl.test', days: 2, now, pauseMs: 0, fetch: fake, items: ['SOUL_STRING'] });
    assert.equal(again.added.SOUL_STRING ?? 0, 0);
  } finally {
    await h.close();
  }
});

test('years back are filled from yearly requests, the last day from the 5-minute window, and a rerun asks nothing', async () => {
  const h = await harness();
  try {
    const DAY = 86_400_000;
    const now = Date.UTC(2026, 10, 26, 12);
    const urls: string[] = [];
    // Like SkyCofl: a range answers daily points over a year and 2-hourly ones over a week; "day" is 5-minutely.
    const fake = (async (url: string) => {
      urls.push(url);
      const u = new URL(url);
      let from: number, to: number, step: number;
      if (u.pathname.endsWith('/history/day')) [from, to, step] = [now - DAY, now, 5 * MIN];
      else {
        from = Date.parse(u.searchParams.get('start')!);
        to = Date.parse(u.searchParams.get('end')!);
        step = to - from > 30 * DAY ? DAY : 2 * HOUR;
      }
      const body = [];
      for (let t = Math.ceil(from / step) * step; t <= to; t += step) body.push({ buy: 220, sell: 200, timestamp: new Date(t).toISOString().slice(0, 23) });
      return Response.json(body.reverse());
    }) as typeof fetch;

    const r = await backfillFromCofl(h.ctx.prices, { baseUrl: 'https://cofl.test', days: 2 * 365, now, pauseMs: 0, fetch: fake, items: ['SOUL_STRING'] });
    assert.deepEqual(r.failed, []);
    assert.equal(urls.filter((u) => u.includes('/history?')).length, 2 + 13, 'two yearly and 13 weekly requests');
    assert.equal(urls.filter((u) => u.endsWith('/history/day')).length, 1);
    const n = (from: number, to: number) => h.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM prices WHERE item = ? AND ts >= ? AND ts < ?', 'SOUL_STRING', from, to)!.n;
    assert.ok(n(now - 400 * DAY, now - 300 * DAY) >= 95, 'daily points a year ago');
    assert.ok(n(now - 10 * DAY, now - 9 * DAY) >= 11, '2-hourly points 10 days ago');
    assert.ok(n(now - 6 * HOUR, now - 5 * HOUR) >= 11, '5-minute points today');

    urls.length = 0;
    const again = await backfillFromCofl(h.ctx.prices, { baseUrl: 'https://cofl.test', days: 2 * 365, now, pauseMs: 0, fetch: fake, items: ['SOUL_STRING'] });
    assert.equal(again.requests, 0, urls.join('\n'));
  } finally {
    await h.close();
  }
});

test('price history buckets any range into a few hundred points', async () => {
  const h = await harness();
  try {
    const res = await h.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name: 'pat' } });
    const c = res.headers['set-cookie'];
    const cookie = (Array.isArray(c) ? c[0] : c)!.split(';')[0]!;
    const now = Date.now();
    for (let t = now - 3 * 86_400_000; t <= now; t += 5 * MIN) h.ctx.prices.record({ ts: t, prices: { SOUL_STRING: [100, 110] } });
    const get = async (q: string) => (await h.app.inject({ method: 'GET', url: `/api/prices/history?item=SOUL_STRING&${q}`, headers: { cookie } })).json();
    const day = await get(`from=${now - 86_400_000}&to=${now}`);
    assert.equal(day.bucketMs, 5 * MIN);
    assert.ok(day.points.length >= 280 && day.points.length <= 290, `day points ${day.points.length}`);
    const years = await get(`from=${now - 5 * 365 * 86_400_000}&to=${now}`);
    assert.equal(years.bucketMs, 7 * 86_400_000);
    assert.ok(years.points.length <= 2, `years points ${years.points.length}`);
    assert.equal((await get('days=1')).bucketMs, 5 * MIN, 'days= still works');
    assert.equal((await h.app.inject({ method: 'GET', url: `/api/prices/history?item=SOUL_STRING&from=${now}&to=${now - 1}`, headers: { cookie } })).statusCode, 400);
  } finally {
    await h.close();
  }
});
