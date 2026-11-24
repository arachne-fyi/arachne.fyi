import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { acct, eid, fightEvents, harness } from './helpers.ts';
import { rebuildIndex } from '../src/store/rebuild.ts';
import { parseBazaar } from '../src/prices.ts';

const HOUR = 3_600_000;

test('a batch without a valid token is refused', async () => {
  const h = await harness();
  try {
    const res = await h.batch('al_' + 'x'.repeat(43), acct('Nobody'), []);
    assert.equal(res.status, 401);
  } finally {
    await h.close();
  }
});

test('retrying a batch never double-counts', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const a = acct('Spider1');
    const now = Date.now();
    const events = fightEvents(now - 60_000, { loot: [['SOUL_STRING', 2]] });
    const first = await h.batch(token, a, events);
    assert.equal(first.status, 200);
    assert.equal(first.body.accepted, events.length);
    const second = await h.batch(token, a, events);
    assert.equal(second.body.accepted, 0);
    assert.equal(second.body.duplicates, events.length);
    assert.equal(second.body.totals.account.all.kills, 1);
    assert.equal(second.body.totals.account.all.crystals, 1);
    // NPC fallback prices apply when no Bazaar snapshot exists: 2 x 5,000.
    assert.equal(second.body.totals.account.all.lootValue, 10_000);
  } finally {
    await h.close();
  }
});

test('one invalid event is rejected without blocking the rest', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const good = { id: eid(), ts: Date.now(), kind: 'LOOT', item: 'STRING', count: 3, source: 'pickup' };
    const bad = { id: eid(), ts: Date.now(), kind: 'LOOT', item: 'STRING', count: -1, source: 'pickup' };
    const unknown = { id: eid(), ts: Date.now(), kind: 'TELEPORT' };
    const res = await h.batch(token, acct('Spider1'), [good, bad, unknown]);
    assert.equal(res.body.accepted, 1);
    assert.equal(res.body.rejected.length, 2);
    assert.equal(res.body.rejected[0].id, bad.id);
  } finally {
    await h.close();
  }
});

test('kills need 10,000 damage; uptime and profit follow the rules', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const a = acct('Spider1');
    const t = Date.now() - 10 * 60_000;
    const events = [
      ...fightEvents(t, { damage: 300_000, loot: [['ENCHANTED_STRING', 4]] }),
      ...fightEvents(t + 30_000, { damage: 9_999 }), // took part, but not a kill
      ...fightEvents(t + 60_000, { damage: null }), // no damage line: stops uptime at its spawn
      { id: eid(), ts: t + 12_000, kind: 'COINS', amount: 1_500, source: 'scavenger' },
    ];
    const res = await h.batch(token, a, events);
    const all = res.body.totals.account.all;
    assert.equal(all.kills, 1);
    assert.equal(all.fights, 3);
    assert.equal(all.crystals, 3);
    assert.equal(all.uptimeMs, 60_000);
    const crystal = 2 * 500 + 16 * 480 + 16 * 576; // NPC value of the recipe
    assert.equal(all.costs, 3 * crystal);
    assert.equal(all.profit, 4 * 576 + 1_500 - 3 * crystal);
  } finally {
    await h.close();
  }
});

test('combined uptime sums accounts; wall-clock uptime counts overlap once', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const t = Date.now() - 10 * 60_000;
    await h.batch(token, acct('Spider1'), fightEvents(t));
    await h.batch(token, acct('Spider2'), fightEvents(t + 5_000));
    const res = await h.batch(token, acct('Spider3'), fightEvents(t + 5 * 60_000));
    const group = res.body.totals.group.all;
    assert.equal(group.uptimeMs, 3 * 40_000);
    assert.equal(group.wallUptimeMs, 45_000 + 40_000);
    assert.ok(Math.abs(group.profitPerClientHour - (group.profit / group.uptimeMs) * HOUR) < 1e-6);
    assert.ok(Math.abs(group.profitPerWallHour - (group.profit / group.wallUptimeMs) * HOUR) < 1e-6);
  } finally {
    await h.close();
  }
});

