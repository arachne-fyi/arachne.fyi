/**
 * A month of example data in its own folder (data-example\ by default), for trying the dashboard
 * with something that looks lived in. Your real data\ folder is never touched.
 *
 *   npm run seed-year                          build data-example\ (stops if it already exists)
 *   npm run seed-year -- --replace             delete data-example\ and build it again (stop the server first)
 *   npm run seed-year -- --per-hour 60000000   target group profit per farming hour (default 60M)
 *   npm run seed-year -- --days 365            a whole year instead of 30 days (about 1 GB)
 *   npm run seed-year -- --dir data-example
 *
 * What it makes:
 *   - three people, each with one Minecraft account: Ollie (ollie), Kestrel (Kestrel), Zeph (zeph_)
 *   - one group, Webweavers [WEB], with all three in it. Ollie owns it and is the admin.
 *   - 30 days (or --days) of evening sessions where all three fight the same bosses together, and only Ollie
 *     places the Arachne Crystals (so only Ollie pays for them)
 *   - Bazaar prices every 3 hours for the whole time, drifting a little, so every fight is valued
 *     the same way the live server would value it
 * The drops are tuned so the group makes about --per-hour coins per hour of farming, after
 * crystal costs. The numbers are invented; they are not Hypixel's drop rates.
 *
 * Then open it with start-example.bat (runs on data-example\, sign in as Ollie with the test login).
 * Everything is written through the server's own log and indexer, so `npm run rebuild-index`
 * with DATA_DIR=./data-example rebuilds it to the same numbers.
 */
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CRYSTAL_RECIPE, Event, NPC_PRICES } from '@arachne/shared';
import { loadConfig } from '../src/config.ts';
import { createContext } from '../src/context.ts';
import type { EventLine } from '../src/indexer.ts';
import type { PriceLine } from '../src/prices.ts';
import { TERMS_VERSION } from '../src/platform.ts';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const DIR = opt('dir', 'data-example');
const DAYS = Number(opt('days', '30'));
const REPLACE = args.includes('--replace');
const PER_HOUR = Number(opt('per-hour', '60000000'));
if (!Number.isFinite(DAYS) || DAYS < 1 || !Number.isFinite(PER_HOUR) || PER_HOUR <= 0) {
  console.error('--days and --per-hour must be positive numbers.');
  process.exit(1);
}

// Same .env as the server, but always the example folder: never the real data\.
const config = loadConfig();
const dataDir = resolve(config.dataDir, '..', DIR);
if (dataDir === config.dataDir) {
  console.error(`Refusing to write example data into your real data folder (${dataDir}). Pick another --dir.`);
  process.exit(1);
}
if (existsSync(resolve(dataDir, 'state.db'))) {
  if (!REPLACE) {
    console.error(`${dataDir} already has data. Run again with --replace to delete it and start over.`);
    process.exit(1);
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
    console.log(`Deleted the old example data in ${dataDir}`);
  } catch (err) {
    console.error(`Could not delete ${dataDir}: ${(err as Error).message}. Stop the example server (close start-example.bat) and try again.`);
    process.exit(1);
  }
}

// ---- deterministic randomness, so every run makes the same data --------------------------
let seed = 0x5eed2026;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = (min: number, max: number) => Math.floor(min + random() * (max - min));
const chance = (p: number) => random() < p;
const poisson = (mean: number) => {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = random();
  while (p > limit) {
    k++;
    p *= random();
  }
  return k;
};
let idCounter = 0;
const id = () => `seed${(idCounter++).toString(36).padStart(8, '0')}${rand(0, 1e9).toString(36)}`;

