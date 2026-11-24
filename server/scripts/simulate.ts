/**
 * Pretends to be several copies of the mod, so the server and dashboard can be exercised
 * without launching Minecraft. Drop rates here are invented for the demo; they are not
 * Hypixel's.
 *
 *   npm run simulate -- --dev                       log in via DEV_AUTH, make a token, backfill 6h, go live
 *   npm run simulate -- --token al_...               use an existing token
 *   npm run simulate -- --dev --accounts 4 --hours 12 --no-live
 */
import { randomUUID, createHash } from 'node:crypto';
import { SCHEMA_VERSION } from '@arachne/shared';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const url = opt('url', 'http://localhost:8787').replace(/\/+$/, '');
const accountCount = Number(opt('accounts', '3'));
const hours = Number(opt('hours', '6'));
const live = !flag('no-live');
const owner = opt('name', 'dev');

/** Stable fake UUIDs, so re-running the simulator reuses the same accounts. */
const fakeUuid = (name: string) => {
  const h = createHash('md5').update(`sim:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const accounts = Array.from({ length: accountCount }, (_, i) => {
  const name = `${owner.slice(0, 8)}_Sim${i + 1}`;
  return { uuid: fakeUuid(name), name };
});

async function getToken(): Promise<string> {
  const given = opt('token', '');
  if (given) return given;
  if (!flag('dev')) throw new Error('Pass --token al_... or --dev (needs DEV_AUTH=1 on the server).');
  const login = await fetch(`${url}/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: owner }),
  });
  if (!login.ok) throw new Error(`dev login failed (${login.status}). Is DEV_AUTH=1 set on the server?`);
  const cookie = login.headers.getSetCookie()[0]!.split(';')[0]!;
  const made = await fetch(`${url}/api/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ label: `simulator ${new Date().toISOString().slice(0, 16)}` }),
  });
  if (!made.ok) throw new Error(`token creation failed (${made.status})`);
  return ((await made.json()) as { token: string }).token;
}

const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));
const frac = (min: number, max: number) => min + Math.random() * (max - min);
const chance = (p: number) => Math.random() < p;
const id = () => randomUUID();

/** One fight's worth of events for one account, with the boss spawning at `spawn`. */
function fight(spawn: number, placesCrystal: boolean, afk: boolean) {
  const fightId = id().slice(0, 12);
  const death = spawn + rand(6_000, 18_000);
  const events: any[] = [];
  if (placesCrystal) events.push({ id: id(), ts: spawn - rand(15_000, 22_000), kind: 'PLACE', item: 'ARACHNE_CRYSTAL', count: 1 });
  events.push({ id: id(), ts: spawn, kind: 'SPAWN', fight: fightId, tier: 'CRYSTAL', confirmed: true });
  events.push({ id: id(), ts: death, kind: 'DEATH', fight: fightId });
  const damage = afk ? 0 : chance(0.04) ? Math.floor(rand(100, 9_000)) : Math.floor(rand(40_000, 900_000));
  events.push({ id: id(), ts: death + rand(200, 900), kind: 'DAMAGE', fight: fightId, damage });
  if (damage >= 10_000) {
    const loot = (item: string, count: number) =>
      events.push({ id: id(), ts: death + rand(900, 4_000), kind: 'LOOT', item, count, source: 'armor_stand', fight: fightId });
    loot('ARACHNE_FRAGMENT', 1 + Math.floor(rand(0, 3)));
    loot('ENCHANTED_STRING', Math.floor(rand(2, 9)));
    if (chance(0.7)) loot('ENCHANTED_SPIDER_EYE', Math.floor(rand(1, 6)));
    if (chance(0.5)) loot('ESSENCE_SPIDER', Math.floor(rand(5, 20)));
    if (chance(0.25)) loot('SOUL_STRING', 1);
    if (chance(0.06)) loot(['ARACHNE_HELMET', 'ARACHNE_CHESTPLATE', 'ARACHNE_LEGGINGS', 'ARACHNE_BOOTS'][Math.floor(rand(0, 4))]!, 1);
    if (chance(0.03)) loot('ARACHNE_FANG', 1);
    if (chance(0.012)) loot('TARANTULA_EPIC', 1);
    if (chance(0.003)) loot('TARANTULA_LEGENDARY', 1);
    if (chance(0.8)) events.push({ id: id(), ts: death + 300, kind: 'COINS', amount: Math.round(rand(400, 2_500)), source: 'scavenger', fight: fightId });
  }
  return { events, death };
}

async function send(token: string, account: { uuid: string; name: string }, events: any[], state?: object) {
  for (let i = 0; i < Math.max(events.length, 1); i += 400) {
    const res = await fetch(`${url}/api/v1/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        schema: SCHEMA_VERSION,
        account,
        mod: { version: 'simulator', minecraft: '26.2' },
        sentAt: Date.now(),
        state,
        events: events.slice(i, i + 400),
      }),
    });
    if (res.status === 429) {
      // The server allows 120 batches a minute per person; a big backfill can hit that.
      await new Promise((r) => setTimeout(r, 2_000));
      i -= 400;
      continue;
    }
    if (!res.ok) throw new Error(`batch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as any;
    if (body.rejected.length) console.warn(`rejected ${body.rejected.length}, first:`, body.rejected[0]);
  }
}

const token = await getToken();
console.log(`Simulating ${accounts.length} account(s) against ${url}`);

// Backfill: each account farms in sessions with breaks, and takes turns placing crystals.
const now = Date.now();
for (const [i, account] of accounts.entries()) {
  const events: any[] = [];
  let t = Math.floor(now - hours * 3_600_000) + rand(0, 20 * 60_000);
  let turn = i;
  while (t < now - 60_000) {
    const sessionEnd = Math.min(t + rand(25, 90) * 60_000, now - 60_000);
    while (t < sessionEnd) {
      const f = fight(t, turn++ % accounts.length === 0, chance(0.03));
      events.push(...f.events);
      t = f.death + rand(18_000, 27_000);
    }
    t += rand(5, 40) * 60_000;
  }
  await send(token, account, events);
  console.log(`  ${account.name}: backfilled ${events.length} events`);
}

if (live) {
  console.log('Live mode: a boss every ~35s. Ctrl+C to stop.');
  let turn = 0;
  for (;;) {
    const spawn = Date.now();
    const placer = turn++ % accounts.length;
    const runs = accounts.map((_, i) => fight(spawn, i === placer, chance(0.05)));
    const longest = Math.max(...runs.map((r) => r.death));
    // Send what has happened so far every few seconds, like the mod's queue does.
    const sent = accounts.map(() => new Set<string>());
    while (Date.now() < longest + 5_000) {
      await new Promise((r) => setTimeout(r, 3_000));
      for (const [i, account] of accounts.entries()) {
        const due = runs[i]!.events.filter((e) => e.ts <= Date.now() && !sent[i]!.has(e.id));
        due.forEach((e) => sent[i]!.add(e.id));
        await send(token, account, due, { inArea: true, fighting: Date.now() < runs[i]!.death, queued: 0 });
      }
    }
    await new Promise((r) => setTimeout(r, rand(12_000, 20_000)));
  }
}
