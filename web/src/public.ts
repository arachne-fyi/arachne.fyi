/*
 * Script for the public pages: the landing page, /download, /help, /status and /tools. Plain DOM, no React:
 * they are tiny and should load instantly.
 */
import './styles.css';
import { ago, bytes, coins } from './format.ts';
import { startChrome } from './chrome.ts';
import { CHANGELOG } from './changelog.ts';

startChrome();

// The dashboard lives on app.<domain>. Locally (localhost) it is the same site.
const host = location.hostname;
const dashboard = host === 'localhost' || host === '127.0.0.1' || host.startsWith('app.') ? '/' : `${location.protocol}//app.${host}`;
document.querySelectorAll<HTMLAnchorElement>('a.dashboard-link').forEach((a) => (a.href = dashboard));

const list = document.getElementById('versions');
if (list) void showVersions(list);
const status = document.getElementById('status');
if (status) void showStatus(status);
if (document.getElementById('compare')) void showTools();
const localFile = document.getElementById('local-file') as HTMLInputElement | null;
if (localFile) localFile.addEventListener('change', () => void showLocal(localFile));
if (document.getElementById('overlay')) startOverlay();
const globalBox = document.getElementById('global');
if (globalBox) void showGlobal(globalBox);
const changelogBox = document.getElementById('changelog');
if (changelogBox) showChangelog(changelogBox);
const profileBox = document.getElementById('profile');
if (profileBox) void showProfile(profileBox);

interface Build {
  file: string;
  mod: string;
  size: number;
  uploadedAt: number;
  sha256?: string;
}

async function showVersions(target: HTMLElement) {
  try {
    const res = await fetch('/api/public/versions');
    const { versions } = (await res.json()) as { versions: { minecraft: string; builds: Build[] }[] };
    target.replaceChildren();
    if (versions.length === 0) {
      target.append(el('p', 'empty', 'No builds yet. Check back soon.'));
      return;
    }
    for (const group of versions) {
      const panel = el('section', 'panel');
      const header = el('header');
      header.append(el('h2', '', group.minecraft === 'Other' ? 'Other builds' : `Minecraft ${group.minecraft}`));
      panel.append(header);
      group.builds.forEach((build, i) => panel.append(buildRow(build, i === 0)));
      target.append(panel);
    }
  } catch {
    target.replaceChildren(el('p', 'note bad', 'Could not load the list. Try again in a moment.'));
  }
}

/** One build: version, size, age and a download button. The newest one is highlighted. */
function buildRow(build: Build, newest: boolean) {
  const row = el('div', 'row');
  row.style.cssText = 'justify-content: space-between; align-items: center; padding: 8px 0; border-top: 1px solid var(--line)';
  const info = el('div');
  info.append(el('div', '', `Version ${build.mod}${newest ? ' (newest)' : ''}`));
  info.append(el('div', 'faint', `${bytes(build.size)}, ${ago(build.uploadedAt)}`));
  if (build.sha256) {
    // The checksum lets careful people check the file is the one the admin uploaded.
    const sum = el('button', 'checksum', `SHA-256 ${build.sha256.slice(0, 12)}…`) as HTMLButtonElement;
    sum.type = 'button';
    sum.title = `${build.sha256}\nClick to copy`;
    sum.onclick = () =>
      void navigator.clipboard.writeText(build.sha256!).then(
        () => (sum.textContent = 'Copied'),
        () => (sum.textContent = build.sha256!),
      );
    info.append(sum);
  }
  const link = el('a', newest ? 'button primary' : 'button', 'Download') as HTMLAnchorElement;
  link.href = `/download/files/${encodeURIComponent(build.file)}`;
  link.setAttribute('download', build.file);
  row.append(info, link);
  return row;
}

interface Status {
  ok: boolean;
  serverTime: number;
  lastEventAt: number | null;
  pricesUpdatedAt: number | null;
  online: number;
  kills: number;
  tracked: number;
}

