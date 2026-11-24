import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acct, fightEvents, harness } from './helpers.ts';

type H = Awaited<ReturnType<typeof harness>>;
async function login(h: H, name: string, skipConsent = false) {
  const res = await h.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name, skipConsent } });
  const c = res.headers['set-cookie'];
  return (Array.isArray(c) ? c[0] : c)!.split(';')[0]!;
}
const call = async (h: H, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, cookie: string, payload?: unknown) =>
  h.app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });

test('consent gate, Pro gate, codes, groups, deletion, global stats', async () => {
  const h = await harness();
  const boss = await login(h, 'boss'); // first user is the admin
  const bossUser = h.ctx.auth.listUsers()[0]!;
  const token = h.ctx.auth.createToken(bossUser.id, 'pc', Date.now()).token;
  const t = Date.now() - 20 * 60_000;
  await h.batch(token, acct('Spider1'), [...fightEvents(t), ...fightEvents(t + 60_000)]);

  // Consent: nothing works until the terms are accepted.
  h.ctx.auth.allow('dev-pal', 'user', Date.now(), 'pal');
  const pal = await login(h, 'pal', true);
  assert.equal((await call(h, 'GET', '/api/overview', pal)).statusCode, 428);
  assert.equal((await call(h, 'GET', '/api/me', pal)).json().consent.accepted, false);
  assert.equal((await call(h, 'POST', '/api/consent', pal, { terms: true })).statusCode, 400, 'age confirmation is needed too');
  assert.equal((await call(h, 'POST', '/api/consent', pal, { terms: true, age: true })).statusCode, 200);
  assert.equal((await call(h, 'GET', '/api/overview', pal)).statusCode, 200);

  // Pro gate: pal is a founder-free user now? Plans were set up before pal existed, so pal is free.
  assert.equal((await call(h, 'GET', '/api/heatmap', pal)).statusCode, 402);
  assert.equal((await call(h, 'GET', '/api/heatmap', boss)).statusCode, 200, 'admins are always Pro');

  // Codes
  const made = (await call(h, 'POST', '/api/admin/codes', boss, { days: 30, validMinutes: 10, maxUses: 1 })).json();
  assert.match(made.codes[0], /^ARF-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal((await call(h, 'POST', '/api/admin/codes', pal, {})).statusCode, 403);
  assert.equal((await call(h, 'POST', '/api/redeem', pal, { code: 'nope' })).statusCode, 404);
  assert.equal((await call(h, 'POST', '/api/redeem', pal, { code: made.codes[0].toLowerCase() })).statusCode, 200);
  assert.equal((await call(h, 'GET', '/api/heatmap', pal)).statusCode, 200, 'redeeming unlocks Pro');
  assert.equal((await call(h, 'POST', '/api/redeem', boss, { code: made.codes[0] })).statusCode, 410, 'single use');
  h.ctx.db.run('UPDATE state.codes SET expires_at = 1');
  const second = (await call(h, 'POST', '/api/admin/codes', boss, { days: 7, validMinutes: 1 })).json();
  h.ctx.db.run('UPDATE state.codes SET expires_at = 1 WHERE code = ?', second.codes[0]);
  assert.equal((await call(h, 'POST', '/api/redeem', boss, { code: second.codes[0] })).statusCode, 410, 'expired');

  // Groups
  const g = (await call(h, 'POST', '/api/groups', boss, { name: 'Web Spinners', tag: 'web' })).json();
  assert.ok(g.id);
  assert.equal((await call(h, 'POST', '/api/groups', boss, { name: 'X', tag: 'toolong' })).statusCode, 400);
  const mine = (await call(h, 'GET', '/api/groups', boss)).json().groups[0];
  assert.equal(mine.tag, 'WEB');
  const preview = (await h.app.inject({ method: 'GET', url: `/api/public/group/${mine.code}` })).json();
  assert.equal(preview.members, 1);
  assert.equal((await call(h, 'POST', '/api/groups/join', pal, { code: mine.code })).statusCode, 200);
  const detail = (await call(h, 'GET', `/api/groups/${g.id}`, pal)).json();
  assert.equal(detail.members.length, 2);
  assert.equal(detail.group.code, null, 'members do not see the code');
  // 100 cap
  for (let i = 0; i < 98; i++) h.ctx.db.run("INSERT INTO state.group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', 1)", g.id, 1000 + i);
  h.ctx.auth.allow('dev-late', 'user', Date.now(), 'late');
  const late = await login(h, 'late');
  assert.equal((await call(h, 'POST', '/api/groups/join', late, { code: mine.code })).statusCode, 409);
  // Mod lookup: tags show up for visible people only
  h.ctx.db.run("UPDATE state.accounts SET user_id = ? WHERE name = 'Spider1'", bossUser.id);
  const hit = await h.app.inject({ method: 'POST', url: '/api/v1/lookup', headers: { authorization: `Bearer ${token}` }, payload: { names: ['spider1', 'Nobody'] } });
  assert.deepEqual(hit.json().players, { spider1: { tag: 'WEB' } });
  await call(h, 'PUT', '/api/me/privacy', boss, { visible: false });
  const gone = await h.app.inject({ method: 'POST', url: '/api/v1/lookup', headers: { authorization: `Bearer ${token}` }, payload: { names: ['spider1'] } });
  assert.deepEqual(gone.json().players, {});

  // Global stats, then erasure keeps the anonymous sum
  const before = (await h.app.inject({ method: 'GET', url: '/api/public/global' })).json();
  assert.equal(before.kills, 2);
  assert.equal((await call(h, 'POST', '/api/me/delete', boss, { confirm: 'DELETE' })).statusCode, 409, 'the only admin cannot delete themselves');
  const palUser = h.ctx.auth.listUsers().find((u) => u.name === 'pal')!;
  h.ctx.db.run("UPDATE state.accounts SET user_id = ? WHERE name = 'Spider1'", palUser.id);
  assert.equal((await call(h, 'POST', '/api/me/delete', pal, { confirm: 'nope' })).statusCode, 400);
  assert.equal((await call(h, 'POST', '/api/me/delete', pal, { confirm: 'DELETE' })).statusCode, 200);
  assert.equal(h.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n, 0, 'events removed');
  assert.equal(h.ctx.auth.listUsers().some((u) => u.name === 'pal'), false);
  const after = (await h.app.inject({ method: 'GET', url: '/api/public/global' })).json();
  assert.equal(after.kills, before.kills, 'global totals keep the anonymous sum');
  assert.equal((await h.app.inject({ method: 'GET', url: '/.well-known/security.txt' })).statusCode, 200);
  const head = await h.app.inject({ method: 'GET', url: '/healthz' });
  assert.match(String(head.headers['content-security-policy']), /frame-ancestors 'none'/);
});
