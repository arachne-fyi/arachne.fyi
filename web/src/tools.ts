/*
 * /tools: calculators at live Bazaar prices, plus a viewer for the mod's local.json.
 * Numbers come from /api/public/prices and /api/public/rates (drop rates from real tracked kills).
 */
import { ago, coins, el, int } from './site.ts';

interface Market {
  item: string;
  name: string;
  price: number | null;
  change: number | null;
}
interface Rates {
  tiers: { tier: Tier; kills: number; items: { item: string; name: string; total: number }[] }[];
}
type Tier = 'CALLING' | 'CRYSTAL';
type Kill = { kills: number; value: number } | null;

const CRYSTAL_RECIPE: [string, string, number][] = [
  ['ARACHNE_FRAGMENT', 'Arachne Fragment', 2],
  ['ENCHANTED_SPIDER_EYE', 'Enchanted Spider Eye', 16],
  ['ENCHANTED_STRING', 'Enchanted String', 16],
];
/** Four Arachne's Callings summon the Lv300 boss (SkyBlock wiki). */
const CALLINGS_PER_SUMMON = 4;

const basis = document.getElementById('tools-basis')!;
const count = (input: HTMLInputElement) => Math.max(0, Math.floor(Number(input.value.replace(/[,\s]/g, '')) || 0));

void load();
setupLocal();

async function load() {
  try {
    const [p, r] = await Promise.all([
      fetch('/api/public/prices').then((x) => x.json() as Promise<{ updatedAt: number | null; items: Market[]; crystal: { instant: number }; calling: { instant: number } }>),
      fetch('/api/public/rates').then((x) => x.json() as Promise<Rates>),
    ]);
    if (!p.updatedAt) {
      // Without Bazaar prices every number would be 0 or an NPC price: say so instead.
      basis.textContent = "Bazaar prices haven't loaded yet. They arrive within 5 minutes of the server starting; try again shortly.";
      for (const id of ['compare', 'ticker']) document.getElementById(id)!.replaceChildren(el('p', 'empty', 'Waiting for Bazaar prices.'));
      return;
    }
    const price = new Map(p.items.map((i) => [i.item, i.price ?? 0]));
    const crystalCost = p.crystal.instant;
    const callingPrice = price.get('ARACHNE_KEEPER_FRAGMENT') ?? 0;
    const callingCost = callingPrice > 0 ? callingPrice * CALLINGS_PER_SUMMON : null;
    /** Average loot value of one kill of this tier, at today's instant-sell prices. */
    const perKill = (tier: Tier): Kill => {
      const t = r.tiers.find((x) => x.tier === tier);
      if (!t || t.kills === 0) return null;
      return { kills: t.kills, value: t.items.reduce((sum, i) => sum + (i.total / t.kills) * (price.get(i.item) ?? 0), 0) };
    };
    const crystal = perKill('CRYSTAL');
    const calling = perKill('CALLING');
    basis.textContent = `Bazaar prices from ${ago(p.updatedAt)}. Drop rates from ${int((crystal?.kills ?? 0) + (calling?.kills ?? 0))} real kills tracked by Arachne.fyi users. Instant-sell prices, before Bazaar tax.`;

    // Crystal vs callings: one tile each.
    const tile = (label: string, cost: number | null, kill: Kill) => {
      const box = el('div', 'panel tile');
      box.append(el('span', 'px card-title', label));
      if (cost == null) box.append(el('span', 'muted', 'Not on the Bazaar, so no price.'));
      else if (!kill) box.append(el('span', 'muted', `Costs ${coins(cost)}. Not enough kills tracked to estimate loot.`));
      else {
        const profit = kill.value - cost;
        box.append(
          el('span', `px tile-value ${profit >= 0 ? 'gain' : 'loss'}`, `${profit >= 0 ? '+' : ''}${coins(profit)}`),
          el('span', 'soft small', `a kill: costs ${coins(cost)}, loot about ${coins(kill.value)}`),
          el('span', 'tile-sub', `from ${int(kill.kills)} kills`),
        );
      }
      return box;
    };
    document.getElementById('compare')!.replaceChildren(tile('Crystal (Lv500)', crystalCost > 0 ? crystalCost : null, crystal), tile('Callings (Lv300)', callingCost, calling));

    // What will I make?
    const form = document.getElementById('calc') as HTMLFormElement;
    const out = document.getElementById('calc-out')!;
    const calc = () => {
      const n = count(form.elements.namedItem('kills') as HTMLInputElement);
      const tier = (form.elements.namedItem('tier') as HTMLSelectElement).value as Tier;
      const kill = tier === 'CRYSTAL' ? crystal : calling;
      const cost = tier === 'CRYSTAL' ? crystalCost : callingCost;
      if (!kill || cost == null) {
        out.replaceChildren(el('p', 'empty', 'Not enough data for this summon yet.'));
        return;
      }
      const profit = (kill.value - cost) * n;
      const t = (label: string, value: string, cls = '') => {
        const box = el('div', 'panel tile');
        box.append(el('span', 'tile-label', label), el('span', `px tile-value ${cls}`, value));
        return box;
      };
      out.replaceChildren(t('Loot', coins(kill.value * n)), t('Summons', coins(cost * n)), t('Profit', `${profit >= 0 ? '+' : ''}${coins(profit)}`, `big ${profit >= 0 ? 'gain' : 'loss'}`));
    };
    form.addEventListener('input', calc);
    form.addEventListener('change', calc);
    form.addEventListener('submit', (e) => e.preventDefault());
    calc();

    // Crystal shopping list.
    const mats = document.getElementById('mats') as HTMLFormElement;
    const matsOut = document.getElementById('mats-out')!;
    const list = () => {
      const n = count(mats.elements.namedItem('n') as HTMLInputElement);
      const rows = CRYSTAL_RECIPE.map(([id, name, each]) => row(`${int(each * n)}x ${name}`, coins(each * n * (price.get(id) ?? 0)), 'muted'));
      const total = row('Total', coins(n * crystalCost));
      total.classList.add('total');
      matsOut.replaceChildren(...rows, total);
    };
    mats.addEventListener('input', list);
    mats.addEventListener('submit', (e) => e.preventDefault());
    list();

    // Ticker.
    const ticker = document.getElementById('ticker')!;
    const priced = p.items.filter((i) => i.price != null);
    ticker.replaceChildren(
      ...priced.map((i) => {
        const r = el('div', 'r');
        r.append(el('span', '', i.name));
        const right = el('span', 'px');
        right.append(document.createTextNode(coins(i.price!)));
        if (i.change != null) right.append(el('span', i.change >= 0 ? 'gain small' : 'loss small', `  ${i.change >= 0 ? '▲' : '▼'} ${Math.abs(i.change * 100).toFixed(1)}%`));
        r.append(right);
        return r;
      }),
    );
    if (!priced.length) ticker.replaceChildren(el('p', 'empty', 'No prices yet.'));
  } catch {
    basis.textContent = "Couldn't load prices. Try again in a moment.";
    basis.className = 'lede loss';
    for (const id of ['compare', 'ticker']) document.getElementById(id)!.replaceChildren(el('p', 'empty', 'Not loaded.'));
  }
}

