import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { acct, fightEvents, harness } from './helpers.ts';
import { backupState, recordAccessRequest } from '../src/extras.ts';

/** Log in through DEV_AUTH and return the session cookie. */
async function login(h: Awaited<ReturnType<typeof harness>>, name: string) {
  const res = await h.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name } });
  const cookie = res.headers['set-cookie'];
  return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
}

test('dry streaks count kills since the last rare drop', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const a = acct('Spider1');
    const t = Date.now() - 60 * 60_000;
    const events = [
      ...fightEvents(t, {}),
      ...fightEvents(t + 60_000, { loot: [['DARK_QUEENS_SOUL_DROP', 1]] }),
      ...fightEvents(t + 120_000, {}),
      ...fightEvents(t + 180_000, {}),
      ...fightEvents(t + 240_000, {}),
    ];
    await h.batch(token, a, events);
    const ids = h.ctx.stats.accountIds();
    const soul = h.ctx.insights.dryStreaks(ids).find((d) => d.item === 'DARK_QUEENS_SOUL_DROP')!;
    assert.equal(soul.current, 3);
    assert.equal(soul.longest, 3);
    assert.equal(soul.dropped, 1);
    const fang = h.ctx.insights.dryStreaks(ids).find((d) => d.item === 'ARACHNE_FANG')!;
    assert.equal(fang.current, 5);
    assert.equal(fang.dropped, 0);
    const records = h.ctx.insights.records(ids);
    assert.equal(records.mostKillsDay?.value, 5);
    assert.ok(records.bestFight && records.bestFight.value > 0);
    assert.equal(records.lifetime.kills, 5);
    assert.equal(records.lifetime.daysFarmed >= 1, true);
  } finally {
    await h.close();
  }
});

test('exports, announcements and access requests', async () => {
  const h = await harness();
  try {
    const cookie = await login(h, 'boss'); // first dev login becomes admin
    const me = h.ctx.auth.listUsers()[0]!;
    const token = h.ctx.auth.createToken(me.id, 'pc', Date.now()).token;
    await h.batch(token, acct('Spider1'), fightEvents(Date.now() - 60_000, { loot: [['SOUL_STRING', 2]] }));

    const csv = await h.app.inject({ method: 'GET', url: '/api/export/drops.csv?scope=me', headers: { cookie } });
    assert.equal(csv.statusCode, 200);
    assert.match(csv.body, /^time_utc,account,kind/);
    assert.match(csv.body, /Soul String,2,/);
    const fights = await h.app.inject({ method: 'GET', url: '/api/export/fights.csv', headers: { cookie } });
    assert.match(fights.body, /CRYSTAL,250000,yes,COUNTED,10/);
    const all = await h.app.inject({ method: 'GET', url: '/api/export/me.json', headers: { cookie } });
    assert.equal(all.json().events.length > 0, true);

    const put = await h.app.inject({ method: 'PUT', url: '/api/admin/announcement', headers: { cookie }, payload: { text: 'Server restart at 6' } });
    assert.equal(put.statusCode, 200);
    const got = await h.app.inject({ method: 'GET', url: '/api/announcement', headers: { cookie } });
    assert.equal(got.json().announcement.text, 'Server restart at 6');

    recordAccessRequest(h.ctx, { id: '123456789012345678', name: 'Newbie', avatar: null }, Date.now());
    const reqs = await h.app.inject({ method: 'GET', url: '/api/admin/requests', headers: { cookie } });
    assert.equal(reqs.json().requests.length, 1);
    const ok = await h.app.inject({ method: 'POST', url: '/api/admin/requests/123456789012345678/approve', headers: { cookie } });
    assert.equal(ok.statusCode, 200);
    assert.ok(h.ctx.auth.listUsers().some((u) => u.discord_id === '123456789012345678'));
    const after = await h.app.inject({ method: 'GET', url: '/api/admin/requests', headers: { cookie } });
    assert.equal(after.json().requests.length, 0);

    const audit = await h.app.inject({ method: 'GET', url: '/api/admin/audit', headers: { cookie } });
    assert.deepEqual(
      audit.json().entries.map((e: { action: string }) => e.action),
      ['request.approve', 'announcement.set'],
    );

    const status = await h.app.inject({ method: 'GET', url: '/api/public/status' });
    assert.equal(status.json().kills, 1);

    const copy = backupState(h.ctx, Date.now());
    assert.ok(copy && existsSync(copy));
    assert.equal(backupState(h.ctx, Date.now()), null); // once a day
  } finally {
    await h.close();
  }
});

