/**
 * Titles people can pick to show next to their name. Each one says how it is unlocked, so
 * new kinds (a badge, an event, one an admin hands out) can be added here without touching
 * the pages that show them. The server checks the unlock; the browser only displays.
 */
export type TitleUnlock =
  | { kind: 'kills'; min: number } // lifetime kills across your accounts
  | { kind: 'badge'; badge: string }; // a Progress badge id

export interface Title {
  id: string;
  name: string;
  unlock: TitleUnlock;
}

export const TITLES: readonly Title[] = [
  { id: 'hatchling', name: 'Hatchling', unlock: { kind: 'kills', min: 0 } },
  { id: 'web-spinner', name: 'Web Spinner', unlock: { kind: 'kills', min: 10 } },
  { id: 'silk-weaver', name: 'Silk Weaver', unlock: { kind: 'kills', min: 50 } },
  { id: 'den-crawler', name: 'Den Crawler', unlock: { kind: 'kills', min: 100 } },
  { id: 'brood-keeper', name: 'Brood Keeper', unlock: { kind: 'kills', min: 250 } },
  { id: 'venom-fang', name: 'Venom Fang', unlock: { kind: 'kills', min: 500 } },
  { id: 'queens-hunter', name: "Queen's Hunter", unlock: { kind: 'kills', min: 1000 } },
  { id: 'sanctuary-warden', name: 'Sanctuary Warden', unlock: { kind: 'kills', min: 2500 } },
  { id: 'arachnes-bane', name: "Arachne's Bane", unlock: { kind: 'kills', min: 5000 } },
];

export const titleById = (id: string | null | undefined) => TITLES.find((t) => t.id === id) ?? null;

/** The kill-rank title, used when someone hasn't picked one. */
export function rankTitleFor(kills: number): Title {
  let best = TITLES[0]!;
  for (const t of TITLES) if (t.unlock.kind === 'kills' && kills >= t.unlock.min && t.unlock.min >= (best.unlock as { min: number }).min) best = t;
  return best;
}

export function isUnlocked(t: Title, have: { kills: number; badges: ReadonlySet<string> }): boolean {
  return t.unlock.kind === 'kills' ? have.kills >= t.unlock.min : have.badges.has(t.unlock.badge);
}