async function showStatus(target: HTMLElement) {
  const line = document.getElementById('status-line')!;
  const row = (label: string, value: string, tone = '') => {
    target.append(el('dt', '', label), el('dd', tone, value));
  };
  try {
    const res = await fetch('/api/public/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const s = (await res.json()) as Status;
    line.textContent = 'Up and running.';
    line.className = 'gain';
    target.replaceChildren();
    row('Last data from a mod', s.lastEventAt ? ago(s.lastEventAt) : 'never');
    row('Bazaar prices', s.pricesUpdatedAt ? `updated ${ago(s.pricesUpdatedAt)}` : 'not loaded yet', s.pricesUpdatedAt && Date.now() - s.pricesUpdatedAt > 30 * 60_000 ? 'loss' : '');
    row('Accounts online', String(s.online));
    row('Kills tracked', s.kills.toLocaleString('en-GB'));
    row('Coins tracked', coins(s.tracked));
  } catch {
    line.textContent = "The server isn't answering. It may be restarting, or the PC it runs on is off.";
    line.className = 'loss';
  }
}

// ---- /tools -------------------------------------------------------------------------

interface Market {
  item: string;
  name: string;
  price: number | null;
  change: number | null;
}
interface Rates {
  tiers: { tier: 'CALLING' | 'CRYSTAL'; kills: number; items: { item: string; name: string; total: number }[] }[];
}

const CRYSTAL_RECIPE: [string, string, number][] = [
  ['ARACHNE_FRAGMENT', 'Arachne Fragment', 2],
  ['ENCHANTED_SPIDER_EYE', 'Enchanted Spider Eye', 16],
  ['ENCHANTED_STRING', 'Enchanted String', 16],
];
/** Four Arachne's Callings summon the Lv300 boss (SkyBlock wiki). */
const CALLINGS_PER_SUMMON = 4;

async function showTools() {
  const basis = document.getElementById('tools-basis')!;
  try {
    const [p, r] = await Promise.all([
      fetch('/api/public/prices').then((x) => x.json() as Promise<{ updatedAt: number | null; items: Market[]; crystal: { instant: number }; calling: { instant: number } }>),
      fetch('/api/public/rates').then((x) => x.json() as Promise<Rates>),
    ]);
    if (!p.updatedAt) {
      // Without Bazaar prices every number below would be 0 or an NPC price: say so instead.
      basis.textContent = "Bazaar prices haven't loaded yet. They arrive within 5 minutes of the server starting; try again shortly.";
      return;
    }
    const price = new Map(p.items.map((i) => [i.item, i.price ?? 0]));
    const crystalCost = p.crystal.instant;
    const callingPrice = price.get('ARACHNE_KEEPER_FRAGMENT') ?? 0;
    const callingCost = callingPrice > 0 ? callingPrice * CALLINGS_PER_SUMMON : null;
    /** Average loot value of one kill of this tier, at today's instant-sell prices. */
    const perKill = (tier: 'CALLING' | 'CRYSTAL') => {
      const t = r.tiers.find((x) => x.tier === tier);
      if (!t || t.kills === 0) return null;
      return { kills: t.kills, value: t.items.reduce((sum, i) => sum + (i.total / t.kills) * (price.get(i.item) ?? 0), 0) };
    };
    const crystal = perKill('CRYSTAL');
    const calling = perKill('CALLING');
    basis.textContent = `Bazaar prices ${p.updatedAt ? `from ${ago(p.updatedAt)}` : 'not loaded yet'}. Drop rates from ${(
      (crystal?.kills ?? 0) + (calling?.kills ?? 0)
    ).toLocaleString('en-GB')} real kills tracked by Arachne.fyi users. Instant-sell prices, before Bazaar tax.`;

    // Crystal vs callings.
    const compare = document.getElementById('compare')!;
    const row = (label: string, cost: number | null, kill: { kills: number; value: number } | null) => {
      const box = el('div', 'tool-row');
      box.append(el('b', '', label));
      if (cost == null) box.append(el('span', 'muted', 'Not on the Bazaar, so no price.'));
      else if (!kill) box.append(el('span', 'muted', `Costs ${coins(cost)}. Not enough kills tracked to estimate loot.`));
      else {
        const profit = kill.value - cost;
        box.append(el('span', '', `Costs ${coins(cost)}, loot worth about ${coins(kill.value)}`));
        box.append(el('span', profit >= 0 ? 'gain' : 'loss', `${profit >= 0 ? '+' : ''}${coins(profit)} a kill`));
        box.append(el('span', 'faint', `from ${kill.kills.toLocaleString('en-GB')} kills`));
      }
      return box;
    };
    compare.replaceChildren(row('Crystal (Lv500)', crystalCost > 0 ? crystalCost : null, crystal), row('Callings (Lv300)', callingCost, calling));
    compare.append(el('p', 'chart-note', 'Loot here does not include Scavenger coins or your Magic Find; your real numbers are on the dashboard.'));

    // What will I make?
    const form = document.getElementById('calc') as HTMLFormElement;
    const out = document.getElementById('calc-out')!;
    const calc = () => {
      const n = Math.max(0, Math.floor(Number((form.elements.namedItem('kills') as HTMLInputElement).value) || 0));
      const tier = (form.elements.namedItem('tier') as HTMLSelectElement).value as 'CALLING' | 'CRYSTAL';
      const kill = tier === 'CRYSTAL' ? crystal : calling;
      const cost = tier === 'CRYSTAL' ? crystalCost : callingCost;
      if (!kill || cost == null) {
        out.textContent = 'Not enough data for this summon yet.';
        return;
      }
      out.replaceChildren(
        el('div', '', `Loot: about ${coins(kill.value * n)}`),
        el('div', '', `Summons: ${coins(cost * n)}`),
        el('div', kill.value - cost >= 0 ? 'gain big-num' : 'loss big-num', `${coins((kill.value - cost) * n)} profit`),
      );
    };
    form.addEventListener('input', calc);
    form.addEventListener('submit', (e) => e.preventDefault());
    calc();

    // Crystal shopping list.
    const mats = document.getElementById('mats') as HTMLFormElement;
    const matsOut = document.getElementById('mats-out')!;
    const list = () => {
      const n = Math.max(0, Math.floor(Number((mats.elements.namedItem('n') as HTMLInputElement).value) || 0));
      const rows = CRYSTAL_RECIPE.map(([id, name, each]) => {
        const r = el('div', 'tool-row');
        r.append(el('span', '', `${(each * n).toLocaleString('en-GB')}x ${name}`), el('span', 'muted', coins(each * n * (price.get(id) ?? 0))));
        return r;
      });
      const total = el('div', 'tool-row');
      total.append(el('b', '', 'Total'), el('b', '', coins(n * crystalCost)));
      matsOut.replaceChildren(...rows, total);
    };
    mats.addEventListener('input', list);
    mats.addEventListener('submit', (e) => e.preventDefault());
    list();

    // Ticker.
    const ticker = document.getElementById('ticker')!;
    ticker.replaceChildren(
      ...p.items
        .filter((i) => i.price != null)
        .map((i) => {
          const r = el('div', 'tool-row');
          r.append(el('span', '', i.name), el('span', '', coins(i.price!)));
          if (i.change != null) r.append(el('span', i.change >= 0 ? 'gain' : 'loss', `${i.change >= 0 ? '▲' : '▼'} ${Math.abs(i.change * 100).toFixed(1)}%`));
          return r;
        }),
    );
    if (!ticker.childElementCount) ticker.append(el('p', 'empty', 'No prices yet.'));
  } catch {
    basis.textContent = "Couldn't load prices. Try again in a moment.";
    basis.className = 'loss';
  }
}

// ---- local.json viewer (read in the browser, never uploaded) ------------------------------

interface LocalTotals {
  kills: number;
  fights: number;
  crystals: number;
  callings: number;
  lootValue: number;
  coins: number;
  costs: number;
  drops: Record<string, number>;
}

async function showLocal(input: HTMLInputElement) {
  const out = document.getElementById('local-out')!;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as { all: LocalTotals; days: Record<string, LocalTotals> };
    if (!data.all || !data.days) throw new Error('not a local.json');
    const profit = (t: LocalTotals) => t.lootValue + t.coins - t.costs;
    const rows = [['All time', data.all] as const, ...Object.entries(data.days).sort(([a], [b]) => Number(b) - Number(a)).map(([d, t]) => [new Date(Number(d) * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), t] as const)];
    out.replaceChildren(
      ...rows.map(([label, t]) => {
        const r = el('div', 'tool-row');
        r.append(el('b', '', label), el('span', '', `${t.kills.toLocaleString('en-GB')} kills`), el('span', profit(t) >= 0 ? 'gain' : 'loss', coins(profit(t))));
        return r;
      }),
      el('p', 'chart-note', 'Values are what the mod priced each drop at when it dropped.'),
    );
  } catch {
    out.replaceChildren(el('p', 'note bad', "That isn't the mod's local.json."));
  }
}

