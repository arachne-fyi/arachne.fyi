import { useSyncExternalStore, type ReactNode } from 'react';
import type { DropRates, Me } from '../api.ts';

/**
 * Free or Pro, as the server told us in /api/me. The server is what actually enforces it:
 * Pro pages answer 402 to everyone else, so a locked chart here never has real data behind it.
 */
type PlanState = NonNullable<Me['plan']>;
let plan: PlanState = { plan: 'free', until: null, source: '' };
const listeners = new Set<() => void>();

export function setPlan(p: PlanState | null): void {
  plan = p ?? { plan: 'free', until: null, source: '' };
  listeners.forEach((l) => l());
}
export const isPro = () => plan.plan === 'pro';
export function usePlan(): PlanState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => plan,
  );
}
export const useIsPro = () => usePlan().plan === 'pro';

/**
 * A Pro chart for someone on the free plan: the real chart, drawn from made-up numbers, with
 * a label saying so and a way to Pro. Nothing is hidden behind it.
 */
export function ProLock({ preview, what }: { preview: ReactNode; what: string }) {
  return (
    <div className="pro-lock">
      <div className="pro-preview" aria-hidden="true" inert>
        {preview}
      </div>
      <div className="pro-cover">
        <span className="pro-tag">Example data</span>
        <p>
          <b>{what}</b> is part of Pro. This is what it looks like, filled with example numbers.
        </p>
        <a className="button primary" href="/pro">
          See Pro
        </a>
      </div>
    </div>
  );
}

// ---- made-up numbers for previews (seeded, so they look the same every time) ----------

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

export function fakeHeatmap() {
  const r = rng(7);
  return Array.from({ length: 168 }, (_, i) => {
    const hour = i % 24;
    const evening = hour >= 16 && hour <= 23 ? 1 : hour < 2 ? 0.7 : 0.25;
    const on = r() < evening;
    const perHour = on ? 3_000_000 + r() * 9_000_000 * evening : null;
    return { profit: perHour ?? 0, uptimeMs: on ? 3_600_000 : 0, perHour };
  });
}

export function fakeCalendar(now = Date.now()) {
  const r = rng(11);
  const today = Math.floor(now / 86_400_000) * 86_400_000;
  return Array.from({ length: 182 }, (_, i) => {
    const on = r() < 0.55;
    return { day: today - (181 - i) * 86_400_000, profit: on ? Math.round(5_000_000 + r() * 60_000_000) : 0, kills: on ? Math.round(10 + r() * 140) : 0 };
  });
}

export function fakeDamage() {
  const r = rng(5);
  return Array.from({ length: 60 }, () => Math.round(180_000 + r() * 520_000));
}

export function fakeWhatIf() {
  return { actual: 182_400_000, INSTANT_SELL: 182_400_000, SELL_OFFER: 197_900_000, NPC: 61_300_000 };
}

export function fakeDropRates(): DropRates {
  const items = (rows: [string, string, number, number | null][], kills: number) =>
    rows.map(([item, name, rate, wiki]) => ({ item, name, fights: Math.round(rate * kills), total: Math.round(rate * kills), rate, wiki, perKill: rate, wikiAmount: null as { min: number; max: number } | null }));
  return {
    tiers: [
      {
        tier: 'CALLING',
        kills: 840,
        luck: 1.08,
        items: items(
          [
            ['ARACHNE_FRAGMENT', "Arachne's Fragment", 0.27, 0.25],
            ['ARACHNE_FANG', "Arachne's Fang", 0.09, 0.1],
            ['TARANTULA_EPIC', 'Tarantula Pet (Epic)', 0.024, 0.02],
          ],
          840,
        ),
      },
      {
        tier: 'CRYSTAL',
        kills: 410,
        luck: 0.94,
        items: items(
          [
            ['ARACK', 'Arack', 0.23, 0.25],
            ['ARACHNE_HELMET', 'Arachne Helmet', 0.24, 0.25],
            ['ARACHNE_BOOTS', 'Arachne Boots', 0.26, 0.25],
          ],
          410,
        ).concat([
          { item: 'ESSENCE_SPIDER', name: 'Spider Essence', fights: 410, total: 12300, rate: 1, wiki: null, perKill: 30, wikiAmount: { min: 30, max: 30 } },
          { item: 'SOUL_STRING', name: 'Soul String', fights: 410, total: 9020, rate: 1, wiki: null, perKill: 22, wikiAmount: { min: 1, max: 44 } },
        ]),
      },
    ],
  };
}
