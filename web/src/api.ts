import type { Totals, WindowTotals } from '@arachne/shared';

/**
 * Typed wrappers around the server's JSON API. The shapes mirror what
 * `server/src/app.ts` returns; when a route changes, change it here too.
 */

export interface Me {
  user: { id: number; discordId: string; name: string; avatar: string | null; role: 'admin' | 'user' } | null;
  plan: { plan: 'free' | 'pro'; until: number | null; source: string } | null;
  consent: { version: string; accepted: boolean } | null;
  openSignup: boolean;
  viewingAsFree?: boolean;
  /** Test server: the Admin page offers to wipe all data. */
  alphaMode?: boolean;
  devAuth: boolean;
  discord: boolean;
}

export interface AccountCard {
  uuid: string;
  name: string;
  userId: number | null;
  owner: string;
  priceMode: 'INSTANT_SELL' | 'SELL_OFFER' | 'NPC';
  ironman: boolean;
  modVersion: string | null;
  firstSeen: number;
  lastSeen: number;
  online: boolean;
  up: boolean;
  state: { inArea: boolean; fighting: boolean; queued: number } | null;
  totals: WindowTotals;
}

export interface DryStreak {
  item: string;
  name: string;
  /** Kills since it last dropped (or since the first kill, if it never has). */
  current: number;
  longest: number;
  dropped: number;
  lastAt: number | null;
}

export interface Insights {
  yesterday: Totals;
  daysFarmed: number;
  dry: DryStreak[];
  recentKills: { ts: number; value: number }[];
  downtime: { averageMs: number | null; gaps: number };
}

export interface Records {
  bestHour: { at: number; value: number } | null;
  bestDay: { at: number; value: number } | null;
  bestFight: { at: number; value: number; account: string } | null;
  mostKillsDay: { at: number; value: number } | null;
  fastestKill: { ms: number; at: number | null } | null;
  longestSession: { ms: number; at: number } | null;
  dry: DryStreak[];
  lifetime: Totals & { daysFarmed: number };
}

export interface DropRates {
  tiers: {
    tier: 'CALLING' | 'CRYSTAL';
    kills: number;
    /** Drops seen / drops the wiki's base chances predict. 1 = exactly as expected. */
    luck: number | null;
    items: { item: string; name: string; fights: number; total: number; rate: number; wiki: number | null; perKill: number; wikiAmount: { min: number; max: number } | null }[];
  }[];
}

export interface MarketRow {
  item: string;
  name: string;
  price: number | null;
  /** 0.05 = up 5% in 24 hours. */
  change: number | null;
  at: number | null;
  spread?: number | null;
  /** Where today's price sits in the last 30 days: 0 lowest, 1 highest. */
  percentile?: number | null;
}

export interface Progress {
  streak: { current: number; best: number; farmedToday: boolean };
  quests: { weekStart: number; endsAt: number; quests: { id: string; text: string; goal: number; progress: number; done: boolean }[] };
  badges: { id: string; name: string; how: string; earned: boolean }[];
  collection: { item: string; name: string; rarity: string; count: number; first: number | null }[];
}

export type ReactionKind = 'fire' | 'clap' | 'cry' | 'spider';

export interface FeedDrop {
  id: string;
  ts: number;
  account: string;
  accountName: string;
  owner: string;
  item: string;
  name: string;
  count: number;
  value: number;
  reactions: Record<ReactionKind, number>;
  mine: ReactionKind[];
  comments: number;
}

export interface Challenge {
  id: number;
  title: string;
  metric: 'kills' | 'profit' | 'crystals';
  start: number;
  end: number;
  by: string;
  createdBy: number;
  standings: { name: string; value: number }[];
}

export interface Notify {
  webhook: string;
  hasWebhook: boolean;
  minCoins: number;
  rare: boolean;
  recap: boolean;
  dry: boolean;
  offline: boolean;
  digest: boolean;
  quietFrom: number;
  quietTo: number;
}

export interface Storage {
  events: number;
  prices: number;
  indexDb: number;
  stateDb: number;
  downloads: number;
  backups: number;
  eventCount: number;
  lastBackup: { file: string; at: number; size: number } | null;
  webhook: boolean;
  hidden: number[];
  ingest: { since: number; batches: number; accepted: number; duplicates: number; rejected: number; lastMinute: number };
  priceGaps: { from: number; to: number }[];
}

