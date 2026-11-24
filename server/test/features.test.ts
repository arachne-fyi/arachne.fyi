import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAlphaOrigin } from '@arachne/shared';
import { acct, eid, fightEvents, harness } from './helpers.ts';

type H = Awaited<ReturnType<typeof harness>>;
async function login(h: H, name: string) {
  const res = await h.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name } });
  const c = res.headers['set-cookie'];
  return (Array.isArray(c) ? c[0] : c)!.split(';')[0]!;
}

test('armour as essence changes totals, drops and per hour together', async () => {
  const h = await harness();
  const cookie = await login(h, 'boss');
  const me = h.ctx.auth.listUsers()[0]!;
  const token = h.ctx.auth.createToken(me.id, 'pc', Date.now()).token;
  const t = Date.now() - 30 * 60_000;
  // Spider Essence at 1,000 coins: a helmet is then worth 5 x 1,000 = 5,000 instead of 2,000.
  h.ctx.prices.record({ ts: t - 60_000, prices: { ESSENCE_SPIDER: [1000, 1100] } } as never);
  await h.batch(token, acct('Spider1'), fightEvents(t, { loot: [['ARACHNE_HELMET', 1]] }));
  const loot = async () => (await h.app.inject({ method: 'GET', url: '/api/loot?window=all&scope=me', headers: { cookie } })).json().loot.find((l: { item: string }) => l.item === 'ARACHNE_HELMET').value;
  assert.equal(await loot(), 2000);
  const before = h.ctx.stats.totals(h.ctx.stats.accountIds(me.id), 0, Number.MAX_SAFE_INTEGER).lootValue;
  assert.equal((await h.app.inject({ method: 'PUT', url: '/api/me/prefs', headers: { cookie }, payload: { armour: 'ESSENCE' } })).statusCode, 200);
  assert.equal(await loot(), 5000);
  const after = h.ctx.stats.totals(h.ctx.stats.accountIds(me.id), 0, Number.MAX_SAFE_INTEGER).lootValue;
  assert.equal(after - before, 3000, 'totals move by the same 3,000');
  // NPC mode ignores the essence choice: essence has no NPC price.
  h.ctx.db.run("UPDATE state.accounts SET price_mode = 'NPC'");
  h.ctx.stats.invalidate();
  assert.equal(await loot(), 2000);
  await h.close();
});

test('titles: only unlocked ones, ids only', async () => {
  const h = await harness();
  const cookie = await login(h, 'boss');
  const put = (payload: unknown) => h.app.inject({ method: 'PUT', url: '/api/me/prefs', headers: { cookie }, payload: payload as object });
  assert.equal((await put({ title: 'hatchling' })).statusCode, 200);
  assert.equal((await put({ title: 'arachnes-bane' })).statusCode, 403, 'locked');
  assert.equal((await put({ title: '<script>' })).statusCode, 400, 'not an id');
  assert.equal((await put({ title: 'made-up' })).statusCode, 400, 'unknown');
  assert.equal((await put({ nickname: 'x' })).statusCode, 400, 'unknown keys refused');
  const p = (await h.app.inject({ method: 'GET', url: '/api/me/prefs', headers: { cookie } })).json();
  assert.equal(p.shownTitle, 'Hatchling');
  await h.close();
});

test('public profile only sends the fields that are on, per account', async () => {
  const h = await harness();
  const cookie = await login(h, 'boss');
  const me = h.ctx.auth.listUsers()[0]!;
  const token = h.ctx.auth.createToken(me.id, 'pc', Date.now()).token;
  await h.batch(token, acct('MainAcct'), fightEvents(Date.now() - 600_000));
  await h.app.inject({ method: 'PUT', url: '/api/me/sharing', headers: { cookie }, payload: { publicName: 'boss' } });
  let p = (await h.app.inject({ method: 'GET', url: '/api/public/profile/boss' })).json();
  assert.equal(p.accounts, undefined, 'account names are private by default');
  assert.equal(p.total.kills, 1);
  await h.app.inject({ method: 'PUT', url: '/api/me/prefs', headers: { cookie }, payload: { public: ['kills', 'lastSeen', 'accounts'] } });
  p = (await h.app.inject({ method: 'GET', url: '/api/public/profile/boss' })).json();
  assert.equal(p.total.profit, undefined, 'profit turned off');
  assert.equal(p.accounts[0].name, 'MainAcct');
  assert.ok(p.accounts[0].lastSeen > 0);
  assert.equal('profit' in p.accounts[0] && p.accounts[0].profit !== undefined, false);
  await h.close();
});