test("a Minecraft account cannot be claimed by a second person", async () => {
  const h = await harness();
  try {
    const a = acct('Spider1');
    assert.equal((await h.batch(h.user('ollie').token, a, [])).status, 200);
    const res = await h.batch(h.user('friend').token, a, []);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'account_owned_by_other_user');
  } finally {
    await h.close();
  }
});

test('a revoked token stops working', async () => {
  const h = await harness();
  try {
    const u = h.user('ollie');
    const tokenId = h.ctx.auth.listTokens(u.id)[0]!.id;
    h.ctx.auth.revokeToken(u.id, tokenId, Date.now());
    assert.equal((await h.batch(u.token, acct('Spider1'), [])).status, 401);
  } finally {
    await h.close();
  }
});

test('a wrong client clock is corrected using sentAt', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const a = acct('Spider1');
    const wrong = Date.now() - 3 * HOUR; // client clock is three hours slow
    const res = await h.batch(token, a, [{ id: eid(), ts: wrong - 1_000, kind: 'LOOT', item: 'STRING', count: 1, source: 'pickup' }], wrong);
    assert.equal(res.body.accepted, 1);
    const row = h.ctx.db.get<{ ts: number }>('SELECT ts FROM events')!;
    assert.ok(Math.abs(row.ts - (Date.now() - 1_000)) < 2_000);
  } finally {
    await h.close();
  }
});

test('events are valued at the Bazaar price in force at their timestamp', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const now = Date.now();
    h.ctx.prices.record({ ts: now - 2 * HOUR, prices: { SOUL_STRING: [100_000, 110_000] } });
    h.ctx.prices.record({ ts: now - 1 * HOUR, prices: { SOUL_STRING: [200_000, 220_000] } });
    const a = acct('Spider1');
    const res = await h.batch(token, a, [
      { id: eid(), ts: now - 90 * 60_000, kind: 'LOOT', item: 'SOUL_STRING', count: 1, source: 'pickup' },
      { id: eid(), ts: now - 30 * 60_000, kind: 'LOOT', item: 'SOUL_STRING', count: 1, source: 'pickup' },
    ]);
    assert.equal(res.body.totals.account.all.lootValue, 300_000);
    // Switching the account to sell-offer pricing re-values history without touching events.
    h.ctx.db.run("UPDATE state.accounts SET price_mode = 'SELL_OFFER'");
    h.ctx.stats.invalidate();
    assert.equal(h.ctx.stats.windows([a.uuid.replace(/-/g, '')], now).all.lootValue, 330_000);
    h.ctx.db.run('UPDATE state.accounts SET ironman = 1');
    h.ctx.stats.invalidate();
    assert.equal(h.ctx.stats.windows([a.uuid.replace(/-/g, '')], now).all.lootValue, 10_000);
  } finally {
    await h.close();
  }
});

test('the index can be rebuilt from the NDJSON files alone', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const now = Date.now();
    h.ctx.prices.record({ ts: now - 2 * HOUR, prices: { ENCHANTED_STRING: [700, 750], ARACHNE_FRAGMENT: [20_000, 21_000] } });
    const a = acct('Spider1');
    const b = acct('Spider2');
    const events = fightEvents(now - 20 * 60_000, { loot: [['ENCHANTED_STRING', 5], ['TARANTULA_EPIC', 1]] });
    await h.batch(token, a, events);
    await h.batch(token, a, events); // duplicates must not reach the file twice
    await h.batch(token, b, fightEvents(now - 15 * 60_000, { damage: 500 }));
    const before = h.ctx.stats.windows(h.ctx.stats.accountIds(), now);

    const files = readdirSync(join(h.dir, 'events'));
    assert.equal(files.length, 1);
    const lines = readFileSync(join(h.dir, 'events', files[0]!), 'utf8').trim().split('\n');
    assert.equal(lines.length, events.length + 4);

    h.ctx.db.clearIndex();
    h.ctx.stats.invalidate();
    assert.equal(h.ctx.stats.windows(h.ctx.stats.accountIds(), now).all.kills, 0);

    const report = await rebuildIndex(h.ctx, now);
    assert.equal(report.indexed, lines.length);
    assert.equal(report.priceSnapshots, 1);
    assert.deepEqual(h.ctx.stats.windows(h.ctx.stats.accountIds(), now), before);
  } finally {
    await h.close();
  }
});

