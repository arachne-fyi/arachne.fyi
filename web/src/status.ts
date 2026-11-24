/* /status: is the server up, how fresh are the Bazaar prices, and the running totals. Refreshes every 30 seconds. */
import { ago, coins, el, int } from './site.ts';

interface Status {
  ok: boolean;
  serverTime: number;
  lastEventAt: number | null;
  pricesUpdatedAt: number | null;
  online: number;
  kills: number;
  tracked: number;
}

const card = document.getElementById('status-card')!;
const line = document.getElementById('status-line')!;
const checked = document.getElementById('status-checked')!;
const tiles = document.getElementById('status')!;
const again = document.getElementById('status-refresh') as HTMLButtonElement;

function tile(label: string, value: string, sub = '', warn = false) {
  const box = el('div', 'panel tile');
  box.append(el('span', 'tile-label', label), el('span', `px tile-value${warn ? ' loss' : ''}`, value));
  if (sub) box.append(el('span', 'tile-sub', sub));
  return box;
}

async function check() {
  again.disabled = true;
  try {
    const res = await fetch('/api/public/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const s = (await res.json()) as Status;
    const stale = !s.pricesUpdatedAt || Date.now() - s.pricesUpdatedAt > 30 * 60_000;
    card.className = 'panel status-card up';
    line.textContent = stale ? 'Up, but Bazaar prices are behind' : 'Everything is running';
    tiles.replaceChildren(
      tile('Last data from a mod', s.lastEventAt ? ago(s.lastEventAt) : 'never'),
      tile('Bazaar prices', s.pricesUpdatedAt ? ago(s.pricesUpdatedAt) : 'not loaded', 'checked every 5 minutes', stale),
      tile('Accounts online', int(s.online)),
      tile('Kills tracked', int(s.kills)),
      tile('Coins tracked', coins(s.tracked)),
    );
  } catch {
    card.className = 'panel status-card down';
    line.textContent = "The server isn't answering";
    tiles.replaceChildren(el('p', 'empty', 'It may be restarting, or the PC it runs on is off. This page checks again every 30 seconds.'));
  }
  const now = new Date();
  checked.textContent = `Checked ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })} UTC. Checks again every 30 seconds.`;
  again.disabled = false;
}

again.addEventListener('click', () => void check());
void check();
setInterval(() => void check(), 30_000);