test('alpha network events are never stored', async () => {
  assert.equal(isAlphaOrigin({ host: 'alpha.hypixel.net', brand: null, motd: null }), true);
  assert.equal(isAlphaOrigin({ host: 'ALPHA.hypixel.net:25565', brand: null, motd: null }), true);
  assert.equal(isAlphaOrigin({ host: 'mc.hypixel.net', brand: 'Hypixel Alpha BungeeCord', motd: null }), true);
  assert.equal(isAlphaOrigin({ host: 'play.example', brand: null, motd: 'Hypixel Network [ALPHA]' }), true);
  assert.equal(isAlphaOrigin({ host: 'mc.hypixel.net', brand: 'Hypixel BungeeCord (2026.11.1)', motd: 'Hypixel Network' }), false);
  assert.equal(isAlphaOrigin({ host: 'alphabet.hypixel.net', brand: null, motd: null }), false);
  assert.equal(isAlphaOrigin(undefined), false);

  const h = await harness();
  const u = h.user('a');
  const alpha = { host: 'alpha.hypixel.net', brand: null, motd: null };
  const main = { host: 'mc.hypixel.net', brand: null, motd: null };
  const t = Date.now() - 600_000;
  const events = [...fightEvents(t).map((e) => ({ ...e, origin: alpha })), { id: eid(), ts: t, kind: 'COINS', amount: 5, source: 'scavenger', origin: main }];
  const r = await h.batch(u.token, acct('Tester'), events);
  assert.equal(r.status, 200);
  assert.equal(r.body.accepted, 1);
  assert.equal(r.body.ignored, 4);
  // Sent again (the offline queue retrying): still nothing stored, still settled.
  const again = await h.batch(u.token, acct('Tester'), events);
  assert.equal(again.body.ignored, 4);
  assert.equal(h.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n, 1);
  const lines = readdirSync(join(h.dir, 'events')).length;
  assert.ok(lines >= 1);
  await h.close();
});

test('purge only exists in alpha mode', async () => {
  const off = await harness();
  const c1 = await login(off, 'boss');
  assert.equal((await off.app.inject({ method: 'POST', url: '/api/admin/purge', headers: { cookie: c1 }, payload: { confirm: 'PURGE' } })).statusCode, 404);
  await off.close();

  const dir = mkdtempSync(join(tmpdir(), 'arachne-test-'));
  const on = await harness(dir, { alphaMode: true });
  const cookie = await login(on, 'boss');
  const me = on.ctx.auth.listUsers()[0]!;
  const token = on.ctx.auth.createToken(me.id, 'pc', Date.now()).token;
  await on.batch(token, acct('Spider1'), fightEvents(Date.now() - 600_000));
  assert.equal((await on.app.inject({ method: 'POST', url: '/api/admin/purge', headers: { cookie }, payload: { confirm: 'nope' } })).statusCode, 400);
  const r = await on.app.inject({ method: 'POST', url: '/api/admin/purge', headers: { cookie }, payload: { confirm: 'PURGE' } });
  assert.equal(r.statusCode, 200);
  assert.equal(on.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n, 0);
  assert.equal(on.ctx.auth.listUsers().length, 1, 'people stay');
  await on.close();
});