export interface Overview {
  serverTime: number;
  insights: Insights;
  totals: { group: WindowTotals; user: WindowTotals };
  accounts: AccountCard[];
  online: number;
  pricesUpdatedAt: number;
  /** What one Booster Cookie instantly sells for, or null before the first Bazaar snapshot. */
  cookieCoins: number | null;
}

export interface Series {
  range: '24h' | '7d' | '30d' | 'session';
  from: number;
  to: number;
  bucketMs: number;
  buckets: number;
  /** Only for 'session': true when nobody has farmed yet (the data is then the last day). */
  empty?: boolean;
  accounts: {
    uuid: string;
    name: string;
    profit: number[];
    loot: number[];
    coins: number[];
    costs: number[];
    crystals: number[];
    kills: number[];
    uptimeMs: number[];
    segments: { start: number; end: number }[];
  }[];
  wallUptimeMs: number[];
}

export interface FeedEvent {
  id: string;
  ts: number;
  receivedAt: number;
  account: string;
  accountName: string;
  kind: 'SPAWN' | 'DEATH' | 'DAMAGE' | 'INTERRUPT' | 'PLACE' | 'LOOT' | 'COINS';
  fight: string | null;
  item: string | null;
  itemName: string | null;
  count: number;
  value: number;
  source: string | null;
  damage: number | null;
}

export interface Fight {
  account: string;
  accountName: string;
  fight: string;
  ts: number;
  tier: 'CRYSTAL' | 'CALLING' | 'UNKNOWN';
  confirmed: boolean;
  damage: number | null;
  durationMs: number | null;
  outcome: 'COUNTED' | 'LOW_DAMAGE' | 'ZERO_DAMAGE' | 'MISSING_DAMAGE' | 'INTERRUPTED' | 'OPEN';
}

export interface LootRow {
  item: string;
  name: string;
  count: number;
  value: number;
}

export interface LeaderRow {
  userId: number;
  name: string;
  accounts: number;
  totals: Totals;
  rngDrops: number;
  /** All-time drops seen / drops the wiki predicts; null with too few kills. */
  luck: number | null;
}

export interface PriceRow {
  item: string;
  name: string;
  instant: number | null;
  offer: number | null;
  npc: number | null;
}

export interface TokenRow {
  id: number;
  label: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface AdminUser {
  id: number;
  discordId: string;
  name: string;
  avatar: string | null;
  role: 'admin' | 'user';
  disabled: boolean;
  accounts: string[];
  tokens: number;
  lastLoginAt: number | null;
  hidden?: boolean;
  accountInfo: { name: string; modVersion: string | null; lastSeen: number }[];
  tokenInfo: { id: number; label: string; prefix: string; lastUsedAt: number | null }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Admin "view as": set while an admin looks at the site as someone else. */
export function viewingAs(): { id: number; name: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem('viewAs') ?? 'null') as { id: number; name: string } | null;
  } catch {
    return null;
  }
}
export function setViewingAs(v: { id: number; name: string } | null) {
  if (v) sessionStorage.setItem('viewAs', JSON.stringify(v));
  else sessionStorage.removeItem('viewAs');
  window.location.href = '/';
}