function row(label: string, value: string, valueClass = '') {
  const r = el('div', 'r');
  r.append(el('span', '', label), el('span', valueClass, value));
  return r;
}

// ---- local.json viewer (read in the browser, never uploaded) ------------------------------

interface LocalTotals {
  kills: number;
  lootValue: number;
  coins: number;
  costs: number;
}

function setupLocal() {
  const input = document.getElementById('local-file') as HTMLInputElement;
  const name = document.getElementById('local-name')!;
  const out = document.getElementById('local-out')!;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    name.textContent = file.name;
    try {
      const data = JSON.parse(await file.text()) as { all: LocalTotals; days: Record<string, LocalTotals> };
      if (!data.all || !data.days) throw new Error('not a local.json');
      const profit = (t: LocalTotals) => t.lootValue + t.coins - t.costs;
      const days = Object.entries(data.days)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([d, t]) => [new Date(Number(d) * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), t] as const);
      const line = (label: string, t: LocalTotals) => {
        const r = el('div', 'r');
        const p = profit(t);
        r.append(el('span', 'px', label), el('span', 'muted', `${int(t.kills)} kills`), el('span', `px ${p >= 0 ? 'gain' : 'loss'}`, coins(p)));
        return r;
      };
      const all = line('All time', data.all);
      all.classList.add('total');
      out.replaceChildren(all, ...days.map(([label, t]) => line(label, t)), el('p', 'sec-note', 'Values are what the mod priced each drop at when it dropped.'));
    } catch {
      out.replaceChildren(el('p', 'note bad', "That isn't the mod's local.json."));
    }
  });
}