test('link previews: tags in the HTML and a PNG card', async () => {
  const web = mkdtempSync(join(tmpdir(), 'arachne-web-'));
  for (const f of ['index.html', 'landing.html', 'profile.html']) writeFileSync(join(web, f), '<!doctype html><html><head><title>x</title></head><body></body></html>');
  mkdirSync(join(web, 'assets'));
  const h = await harness(undefined, { webDir: web });
  const cookie = await login(h, 'boss');
  await h.app.inject({ method: 'PUT', url: '/api/me/sharing', headers: { cookie }, payload: { publicName: 'boss' } });
  const page = await h.app.inject({ method: 'GET', url: '/u/boss' });
  assert.match(page.body, /<meta property="og:title" content="boss/);
  assert.match(page.body, /og:image" content="http:\/\/localhost:8787\/og\/u\/boss\.png"/);
  const g = (await h.app.inject({ method: 'POST', url: '/api/groups', headers: { cookie }, payload: { name: 'Web <b>', tag: 'web' } })).json();
  const code = (await h.app.inject({ method: 'GET', url: '/api/groups', headers: { cookie } })).json().groups.find((x: { id: number }) => x.id === g.id).code;
  const join_ = await h.app.inject({ method: 'GET', url: `/join/${code}` });
  assert.match(join_.body, /Join \[WEB\] Web &#60;b&#62;/, 'names are escaped');
  const png = await h.app.inject({ method: 'GET', url: '/og/u/boss.png' });
  assert.equal(png.statusCode, 200);
  assert.equal(png.headers['content-type'], 'image/png');
  assert.equal(png.rawPayload.subarray(1, 4).toString(), 'PNG');
  await h.close();
});

test('view as free user: the server answers as for a free account', async () => {
  const h = await harness();
  const cookie = await login(h, 'boss'); // admin, so normally Pro
  const free = { cookie, 'x-view-plan': 'free' };
  assert.equal((await h.app.inject({ method: 'GET', url: '/api/heatmap', headers: { cookie } })).statusCode, 200);
  assert.equal((await h.app.inject({ method: 'GET', url: '/api/heatmap', headers: free })).statusCode, 402, 'Pro pages refused');
  const me = (await h.app.inject({ method: 'GET', url: '/api/me', headers: free })).json();
  assert.equal(me.plan.plan, 'free');
  assert.equal(me.viewingAsFree, true);
  const plan = (await h.app.inject({ method: 'GET', url: '/api/me/plan', headers: free })).json();
  assert.deepEqual(plan.limits, { owned: 1, joined: 3 });
  // Group limits follow the free plan too.
  await h.app.inject({ method: 'POST', url: '/api/groups', headers: free, payload: { name: 'One', tag: 'ONE' } });
  assert.equal((await h.app.inject({ method: 'POST', url: '/api/groups', headers: free, payload: { name: 'Two', tag: 'TWO' } })).statusCode, 402);
  // The header can only lower a plan: admin pages still work for an admin.
  assert.equal((await h.app.inject({ method: 'GET', url: '/api/admin/codes', headers: free })).statusCode, 200);
  await h.close();
});

test('drops: guaranteed drops report an average amount and the wiki range', async () => {
  const h = await harness();
  const cookie = await login(h, 'boss');
  const me = h.ctx.auth.listUsers()[0]!;
  const token = h.ctx.auth.createToken(me.id, 'pc', Date.now()).token;
  const t = Date.now() - 60 * 60_000;
  const spawn = (ev: { kind: string }[]) => ev.map((e) => (e.kind === 'SPAWN' ? { ...e, tier: 'CALLING' } : e));
  await h.batch(token, acct('A'), [...spawn(fightEvents(t, { loot: [['ESSENCE_SPIDER', 8], ['STRING', 12]] })), ...spawn(fightEvents(t + 60_000, { loot: [['ESSENCE_SPIDER', 8], ['STRING', 18]] }))]);
  const r = (await h.app.inject({ method: 'GET', url: '/api/drop-rates?scope=me', headers: { cookie } })).json();
  const calling = r.tiers.find((x: { tier: string }) => x.tier === 'CALLING');
  const string = calling.items.find((i: { item: string }) => i.item === 'STRING');
  assert.equal(string.perKill, 15);
  assert.deepEqual(string.wikiAmount, { min: 10, max: 20 });
  assert.equal(calling.items.find((i: { item: string }) => i.item === 'ESSENCE_SPIDER').perKill, 8);
  await h.close();
});