// ---- stream overlay -------------------------------------------------------------------

/**
 * Stream overlay. Everything is set in the address so OBS keeps it:
 *   ?show=profit,kills,rate,time,crystals,week   which numbers, in that order
 *   &size=s|m|l  &layout=stack|row  &theme=panel|clear|outline  &align=left|right
 *   &title=Some%20text   a line above the numbers (empty: none)
 */
function startOverlay() {
  // Kept inside the function: startOverlay() runs while this file is still loading, before
  // a top-level constant further down would exist (that was the bug).
  const OVERLAY_FIELDS = ['profit', 'kills', 'rate', 'time', 'crystals', 'callings', 'loot', 'costs', 'week', 'weekKills', 'last'];
  const key = location.pathname.split('/')[2] ?? '';
  const q = new URLSearchParams(location.search);
  const box = document.getElementById('overlay')!;
  const show = (q.get('show') ?? 'profit,kills,rate,time').split(',').filter((f) => OVERLAY_FIELDS.includes(f));
  box.className = `stream-box size-${q.get('size') ?? 'm'} layout-${q.get('layout') ?? 'stack'} theme-${q.get('theme') ?? 'panel'} align-${q.get('align') ?? 'left'}`;
  const title = q.get('title');
  const hm = (ms: number) => `${Math.floor(ms / 3_600_000)}h ${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}m`;
  const n = (v: number) => v.toLocaleString('en-GB');
  const tick = async () => {
    try {
      const res = await fetch(`/api/public/overlay/${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as Record<string, number | null> & { lastKill: { ts: number } | null };
      const text: Record<string, [string, string]> = {
        profit: ['Profit today', coins(d.profit ?? 0)],
        kills: ['Kills', n(d.kills ?? 0)],
        rate: ['Per hour', d.perHour == null ? '-' : coins(d.perHour)],
        time: ['Farming', hm(d.uptimeMs ?? 0)],
        crystals: ['Crystals', n(d.crystals ?? 0)],
        callings: ['Callings', n(d.callings ?? 0)],
        loot: ['Loot', coins(d.loot ?? 0)],
        costs: ['Spent', coins(d.costs ?? 0)],
        week: ['This week', coins(d.weekProfit ?? 0)],
        weekKills: ['Kills this week', n(d.weekKills ?? 0)],
        last: ['Last kill', d.lastKill ? ago(d.lastKill.ts) : '-'],
      };
      const nodes: HTMLElement[] = [];
      if (title) nodes.push(el('div', 'sb-title', title));
      show.forEach((f, i) => {
        const [label, value] = text[f]!;
        const item = el('div', i === 0 ? 'sb-item sb-main' : 'sb-item');
        item.append(el('span', 'sb-value', value), el('span', 'sb-label', label));
        nodes.push(item);
      });
      box.replaceChildren(...nodes);
      box.hidden = false;
    } catch {
      box.hidden = true;
    }
  };
  void tick();
  setInterval(() => void tick(), 15_000);
}

// ---- home page: anonymous totals ----------------------------------------------------------

async function showGlobal(target: HTMLElement) {
  try {
    const res = await fetch('/api/public/global');
    if (!res.ok) throw new Error();
    const g = (await res.json()) as { coins: number; drops: number; kills: number };
    const n = (v: number) => el('b', 'g-num', v.toLocaleString('en-GB'));
    target.replaceChildren(
      document.createTextNode('Arachne.fyi has tracked '),
      n(g.coins),
      document.createTextNode(' coins generated from '),
      n(g.drops),
      document.createTextNode(' drops, over '),
      n(g.kills),
      document.createTextNode(' Arachne kills.'),
    );
    target.hidden = false;
  } catch {
    target.hidden = true;
  }
}

// ---- changelog -----------------------------------------------------------------------------

function showChangelog(target: HTMLElement) {
  target.replaceChildren();
  for (const r of CHANGELOG) {
    const panel = el('article', 'panel release');
    panel.id = `v${r.version}`;
    const head = el('header');
    const date = new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    head.append(el('h2', '', `${r.version}: ${r.title}`), el('span', 'faint', date));
    panel.append(head);
    for (const sec of r.sections) {
      panel.append(el('h3', '', sec.heading));
      const ul = el('ul');
      for (const item of sec.items) ul.append(el('li', '', item));
      panel.append(ul);
    }
    target.append(panel);
  }
}

// ---- public profile -------------------------------------------------------------------

interface ProfileNumbers {
  profit?: number;
  kills?: number;
  perHour?: number | null;
  crystals?: number;
  callings?: number;
  uptimeMs?: number;
  bestDrop?: { name: string; value: number; ts: number } | null;
  lastSeen?: number;
}

/** Only the fields the owner made public are in the answer; missing ones are simply not shown. */
async function showProfile(target: HTMLElement) {
  const name = decodeURIComponent(location.pathname.split('/')[2] ?? '');
  try {
    const res = await fetch(`/api/public/profile/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error();
    const p = (await res.json()) as { name: string; title?: string; total: ProfileNumbers; badges?: string[]; accounts?: (ProfileNumbers & { name: string; uuid: string })[] };
    document.title = `${p.name}: Arachne.fyi`;
    const head = el('div', 'title');
    head.append(el('h1', 'wordmark', p.name));
    if (p.title) head.append(el('p', 'muted', p.title));
    const parts: HTMLElement[] = [head, el('div', 'rule')];
    parts.push(numberList(p.total));
    if (p.badges) parts.push(el('p', 'muted', p.badges.length ? `${p.badges.length} badges: ${p.badges.join(', ')}` : 'No badges yet'));
    if (p.accounts?.length) {
      const wrap = el('div', 'profile-accounts');
      for (const a of p.accounts) {
        const box = el('section', 'panel');
        const h = el('header');
        const img = document.createElement('img');
        img.src = `https://mc-heads.net/avatar/${a.uuid}/24`;
        img.alt = '';
        img.className = 'head';
        h.append(img, el('h2', '', a.name));
        box.append(h, numberList(a));
        wrap.append(box);
      }
      parts.push(wrap);
    }
    target.replaceChildren(...parts);
  } catch {
    target.replaceChildren(el('p', 'muted', 'No public profile with that name.'));
  }
}

function numberList(n: ProfileNumbers): HTMLElement {
  const stats = el('dl', 'status-list');
  const row = (k: string, v: string) => stats.append(el('dt', '', k), el('dd', '', v));
  if (n.profit !== undefined) row('Profit', coins(n.profit));
  if (n.kills !== undefined) row('Kills', n.kills.toLocaleString('en-GB'));
  if (n.perHour !== undefined) row('Per hour', n.perHour == null ? '-' : coins(n.perHour));
  if (n.crystals !== undefined) row('Crystals', n.crystals.toLocaleString('en-GB'));
  if (n.callings !== undefined) row('Callings', n.callings.toLocaleString('en-GB'));
  if (n.uptimeMs !== undefined) row('Time farming', `${Math.floor(n.uptimeMs / 3_600_000)}h ${Math.floor(n.uptimeMs / 60_000) % 60}m`);
  if (n.bestDrop !== undefined) row('Best drop', n.bestDrop ? `${n.bestDrop.name} (${coins(n.bestDrop.value)})` : '-');
  if (n.lastSeen !== undefined) row('Last seen', n.lastSeen ? ago(n.lastSeen) : '-');
  return stats;
}

function el(tag: string, className = '', text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