test('drop rates, heatmap, calendar and what-if', async () => {
  const h = await harness();
  try {
    const { token } = h.user('ollie');
    const t = Date.now() - 30 * 60_000;
    const events = [
      ...fightEvents(t, { loot: [['ARACK', 1], ['STRING', 40]] }),
      ...fightEvents(t + 60_000, { loot: [['STRING', 30]] }),
      ...fightEvents(t + 120_000, { loot: [['ARACK', 1]] }),
      ...fightEvents(t + 180_000, {}),
    ];
    await h.batch(token, acct('Spider1'), events);
    const ids = h.ctx.stats.accountIds();
    const crystal = h.ctx.views.dropRates(ids).tiers.find((x) => x.tier === 'CRYSTAL')!;
    assert.equal(crystal.kills, 4);
    const arack = crystal.items.find((i) => i.item === 'ARACK')!;
    assert.equal(arack.fights, 2);
    assert.equal(arack.rate, 0.5);
    assert.equal(arack.wiki, 0.25);
    // Arack twice in 4 (expected 1), armour 0 in 4 (expected 4 x 0.25 x 4 = 4): 2 / 5.
    assert.equal(crystal.luck, 2 / 5);

    const heat = h.ctx.views.heatmap(ids, 0, Date.now());
    assert.equal(heat.cells.length, 168);
    assert.ok(heat.cells.some((c) => c.uptimeMs > 0));
    const cal = h.ctx.views.calendar(ids, 7, Date.now());
    assert.equal(cal.days.reduce((n, d) => n + d.kills, 0), 4);
    const w = h.ctx.views.whatIf(ids, 0);
    assert.equal(w.actual, w.INSTANT_SELL); // default mode, and no Bazaar data: NPC fallback everywhere
    assert.equal(w.NPC, w.SELL_OFFER);
  } finally {
    await h.close();
  }
});

test('admin: view as, hide from boards, suspicious data, rebuild', async () => {
  const h = await harness();
  try {
    const cookie = await login(h, 'boss');
    const other = h.user('friend');
    await h.batch(other.token, acct('FriendAlt'), fightEvents(Date.now() - 60_000, { damage: 900_000_000, loot: [['SOUL_STRING', 5000]] }));

    const mine = (await h.app.inject({ method: 'GET', url: '/api/records?scope=me', headers: { cookie } })).json();
    assert.equal(mine.lifetime.kills, 0);
    const asFriend = (await h.app.inject({ method: 'GET', url: `/api/records?scope=me&as=${other.id}`, headers: { cookie } })).json();
    assert.equal(asFriend.lifetime.kills, 1);

    const board = async () => (await h.app.inject({ method: 'GET', url: '/api/leaderboard?window=all', headers: { cookie } })).json().rows.length;
    assert.equal(await board(), 1);
    await h.app.inject({ method: 'PUT', url: `/api/admin/users/${other.id}/hidden`, headers: { cookie }, payload: { hidden: true } });
    assert.equal(await board(), 0);

    const sus = (await h.app.inject({ method: 'GET', url: '/api/admin/suspicious', headers: { cookie } })).json();
    assert.deepEqual(new Set(sus.items.map((i: { kind: string }) => i.kind)), new Set(['Huge damage', 'Big stack']));

    const rebuilt = await h.app.inject({ method: 'POST', url: '/api/admin/rebuild', headers: { cookie } });
    assert.equal(rebuilt.statusCode, 200);
    const after = (await h.app.inject({ method: 'GET', url: `/api/records?scope=me&as=${other.id}`, headers: { cookie } })).json();
    assert.equal(after.lifetime.kills, 1);
  } finally {
    await h.close();
  }
});
