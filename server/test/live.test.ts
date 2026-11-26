import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { acct, harness } from './helpers.ts';

/** Log in through DEV_AUTH and return the session cookie. */
async function login(h: Awaited<ReturnType<typeof harness>>, name: string) {
  const res = await h.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name } });
  const cookie = res.headers['set-cookie'];
  return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
}

const key = (lobby: string, tier: string) => createHash('sha256').update(`${lobby}|${tier}`).digest('hex').slice(0, 16);

function packet(account: { uuid: string; name: string }, kind: 'SPAWN' | 'DEATH', ts: number, fight: string, extra: Record<string, unknown> = {}) {
  return {
    schema: 1,
    account,
    mod: { version: 'test', minecraft: '26.2' },
    sentAt: Date.now(),
    kind,
    ts,
    fight,
    tier: 'CRYSTAL',
    ...extra,
  };
}

test('three accounts reporting one boss agree on one spawn and death time', async () => {
  const h = await harness();
  try {
    const cookie = await login(h, 'ollie');
    const me = h.ctx.auth.listUsers().find((u) => u.name === 'ollie')!;
    const token = h.ctx.auth.createToken(me.id, 'pc', Date.now()).token;
    const accounts = [acct('ollie'), acct('Kestrel'), acct('zeph_')];
    const k = key('m12AB', 'CRYSTAL');
    const t = Date.now() - 20_000;
    // Three clients see the spawn up to a second apart; the middle one is the agreed time.
    const spawns = [t, t + 400, t + 1_000];
    for (const [i, a] of accounts.entries()) {
      const res = await h.app.inject({ method: 'POST', url: '/api/v1/live', headers: { authorization: `Bearer ${token}` }, payload: packet(a, 'SPAWN', spawns[i]!, `fight${i}`, { key: k }) });
      assert.equal(res.statusCode, 200, res.body);
    }
    // The accounts need to exist for /api/live to show them: one tiny batch each.
    for (const a of accounts) await h.batch(token, a, []);

    let live = (await h.app.inject({ method: 'GET', url: '/api/live', headers: { cookie } })).json() as { bosses: { spawnTs: number; deathTs: number | null; confirmations: number; spreadMs: number; accounts: unknown[] }[] };
    assert.equal(live.bosses.length, 1);
    assert.equal(live.bosses[0]!.spawnTs, t + 400);
    assert.equal(live.bosses[0]!.confirmations, 3);
    assert.equal(live.bosses[0]!.spreadMs, 600);
    assert.equal(live.bosses[0]!.deathTs, null);
    assert.equal(live.bosses[0]!.accounts.length, 3);

    // Two deaths arrive; their median is the death.
    for (const [i, a] of accounts.slice(0, 2).entries()) {
      await h.app.inject({ method: 'POST', url: '/api/v1/live', headers: { authorization: `Bearer ${token}` }, payload: packet(a, 'DEATH', t + 12_000 + i * 200, `fight${i}`, { key: k }) });
    }
    live = (await h.app.inject({ method: 'GET', url: '/api/live', headers: { cookie } })).json();
    assert.equal(live.bosses[0]!.deathTs, t + 12_100);

    // A boss in another lobby at the same moment is a different boss.
    await h.app.inject({ method: 'POST', url: '/api/v1/live', headers: { authorization: `Bearer ${token}` }, payload: packet(accounts[2]!, 'SPAWN', t + 30_000, 'other', { key: key('m99ZZ', 'CRYSTAL') }) });
    await h.app.inject({ method: 'POST', url: '/api/v1/live', headers: { authorization: `Bearer ${token}` }, payload: packet(accounts[0]!, 'SPAWN', t + 30_000, 'fight3', { key: k }) });
    live = (await h.app.inject({ method: 'GET', url: '/api/live', headers: { cookie } })).json();
    assert.equal(live.bosses.length, 3);
  } finally {
    await h.close();
  }
});

test('live packets: bad token, bad packet, someone else\'s account, clock skew', async () => {
  const h = await harness();
  try {
    const a = h.user('a');
    const b = h.user('b');
    const mine = acct('Mine');
    const bad = await h.app.inject({ method: 'POST', url: '/api/v1/live', headers: { authorization: 'Bearer al_nope' }, payload: packet(mine, 'SPAWN', Date.now(), 'fight1') });
    assert.equal(bad.statusCode, 401);
    const junk = await h.app.inject({ method: 'POST', url: '/api/v1/live', headers: { authorization: `Bearer ${a.token}` }, payload: { ...packet(mine, 'SPAWN', Date.now(), 'fight1'), key: 'not-hex' } });
    assert.equal(junk.statusCode, 400);
    await h.batch(a.token, mine, []);
    const theirs = await h.app.inject({ method: 'POST', url: '/api/v1/live', headers: { authorization: `Bearer ${b.token}` }, payload: packet(mine, 'SPAWN', Date.now(), 'fight1') });
    assert.equal(theirs.statusCode, 403, theirs.body);

    // A client whose clock is 2 minutes fast: its time is moved back by the skew.
    const fast = Date.now() + 120_000;
    const ok = await h.app.inject({ method: 'POST', url: '/api/v1/live', headers: { authorization: `Bearer ${a.token}` }, payload: { ...packet(mine, 'SPAWN', fast - 3_000, 'fight2'), sentAt: fast } });
    assert.equal(ok.statusCode, 200);
    const boss = h.ctx.live.visible(new Set(h.ctx.stats.accountIds(a.id)), Date.now())[0]!;
    assert.ok(Math.abs(boss.spawnTs! - (Date.now() - 3_000)) < 2_000, `spawn ${boss.spawnTs} vs now ${Date.now()}`);
  } finally {
    await h.close();
  }
});