test('dashboard routes need a session; dev login provides one', async () => {
  const h = await harness();
  try {
    assert.equal((await h.app.inject({ url: '/api/overview' })).statusCode, 401);
    const login = await h.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name: 'ollie' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const me = (await h.app.inject({ url: '/api/me', headers: { cookie } })).json();
    assert.equal(me.user.role, 'admin');

    const created = (await h.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { label: 'laptop' } })).json();
    assert.match(created.token, /^al_/);
    assert.equal((await h.batch(created.token, acct('Spider1'), fightEvents(Date.now() - 60_000))).status, 200);

    const overview = (await h.app.inject({ url: '/api/overview', headers: { cookie } })).json();
    assert.equal(overview.accounts.length, 1);
    assert.equal(overview.accounts[0].owner, 'ollie');
    assert.equal(overview.totals.group.all.kills, 1);

    const listed = (await h.app.inject({ url: '/api/tokens', headers: { cookie } })).json();
    assert.equal(JSON.stringify(listed).includes(created.token), false, 'full tokens are never listed again');

    // A cross-site write is refused even with a valid cookie.
    const evil = await h.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie, origin: 'https://evil.example' }, payload: { label: 'x' } });
    assert.equal(evil.statusCode, 403);
  } finally {
    await h.close();
  }
});

test('non-admins cannot use admin routes', async () => {
  const h = await harness();
  try {
    await h.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name: 'first' } });
    const login = await h.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name: 'second' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    assert.equal((await h.app.inject({ url: '/api/admin/users', headers: { cookie } })).statusCode, 403);
  } finally {
    await h.close();
  }
});

test('bazaar responses are reduced to the watchlist', () => {
  const now = Date.now();
  const line = parseBazaar(
    {
      success: true,
      lastUpdated: now - 1_000,
      products: {
        SOUL_STRING: { quick_status: { sellPrice: 150_000.5, buyPrice: 160_000 } },
        ENCHANTED_STRING: { quick_status: { sellPrice: 0, buyPrice: 800 } },
        DIAMOND: { quick_status: { sellPrice: 8, buyPrice: 9 } },
      },
    },
    now,
  );
  assert.deepEqual(line.prices, { SOUL_STRING: [150_000.5, 160_000], ENCHANTED_STRING: [null, 800] });
  assert.throws(() => parseBazaar({ success: false }, now));
});

test('hourly rollups give the same totals as summing every event', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const a = acct('Spider1');
    const now = Date.now();
    const events = [];
    for (let i = 0; i < 300; i++) {
      const ts = now - 6 * HOUR + i * 61_000 + 137;
      events.push({ id: eid(), ts, kind: 'LOOT', item: i % 2 ? 'SOUL_STRING' : 'ENCHANTED_STRING', count: 1 + (i % 4), source: 'pickup' });
      if (i % 10 === 0) events.push({ id: eid(), ts, kind: 'PLACE', item: 'ARACHNE_CRYSTAL', count: 1 });
      if (i % 7 === 0) events.push({ id: eid(), ts, kind: 'COINS', amount: 1234.5, source: 'scavenger' });
    }
    for (let i = 0; i < events.length; i += 400) await h.batch(token, a, events.slice(i, i + 400));
    const uuid = a.uuid.replace(/-/g, '');
    const direct = (from: number, to: number) =>
      h.ctx.db.get<{ v: number }>(
        `SELECT SUM(CASE WHEN kind = 'LOOT' THEN count * p_instant WHEN kind = 'COINS' THEN amount ELSE -count * p_instant END) AS v
         FROM events WHERE account = ? AND ts >= ? AND ts < ?`,
        uuid,
        from,
        to,
      )!.v ?? 0;
    // Window edges in the middle of hours, so both the raw edges and the rollup are used.
    for (const [from, to] of [
      [now - 5.3 * HOUR, now - 1.7 * HOUR],
      [now - 6.5 * HOUR, Number.MAX_SAFE_INTEGER],
      [now - 2.2 * HOUR, now - 2.1 * HOUR],
    ] as const) {
      const t = h.ctx.stats.totals([uuid], Math.floor(from), to);
      assert.ok(Math.abs(t.profit - direct(Math.floor(from), to)) < 1e-6, `window ${from}-${to}`);
    }
  } finally {
    await h.close();
  }
});