/** "View as free user": this tab asks the server to answer as if your plan were Free. */
export const viewingAsFree = () => sessionStorage.getItem('viewFree') === '1';
export function setViewingAsFree(on: boolean) {
  if (on) sessionStorage.setItem('viewFree', '1');
  else sessionStorage.removeItem('viewFree');
  window.location.reload();
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const as = viewingAs();
  // Reads only, and never the admin pages or who-am-I.
  if (as && method === 'GET' && !path.startsWith('/api/admin') && path !== '/api/me') {
    path += `${path.includes('?') ? '&' : '?'}as=${as.id}`;
  }
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body === undefined || body instanceof Blob ? {} : { 'content-type': 'application/json' }),
      // Only ever lowers the plan; the server answers exactly as it would for a free account.
      ...(viewingAsFree() ? { 'x-view-plan': 'free' } : {}),
    },
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `http_${res.status}`);
  return data as T;
}

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  versions: () =>
    request<{ versions: { minecraft: string; builds: { file: string; mod: string; size: number; uploadedAt: number; sha256: string }[] }[] }>(
      'GET',
      '/api/public/versions',
    ),
  devLogin: (name: string) => request<{ ok: true }>('POST', '/auth/dev-login', { name }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
  overview: (scope: 'group' | 'user' = 'group') => request<Overview>('GET', `/api/overview?scope=${scope}`),
  records: (scope: 'group' | 'me') => request<Records>('GET', `/api/records?scope=${scope}`),
  dropRates: (scope: 'group' | 'me') => request<DropRates>('GET', `/api/drop-rates?scope=${scope}`),
  heatmap: (scope: 'group' | 'me', days: number) =>
    request<{ from: number; cells: { profit: number; uptimeMs: number; perHour: number | null }[] }>('GET', `/api/heatmap?scope=${scope}&days=${days}`),
  calendar: (scope: 'group' | 'me') => request<{ days: { day: number; profit: number; kills: number }[] }>('GET', `/api/calendar?scope=${scope}`),
  whatIf: (scope: 'group' | 'me', days: number) =>
    request<{ actual: number; INSTANT_SELL: number; SELL_OFFER: number; NPC: number }>('GET', `/api/whatif?scope=${scope}&days=${days}`),
  damage: (scope: 'group' | 'me', days: number) => request<{ values: number[] }>('GET', `/api/damage?scope=${scope}&days=${days}`),
  priceHistory: (item: string, days: number) =>
    request<{ item: string; points: { t: number; instant: number | null; offer: number | null }[] }>('GET', `/api/prices/history?item=${item}&days=${days}`),
  movers: () => request<{ items: MarketRow[] }>('GET', '/api/prices/movers'),
  progress: (scope: 'group' | 'me') => request<Progress>('GET', `/api/progress?scope=${scope}`),
  feed: () =>
    request<{ dropOfTheWeek: { account: string; item: string; name: string; count: number; value: number; ts: number; id: string } | null; drops: FeedDrop[] }>(
      'GET',
      '/api/feed',
    ),
  react: (eventId: string, kind: ReactionKind) => request<{ ok: true; on: boolean }>('POST', '/api/reactions', { eventId, kind }),
  comments: (target: string) =>
    request<{ comments: { id: number; userId: number; by: string; text: string; ts: number }[] }>('GET', `/api/comments?target=${encodeURIComponent(target)}`),
  comment: (target: string, text: string) => request<{ ok: true }>('POST', '/api/comments', { target, text }),
  deleteComment: (id: number) => request<{ ok: true }>('DELETE', `/api/comments/${id}`),
  challenges: () => request<{ challenges: Challenge[] }>('GET', '/api/challenges'),
  createChallenge: (c: { title: string; metric: Challenge['metric']; start: number; hours: number }) => request<{ ok: true }>('POST', '/api/challenges', c),
  deleteChallenge: (id: number) => request<{ ok: true }>('DELETE', `/api/challenges/${id}`),
  notify: () => request<Notify>('GET', '/api/me/notify'),
  saveNotify: (n: Partial<Notify>) => request<{ ok: true }>('PUT', '/api/me/notify', n),
  pushKey: () => request<{ publicKey: string; ready: boolean; subscriptions: number }>('GET', '/api/push/key'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => request<{ ok: true }>('POST', '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => request<{ ok: true }>('POST', '/api/push/unsubscribe', { endpoint }),
  testNotify: () => request<{ ok: true }>('POST', '/api/me/notify/test', {}),
  pairCode: () => request<{ code: string; expiresAt: number; endpoint?: string }>('POST', '/api/pair-code', {}),
  sharing: () => request<{ overlayKey: string | null; publicName: string | null; base: string }>('GET', '/api/me/sharing'),
  setSharing: (patch: { overlay?: 'new' | 'off'; publicName?: string }) => request<{ ok: true }>('PUT', '/api/me/sharing', patch),
  wrapped: (year: number) =>
    request<{
      year: number;
      totals: Totals;
      days: number;
      bestMonth: { month: number; profit: number } | null;
      favouriteHour: number | null;
      bestDrop: { item: string; name: string; value: number; ts: number } | null;
      badges: number;
    }>('GET', `/api/wrapped?year=${year}`),
  teamGoal: () => request<{ goal: number; from: number; profit: number }>('GET', '/api/team-goal'),
  setTeamGoal: (goal: number) => request<{ ok: true }>('PUT', '/api/admin/team-goal', { goal }),
  announcement: () => request<{ announcement: { text: string; at: number; by: string } | null }>('GET', '/api/announcement'),
  setAnnouncement: (text: string) => request<{ ok: true }>('PUT', '/api/admin/announcement', { text }),
  adminRequests: () =>
    request<{ requests: { discordId: string; name: string; avatar: string | null; firstAt: number; lastAt: number }[] }>('GET', '/api/admin/requests'),
  adminRequest: (discordId: string, action: 'approve' | 'dismiss') => request<{ ok: true }>('POST', `/api/admin/requests/${discordId}/${action}`, {}),
  adminAudit: () => request<{ entries: { id: number; ts: number; by: string; action: string; detail: string }[] }>('GET', '/api/admin/audit'),
  adminStorage: () => request<Storage>('GET', '/api/admin/storage'),
  adminBackup: () => request<{ lastBackup: Storage['lastBackup']; checkedUsers: number }>('POST', '/api/admin/backup', {}),
  adminHide: (id: number, hidden: boolean) => request<{ ok: true }>('PUT', `/api/admin/users/${id}/hidden`, { hidden }),
  adminSuspicious: () => request<{ items: { kind: string; account: string; ts: number; detail: string }[] }>('GET', '/api/admin/suspicious'),
  adminRebuild: () => request<{ events: number }>('POST', '/api/admin/rebuild', {}),
  adminRevokeToken: (id: number) => request<{ ok: true }>('DELETE', `/api/admin/tokens/${id}`),
  series: (range: Series['range']) => request<Series>('GET', `/api/series?range=${range}`),
  events: (limit = 80) => request<{ events: FeedEvent[] }>('GET', `/api/events?limit=${limit}`),
  fights: (limit = 60) => request<{ fights: Fight[] }>('GET', `/api/fights?limit=${limit}`),
  loot: (window: string, scope: 'group' | 'me') => request<{ loot: LootRow[] }>('GET', `/api/loot?window=${window}&scope=${scope}`),
  lootSince: (since: number) => request<{ loot: LootRow[] }>('GET', `/api/loot?since=${since}`),
  leaderboard: (window: string) => request<{ rows: LeaderRow[] }>('GET', `/api/leaderboard?window=${window}`),
  prices: () =>
    request<{ updatedAt: number; items: PriceRow[]; crystalCost: { instant: number; offer: number; npc: number } }>('GET', '/api/prices'),
  patchAccount: (uuid: string, patch: { priceMode?: AccountCard['priceMode']; ironman?: boolean }) =>
    request<{ ok: true }>('PATCH', `/api/accounts/${uuid}`, patch),
  tokens: () => request<{ tokens: TokenRow[]; endpoint: string }>('GET', '/api/tokens'),
  createToken: (label: string) => request<{ id: number; token: string }>('POST', '/api/tokens', { label }),
  revokeToken: (id: number) => request<{ ok: true }>('DELETE', `/api/tokens/${id}`),
  adminUsers: () => request<{ users: AdminUser[] }>('GET', '/api/admin/users'),
  adminAllow: (discordId: string, role: 'admin' | 'user') => request<{ user: AdminUser }>('POST', '/api/admin/users', { discordId, role }),
  adminPatch: (id: number, patch: { role?: 'admin' | 'user'; disabled?: boolean }) =>
    request<{ ok: true }>('PATCH', `/api/admin/users/${id}`, patch),
  mod: () => request<{ jar: { file: string; size: number; updatedAt: number } | null }>('GET', '/api/public/mod'),
  uploadJar: (file: File) =>
    request<{ jar: { file: string } }>('PUT', `/api/admin/mod-jar/${encodeURIComponent(file.name)}`, new Blob([file], { type: 'application/java-archive' })),
};

/** Links that download a file (CSV / JSON); the browser handles them, no fetch needed. */
export const exportUrl = {
  drops: (scope: 'group' | 'me') => `/api/export/drops.csv?scope=${scope}`,
  fights: (scope: 'group' | 'me') => `/api/export/fights.csv?scope=${scope}`,
  everything: '/api/export/me.json',
};