// ---- people, accounts, group --------------------------------------------------------------
const PEOPLE = [
  { name: 'Ollie', discordId: 'dev-ollie', mc: 'ollie', places: true },
  { name: 'Kestrel', discordId: 'dev-kestrel', mc: 'Kestrel', places: false },
  { name: 'Zeph', discordId: 'dev-zeph', mc: 'zeph_', places: false },
] as const;
const uuidOf = (mc: string) => {
  // Stable made-up UUIDs (version 4 shape), so a re-run gives the same accounts.
  let h = 0x811c9dc5;
  const hex: string[] = [];
  for (let i = 0; i < 32; i++) {
    h = Math.imul(h ^ mc.charCodeAt(i % mc.length) ^ i, 0x01000193) >>> 0;
    hex.push((h & 15).toString(16));
  }
  hex[12] = '4';
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

// ---- prices -------------------------------------------------------------------------------
/** Instant-sell price at the start; the sell offer is ~7% higher. */
const BASE: Record<string, number> = {
  ARACHNE_FRAGMENT: 24_000,
  ENCHANTED_STRING: 1_100,
  ENCHANTED_SPIDER_EYE: 1_400,
  STRING: 4,
  SPIDER_EYE: 5,
  ESSENCE_SPIDER: 2_100,
  SOUL_STRING: 185_000,
  BOOSTER_COOKIE: 2_600_000,
};
/** Slow drift (about ±8% over a few months) plus a little noise, different per item. */
const priceAt = (item: string, ts: number, noise: number) => {
  const phase = [...item].reduce((a, c) => a + c.charCodeAt(0), 0);
  const days = ts / 86_400_000;
  return BASE[item]! * (1 + 0.08 * Math.sin((2 * Math.PI * days) / 90 + phase) + noise);
};

const now = Date.now();
const DAY = 86_400_000;
const start = Math.floor((now - DAYS * DAY) / DAY) * DAY; // midnight UTC, DAYS ago
/** Average instant-sell price over the seeded days, so the target holds however the drift falls. */
const AVG: Record<string, number> = {};
for (const item of Object.keys(BASE)) {
  let sum = 0;
  let n = 0;
  for (let ts = start; ts <= now; ts += 3_600_000, n++) sum += priceAt(item, ts, 0);
  AVG[item] = sum / n;
}

// ---- the drops ------------------------------------------------------------------------------
const ARMOR = ['ARACHNE_HELMET', 'ARACHNE_CHESTPLATE', 'ARACHNE_LEGGINGS', 'ARACHNE_BOOTS'];
/** Average value of one kill's drops for one account without Soul String, at the period's average prices. */
const baseKillValue =
  2 * AVG.ARACHNE_FRAGMENT! + // 1-3
  5 * AVG.ENCHANTED_STRING! + // 2-8
  0.7 * 3 * AVG.ENCHANTED_SPIDER_EYE! + // 70%: 1-5
  0.5 * 12 * AVG.ESSENCE_SPIDER! + // 50%: 5-19
  0.06 * NPC_PRICES.ARACHNE_HELMET + // armor: not on the Bazaar, NPC price
  0.03 * NPC_PRICES.ARACHNE_FANG +
  0.012 * NPC_PRICES.TARANTULA_EPIC +
  0.003 * NPC_PRICES.TARANTULA_LEGENDARY +
  0.8 * 1_450; // Scavenger coins: 80%, 400-2,499
const crystalCost = Object.entries(CRYSTAL_RECIPE).reduce((a, [item, qty]) => a + AVG[item]! * qty!, 0);
// Fights take 6-18s, most around 12s (three dice added up), and the group gets ~14% faster
// over the period (1.12x at the start, 0.96x now). 2% of fights drag on 8-25s longer.
const FIGHT_MS = 12_000;
const SKILL_START = 1.12;
const SKILL_END = 0.96;
const SLOW = { chance: 0.02, extraMs: 16_500 };
const fightMean = FIGHT_MS * ((SKILL_START + SKILL_END) / 2) + SLOW.chance * SLOW.extraMs;
// The next boss spawns 18-27s after a death (the crystal's spawn-in), so ~105 fights an hour.
const GAP_MS = 22_500;
const fightsPerHour = 3_600_000 / (fightMean + GAP_MS);
const fightLength = (ts: number) => {
  const skill = SKILL_START + (SKILL_END - SKILL_START) * Math.min(1, Math.max(0, (ts - start) / (now - start)));
  const base = rand(2_000, 6_001) + rand(2_000, 6_001) + rand(2_000, 6_001);
  return Math.round(base * skill) + (chance(SLOW.chance) ? rand(8_000, 25_001) : 0);
};
const AFK = 0.015; // chance an account does no damage on a boss (no kill, no drops)
const killsPerFight = PEOPLE.length * (1 - AFK);
/** Soul String per kill on average, chosen so the group lands on PER_HOUR after crystal costs. */
const soulPerKill = Math.max(0, ((PER_HOUR / fightsPerHour + crystalCost) / killsPerFight - baseKillValue) / AVG.SOUL_STRING!);

function drops(add: (item: string, count: number) => void, coins: (amount: number) => void) {
  add('ARACHNE_FRAGMENT', rand(1, 4));
  add('ENCHANTED_STRING', rand(2, 9));
  if (chance(0.7)) add('ENCHANTED_SPIDER_EYE', rand(1, 6));
  if (chance(0.5)) add('ESSENCE_SPIDER', rand(5, 20));
  const soul = poisson(soulPerKill);
  if (soul > 0) add('SOUL_STRING', soul);
  if (chance(0.06)) add(ARMOR[rand(0, 4)]!, 1);
  if (chance(0.03)) add('ARACHNE_FANG', 1);
  if (chance(0.012)) add('TARANTULA_EPIC', 1);
  if (chance(0.003)) add('TARANTULA_LEGENDARY', 1);
  if (chance(0.8)) coins(rand(400, 2_500));
}

// ---- build it -------------------------------------------------------------------------------

process.env.BAZAAR_ENABLED = '0';
const ctx = createContext({ ...config, dataDir, bazaar: { ...config.bazaar, enabled: false } });
const { db } = ctx;
console.log(`Writing ${DAYS} days of example data to ${dataDir}`);
console.log(`Target ${(PER_HOUR / 1e6).toFixed(1)}M an hour: ${fightsPerHour.toFixed(0)} bosses an hour, ${soulPerKill.toFixed(2)} Soul String a kill on average.`);

// People, plans, consent, accounts and the group, all dated from the first day.
const users = PEOPLE.map((p, i) => {
  const u = ctx.auth.allow(p.discordId, i === 0 ? 'admin' : 'user', start, p.name);
  ctx.auth.login({ id: p.discordId, name: p.name, avatar: null }, start + i * 60_000);
  db.run('INSERT OR REPLACE INTO state.consent (user_id, version, accepted_at, age_ok) VALUES (?, ?, ?, 1)', u.id, TERMS_VERSION, start);
  db.run(
    "INSERT INTO state.plans (user_id, plan, until, source, updated_at) VALUES (?, 'pro', NULL, 'given', ?) ON CONFLICT(user_id) DO UPDATE SET plan = 'pro', until = NULL, source = 'given', updated_at = excluded.updated_at",
    u.id,
    start,
  );
  return { ...p, id: u.id, uuid: uuidOf(p.mc) };
});
const group = db.run(
  'INSERT INTO state.groups (code, name, tag, description, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  'WEBWEB',
  'Webweavers',
  'WEB',
  `Example group: ${DAYS} days of crystal runs. Ollie places the crystals.`,
  users[0]!.id,
  start,
);
const groupId = Number(group.lastInsertRowid);
users.forEach((u, i) =>
  db.run('INSERT INTO state.group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', groupId, u.id, i === 0 ? 'owner' : 'member', start + i * 3_600_000),
);

// Prices every 3 hours, written to the price log and the index before any event is valued.
let snapshots = 0;
for (let ts = start; ts <= now; ts += 3 * 3_600_000) {
  const prices: PriceLine['prices'] = {};
  for (const item of Object.keys(BASE)) {
    const instant = Math.round(priceAt(item, ts, (random() - 0.5) * 0.02));
    prices[item] = [instant, Math.round(instant * 1.07)];
  }
  ctx.prices.record({ ts, prices });
  snapshots++;
}

// Sessions: most evenings (UTC), sometimes two a day, all three together.
const sessions: { from: number; to: number }[] = [];
for (let d = start; d < now; d += DAY) {
  if (!chance(0.82)) continue;
  const count = chance(0.25) ? 2 : 1;
  let from = d + rand(15, 19) * 3_600_000 + rand(0, 60) * 60_000;
  for (let s = 0; s < count; s++) {
    const to = Math.min(from + rand(60, 211) * 60_000, now - 5 * 60_000);
    if (to - from > 10 * 60_000) sessions.push({ from, to });
    from = to + rand(45, 120) * 60_000;
  }
}

// And one that finished a few minutes ago, so "Today" has something in it right after seeding.
const todayStart = Math.floor(now / DAY) * DAY;
if (!sessions.some((x) => x.from >= todayStart) && now - todayStart > 40 * 60_000) {
  sessions.push({ from: Math.max(todayStart, now - 150 * 60_000), to: now - 5 * 60_000 });
}

const lines = new Map(users.map((u) => [u.uuid, [] as EventLine[]]));
let fights = 0;
for (const s of sessions) {
  let spawn = s.from;
  let lastDeath = s.from - 60_000;
  while (spawn < s.to) {
    const death = spawn + fightLength(spawn);
    // The crystal goes down 14-20s before the spawn (most around 17s), after the last boss died.
    const spawnIn = Math.min(rand(7_000, 10_001) + rand(7_000, 10_001), Math.max(1_000, spawn - lastDeath - 500));
    for (const u of users) {
      const out = lines.get(u.uuid)!;
      const fight = id().slice(0, 16);
      // The mod's batches arrive a few seconds after each event; r is that "received" time.
      const push = (e: Record<string, unknown>) => {
        const event = Event.parse({ id: id(), ...e });
        out.push({ r: (event.ts as number) + rand(2_000, 8_000), u: u.id, a: u.uuid, n: u.mc, k: 0, e: event });
      };
      if (u.places) push({ ts: spawn - spawnIn, kind: 'PLACE', item: 'ARACHNE_CRYSTAL', count: 1, fight });
      push({ ts: spawn, kind: 'SPAWN', fight, tier: 'CRYSTAL', confirmed: true });
      push({ ts: death, kind: 'DEATH', fight });
      const damage = chance(AFK) ? 0 : rand(60_000, 900_000);
      push({ ts: death + rand(200, 900), kind: 'DAMAGE', fight, damage });
      if (damage > 0) {
        drops(
          (item, count) => push({ ts: death + rand(900, 4_000), kind: 'LOOT', item, count, source: 'armor_stand', fight }),
          (amount) => push({ ts: death + 300, kind: 'COINS', amount, source: 'scavenger', fight }),
        );
      }
    }
    fights++;
    lastDeath = death;
    // The next crystal goes down right after this boss dies, so its spawn is 18-27s later.
    spawn = death + rand(GAP_MS - 4_500, GAP_MS + 4_500);
  }
}

// Write each account's events day by day: the log file for that day, then the index.
let written = 0;
for (const u of users) {
  const all = lines.get(u.uuid)!.sort((a, b) => a.r - b.r);
  for (let i = 0; i < all.length; ) {
    const day = DayLogDay(all[i]!.r);
    let j = i;
    while (j < all.length && DayLogDay(all[j]!.r) === day) j++;
    const chunk = all.slice(i, j);
    ctx.events.append(chunk, chunk[0]!.r);
    db.tx(() => ctx.indexer.index(u.uuid, chunk, now));
    written += chunk.length;
    i = j;
  }
  const first = all[0]?.r ?? start;
  const last = all.at(-1)?.r ?? start;
  db.run(
    `INSERT INTO state.accounts (uuid, user_id, name, first_seen, last_seen, mod_version, state_json) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uuid) DO UPDATE SET user_id = excluded.user_id, name = excluded.name, first_seen = excluded.first_seen, last_seen = excluded.last_seen`,
    u.uuid,
    u.id,
    u.mc,
    first,
    last,
    '2.0.0-example',
    JSON.stringify({ inArea: false, fighting: false, queued: 0 }),
  );
  console.log(`  ${u.mc}: ${all.length.toLocaleString('en-GB')} events`);
}
ctx.stats.invalidate();

function DayLogDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

// What the dashboard will show, from the server's own numbers.
const accounts = users.map((u) => u.uuid);
const total = ctx.stats.windows(accounts, now).all;
const hours = total.wallUptimeMs / 3_600_000;
console.log('');
console.log(`${sessions.length} sessions, ${fights.toLocaleString('en-GB')} bosses, ${written.toLocaleString('en-GB')} events, ${snapshots} price snapshots.`);
console.log(`All time: ${(total.profit / 1e9).toFixed(2)}B profit over ${hours.toFixed(0)} farming hours = ${(total.profit / hours / 1e6).toFixed(1)}M an hour.`);
console.log(`Sign in as Ollie (places the crystals), Kestrel or Zeph. Group invite code: WEBWEB.`);
db.close();