test('graph series agree with the events, by hour and by session', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const a = acct('Spider1');
    const now = Date.now();
    await h.batch(token, a, [
      ...fightEvents(now - 50 * HOUR, { loot: [['SOUL_STRING', 3]] }),
      ...fightEvents(now - 20 * 60_000, { loot: [['ENCHANTED_STRING', 5]] }),
      ...fightEvents(now - 19 * 60_000, { loot: [['ARACHNE_FRAGMENT', 2]] }),
    ]);
    const uuid = a.uuid.replace(/-/g, '');
    const week = h.ctx.stats.series('7d', now);
    const sum = week.accounts[0]!.profit.reduce((x, y) => x + y, 0);
    const direct = h.ctx.stats.totals([uuid], week.from, week.to).profit;
    assert.ok(Math.abs(sum - direct) < 1e-6, 'hourly series matches totals');

    const session = h.ctx.stats.series('session', now);
    assert.equal(session.empty, false);
    // The session covers the two recent fights only, not the one 50 hours ago.
    assert.ok(session.from >= now - 25 * 60_000 && session.from <= now - 20 * 60_000);
    const sessionKills = session.accounts[0]!.kills.reduce((x, y) => x + y, 0);
    assert.equal(sessionKills, 2);
  } finally {
    await h.close();
  }
});

test('the HUD group is your group, not everyone; focus counts Soul String and Essence', async () => {
  const h = await harness();
  try {
    const me = h.user('ollie');
    const friend = h.user('friend');
    const stranger = h.user('stranger');
    const t = Date.now() - 10 * 60_000;
    await h.batch(friend.token, acct('Friend1'), fightEvents(t, { loot: [['SOUL_STRING', 3]] }));
    await h.batch(stranger.token, acct('Stranger1'), fightEvents(t, { loot: [['SOUL_STRING', 100]] }));

    // Not in a group yet: "group" is just me.
    const alone = await h.batch(me.token, acct('Me1'), fightEvents(t + 1_000, { loot: [['SOUL_STRING', 2], ['ESSENCE_SPIDER', 40]] }));
    assert.equal(alone.status, 200);
    assert.equal(alone.body.groupTag, null);
    assert.equal(alone.body.focus.group.all.soulString, 2);
    assert.equal(alone.body.totals.group.all.kills, 1);

    // Same group as friend: friend counts, the stranger never does.
    h.ctx.db.run("INSERT INTO state.groups (id, code, name, tag, owner_id, created_at) VALUES (1, 'ABCDEF', 'Webs', 'WEB', ?, ?)", me.id, t);
    h.ctx.db.run("INSERT INTO state.group_members (group_id, user_id, role, joined_at) VALUES (1, ?, 'owner', ?), (1, ?, 'member', ?)", me.id, t, friend.id, t);
    h.ctx.stats.invalidate();
    const grouped = await h.batch(me.token, acct('Me2'), []);
    assert.equal(grouped.body.groupTag, 'WEB');
    assert.equal(grouped.body.focus.group.all.soulString, 5);
    assert.equal(grouped.body.focus.group.all.essence, 40);
    assert.equal(grouped.body.focus.user.all.soulString, 2);
    assert.equal(grouped.body.totals.group.all.kills, 2);
    assert.equal(grouped.body.rank.of, 2);
  } finally {
    await h.close();
  }
});
