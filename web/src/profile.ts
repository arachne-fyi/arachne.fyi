/*
 * /u/<name>: an opt-in public profile. Only the fields the owner made public are in the answer;
 * missing ones are simply not shown.
 */
import { ago, coins, el, int } from './site.ts';
import { headUrl } from './offline.ts';

interface Numbers {
  profit?: number;
  kills?: number;
  perHour?: number | null;
  crystals?: number;
  callings?: number;
  uptimeMs?: number;
  bestDrop?: { name: string; value: number; ts: number } | null;
  lastSeen?: number;
}
interface Profile {
  name: string;
  title?: string;
  total: Numbers;
  badges?: string[];
  accounts?: (Numbers & { name: string; uuid: string })[];
}

const box = document.getElementById('profile')!;
const name = decodeURIComponent(location.pathname.split('/')[2] ?? '');
const hours = (ms: number) => `${Math.floor(ms / 3_600_000)}h ${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}m`;
const head = (uuid: string, size: number) => {
  const img = el('img');
  img.src = headUrl(uuid, size);
  img.alt = '';
  img.width = size;
  img.height = size;
  return img;
};

/** Each public number as [label, value, highlighted]. */
function numbers(n: Numbers): [string, string, boolean][] {
  const out: [string, string, boolean][] = [];
  if (n.profit !== undefined) out.push(['Profit', coins(n.profit), true]);
  if (n.kills !== undefined) out.push(['Kills', int(n.kills), false]);
  if (n.perHour !== undefined) out.push(['Per hour', n.perHour == null ? '-' : coins(n.perHour), false]);
  if (n.crystals !== undefined) out.push(['Crystals', int(n.crystals), false]);
  if (n.callings !== undefined) out.push(['Callings', int(n.callings), false]);
  if (n.uptimeMs !== undefined) out.push(['Time farming', hours(n.uptimeMs), false]);
  if (n.bestDrop !== undefined) out.push(['Best drop', n.bestDrop ? `${n.bestDrop.name} (${coins(n.bestDrop.value)})` : '-', false]);
  if (n.lastSeen !== undefined) out.push(['Last seen', n.lastSeen ? ago(n.lastSeen) : '-', false]);
  return out;
}

async function show() {
  try {
    if (!name) throw new Error('no name');
    const res = await fetch(`/api/public/profile/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(String(res.status));
    const p = (await res.json()) as Profile;
    document.title = `${p.name}: Arachne.fyi`;

    const top = el('section', 'panel prof-head');
    if (p.accounts?.[0]) top.append(head(p.accounts[0].uuid, 96));
    const info = el('div', 'prof-info');
    info.append(el('span', 'px muted', 'Arachne.fyi profile'), el('h1', 'px prof-name', p.name));
    if (p.title) info.append(el('span', 'px gold', p.title));
    if (p.badges) {
      const badges = el('div', 'badges');
      if (p.badges.length) badges.append(...p.badges.map((b) => el('span', 'badge', b)));
      else badges.append(el('span', 'muted small', 'No badges yet'));
      info.append(badges);
    }
    top.append(info);

    const parts: HTMLElement[] = [top];
    const total = numbers(p.total);
    if (total.length) {
      const tiles = el('div', 'tiles');
      tiles.append(
        ...total.map(([label, value, hot]) => {
          const t = el('div', 'panel tile');
          t.append(el('span', 'tile-label', label), el('span', `px tile-value${hot ? ' hot' : ''}${value.length > 12 ? ' long' : ''}`, value));
          return t;
        }),
      );
      parts.push(tiles);
    }
    if (p.accounts?.length) {
      const sec = el('section', 'sec');
      sec.append(el('h2', 'px sec-title', p.accounts.length === 1 ? 'Minecraft account' : 'Minecraft accounts'));
      const grid = el('div', 'accounts');
      for (const a of p.accounts) {
        const card = el('div', 'panel card');
        const h = el('div', 'acct-head');
        h.append(head(a.uuid, 32), el('h3', 'px', a.name));
        const rows = el('dl', 'rows');
        rows.style.margin = '0';
        for (const [label, value] of numbers(a)) {
          const r = el('div', 'r');
          r.append(el('dt', 'muted', label), el('dd', 'px', value));
          r.querySelector('dd')!.style.margin = '0';
          rows.append(r);
        }
        card.append(h, rows);
        grid.append(card);
      }
      sec.append(grid);
      parts.push(sec);
    }
    box.replaceChildren(...parts);
  } catch {
    const card = el('section', 'panel card');
    card.append(
      el('h1', 'px card-big', 'No public profile here'),
      el('p', 'soft', name ? `Nobody called ${name} has a public profile. Profiles are off until their owner turns them on in Settings.` : 'This link is missing a name.'),
    );
    const buttons = el('div', 'buttons');
    buttons.style.justifyContent = 'flex-start';
    const dl = el('a', 'btn btn-main', 'Download the mod');
    dl.href = '/download';
    buttons.append(dl);
    card.append(buttons);
    box.replaceChildren(card);
  }
}

void show();
