/* Data helpers for the new dashboard: one place that turns the server's replies into what the pages show. */
import type { Totals } from '@arachne/shared';
import { request, viewingAs, type AccountCard, type FeedEvent, type Fight, type LootRow, type Me, type Series } from '../api.ts';
import type { Group } from '../platform-api.ts';

export type User = NonNullable<Me['user']>;
export type Win = 'today' | 'week' | 'all';
export const WINDOWS: readonly (readonly [Win, string])[] = [
  ['today', 'Today'],
  ['week', '7 days'],
  ['all', 'All time'],
];
export const WIN_WORDS: Record<Win, string> = { today: 'today', week: 'last 7 days', all: 'all time' };

export const SOUL = 'SOUL_STRING';
export const ESSENCE = 'ESSENCE_SPIDER';

/** Loot for a group's (visible) members. The server checks you are in the group. */
export const groupLoot = (window: Win, group: number) => request<{ loot: LootRow[] }>('GET', `/api/loot?window=${window}&group=${group}`);

/** The person the page is about: you, or who an admin is viewing as. */
export const meId = (user: User) => viewingAs()?.id ?? user.id;

export const EMPTY: Totals = { kills: 0, fights: 0, crystals: 0, callings: 0, lootValue: 0, coins: 0, costs: 0, profit: 0, uptimeMs: 0, wallUptimeMs: 0, profitPerClientHour: 0, profitPerWallHour: 0 };

export const lootOf = (rows: LootRow[] | undefined, item: string) => rows?.find((r) => r.item === item) ?? { item, name: '', count: 0, value: 0 };

// ---- selected group (remembered in this browser) ----
const GROUP_KEY = 'arachne-group';
export function savedGroup(): number | null {
  try {
    const n = Number(localStorage.getItem(GROUP_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
export function saveGroup(id: number) {
  try {
    localStorage.setItem(GROUP_KEY, String(id));
  } catch {
    /* not remembered */
  }
}
export const pickGroup = (groups: Group[], want: number | null) => groups.find((g) => g.id === want) ?? groups[0] ?? null;

// ---- "View as new user": the first-run screens, without touching your data ----
export const previewNew = () => sessionStorage.getItem('previewNew') === '1';
export function setPreviewNew(on: boolean) {
  if (on) sessionStorage.setItem('previewNew', '1');
  else sessionStorage.removeItem('previewNew');
  window.location.href = '/';
}

// ---- live state ----
export interface LiveFight {
  account: string;
  accountName: string;
  startedAt: number;
}

/** Spawns with no death or interrupt after them, from the last 5 minutes. Newest first. */
export function openFights(events: FeedEvent[], now: number): LiveFight[] {
  const ended = new Set(events.filter((e) => e.kind === 'DEATH' || e.kind === 'INTERRUPT').map((e) => `${e.account}:${e.fight}`));
  const seen = new Set<string>();
  const out: LiveFight[] = [];
  for (const e of [...events].sort((a, b) => b.ts - a.ts)) {
    if (e.kind !== 'SPAWN' || seen.has(e.account) || now - e.ts > 5 * 60_000 || ended.has(`${e.account}:${e.fight}`)) continue;
    seen.add(e.account);
    out.push({ account: e.account, accountName: e.accountName, startedAt: e.ts });
  }
  return out;
}

export interface Kill {
  key: string;
  ts: number;
  account: string;
  accountName: string;
  tier: Fight['tier'];
  durationMs: number | null;
  soul: number;
  essence: number;
  coins: number;
  /** Loot value plus scavenger coins (summon costs not taken off). */
  value: number;
  items: number;
}

/** Counted fights with what each one dropped (from the events we have). Newest first. */
export function killsOf(fights: Fight[], events: FeedEvent[], accounts: Set<string> | null): Kill[] {
  const byFight = new Map<string, FeedEvent[]>();
  for (const e of events) {
    if (!e.fight || (e.kind !== 'LOOT' && e.kind !== 'COINS')) continue;
    const k = `${e.account}:${e.fight}`;
    byFight.set(k, [...(byFight.get(k) ?? []), e]);
  }
  return fights
    .filter((f) => f.outcome === 'COUNTED' && (!accounts || accounts.has(f.account)))
    .sort((a, b) => b.ts - a.ts)
    .map((f) => {
      const ev = byFight.get(`${f.account}:${f.fight}`) ?? [];
      const k: Kill = { key: `${f.account}:${f.fight}`, ts: f.ts, account: f.account, accountName: f.accountName, tier: f.tier, durationMs: f.durationMs, soul: 0, essence: 0, coins: 0, value: 0, items: 0 };
      for (const e of ev) {
        k.value += e.value;
        if (e.kind === 'COINS') k.coins += e.value;
        else if (e.item === SOUL) k.soul += e.count;
        else if (e.item === ESSENCE) k.essence += e.count;
        else k.items += 1;
      }
      return k;
    });
}

export const tierWord = (t: Fight['tier']) => (t === 'CRYSTAL' ? 'Crystal' : t === 'CALLING' ? 'Callings' : 'Summon');

/** Accounts belonging to these people. */
export const accountsOf = (accounts: AccountCard[] | undefined, users: Set<number>) => (accounts ?? []).filter((a) => a.userId != null && users.has(a.userId));

/** Each bucket summed over these accounts. */
export function sumSeries(s: Series | undefined, uuids: Set<string>, key: 'profit' | 'kills' | 'coins' | 'loot' = 'profit'): number[] {
  if (!s) return [];
  const out = new Array<number>(s.buckets).fill(0);
  for (const a of s.accounts) if (uuids.has(a.uuid)) a[key].forEach((v, i) => (out[i]! += v));
  return out;
}

export const startOfUtcDay = (now: number) => Math.floor(now / 86_400_000) * 86_400_000;

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** "1:42" or "1h 02m" for a running timer. */
export function timer(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What an account is doing now, in words. */
export function accountState(a: AccountCard, fight: LiveFight | undefined): { on: boolean; words: string } {
  if (fight) return { on: true, words: 'in a fight' };
  if (a.online && a.state?.inArea) return { on: true, words: 'in the Sanctuary' };
  if (a.online) return { on: true, words: 'online' };
  return { on: false, words: '' };
}

/** "1.5m" → 1500000. Empty or nonsense → 0. */
export function parseCoins(text: string): number {
  const m = /^\s*([\d.,]+)\s*([kmb]?)\s*$/i.exec(text);
  if (!m) return 0;
  const n = Number(m[1]!.replace(/,/g, ''));
  const mult = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]!.toLowerCase() as '' | 'k' | 'm' | 'b'];
  return Number.isFinite(n) ? Math.round(n * mult) : 0;
}
