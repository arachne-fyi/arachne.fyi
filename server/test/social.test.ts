import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acct, fightEvents, harness } from './helpers.ts';

async function login(h: Awaited<ReturnType<typeof harness>>, name: string) {
  const res = await h.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name } });
  const c = res.headers['set-cookie'];
  return (Array.isArray(c) ? c[0] : c)!.split(';')[0]!;
}

test('progress, feed, reactions, comments, challenges, notifications', async () => {
  const h = await harness();
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body).content);
    return new Response('{}');
  }) as typeof fetch;
  try {
    const cookie = await login(h, 'boss');
    const me = h.ctx.auth.listUsers()[0]!;
    const token = h.ctx.auth.createToken(me.id, 'pc', Date.now()).token;

    // Notifications first, so the rare drop below is posted.
    const bad = await h.app.inject({ method: 'PUT', url: '/api/me/notify', headers: { cookie }, payload: { webhook: 'https://evil.example/x' } });
    assert.equal(bad.statusCode, 400);
    const hook = 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz';
    const ok = await h.app.inject({ method: 'PUT', url: '/api/me/notify', headers: { cookie }, payload: { webhook: hook } });
    assert.equal(ok.statusCode, 200);
    const masked = (await h.app.inject({ method: 'GET', url: '/api/me/notify', headers: { cookie } })).json();
    assert.equal(masked.hasWebhook, true);
    assert.ok(!JSON.stringify(masked).includes('abcdefghij'), 'webhook is not sent back');

    const t = Date.now() - 20 * 60_000;
    await h.batch(token, acct('Spider1'), [...fightEvents(t, { loot: [['TARANTULA_LEGENDARY', 1]] }), ...fightEvents(t + 60_000)]);
    assert.ok(sent.some((m) => m.includes('Tarantula Pet (Legendary)')), 'own rare drop posted');

    const p = (await h.app.inject({ method: 'GET', url: '/api/progress?scope=me', headers: { cookie } })).json();
    assert.equal(p.streak.current, 1);
    assert.equal(p.quests.quests.length, 3);
    assert.ok(p.badges.find((b: { id: string }) => b.id === 'legendary').earned);
    assert.equal(p.collection.find((c: { item: string }) => c.item === 'TARANTULA_LEGENDARY').count, 1);

    const feed = (await h.app.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })).json();
    assert.equal(feed.drops.length, 1);
    assert.equal(feed.dropOfTheWeek.item, 'TARANTULA_LEGENDARY');
    const id = feed.drops[0].id;
    await h.app.inject({ method: 'POST', url: '/api/reactions', headers: { cookie }, payload: { eventId: id, kind: 'fire' } });
    await h.app.inject({ method: 'POST', url: '/api/comments', headers: { cookie }, payload: { target: id, text: 'gg' } });
    const again = (await h.app.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })).json();
    assert.equal(again.drops[0].reactions.fire, 1);
    assert.deepEqual(again.drops[0].mine, ['fire']);
    assert.equal(again.drops[0].comments, 1);

    await h.app.inject({ method: 'POST', url: '/api/challenges', headers: { cookie }, payload: { title: 'Most kills', metric: 'kills', start: t - 60_000, hours: 24 } });
    const ch = (await h.app.inject({ method: 'GET', url: '/api/challenges', headers: { cookie } })).json();
    assert.equal(ch.challenges[0].standings[0].value, 2);

    // Session recap 10+ minutes after the last uptime ends; only once.
    sent.length = 0;
    h.ctx.notifier.tick(Date.now() + 15 * 60_000);
    h.ctx.notifier.tick(Date.now() + 16 * 60_000);
    assert.equal(sent.filter((m) => m.includes('session over')).length, 1);
  } finally {
    globalThis.fetch = realFetch;
    await h.close();
  }
});
