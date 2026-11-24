/*
 * Download page (/download). Reads every uploaded build from /api/public/versions and
 * shows: a Minecraft version picker with that version's latest release on top, then a
 * list of all builds with channel and Minecraft version filters.
 *
 * The server knows a build's mod version and Minecraft version from its file name
 * (arachne-fyi-<mod>+<minecraft>.jar). It has no channel field yet, so the channel is
 * read from the mod version (channelOf in site.ts). Once the admin panel can set a channel,
 * swap channelOf() for the server's value.
 */
import { channelOf, day, el, tag, type Channel } from './site.ts';
import './download.css';

interface Build {
  file: string;
  mod: string;
  size: number;
  uploadedAt: number;
  sha256?: string;
}
interface Group {
  minecraft: string;
  builds: Build[];
}
interface Row extends Build {
  minecraft: string;
  channel: Channel;
}

const mcSelect = document.getElementById('mc') as HTMLSelectElement;
const mcFilter = document.getElementById('mc-filter') as HTMLSelectElement;
const rowsBox = document.getElementById('rows') as HTMLElement;
const bestLabel = document.getElementById('best-label') as HTMLElement;
const bestName = document.getElementById('best-name') as HTMLElement;
const bestMeta = document.getElementById('best-meta') as HTMLElement;
const bestLink = document.getElementById('best-link') as HTMLAnchorElement;
const channelButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-channel]')];

let all: Row[] = [];
let channel: Channel | 'All' = 'All';

void load();

async function load() {
  try {
    const res = await fetch('/api/public/versions');
    if (!res.ok) throw new Error(String(res.status));
    const { versions } = (await res.json()) as { versions: Group[] };
    all = versions.flatMap((g) => g.builds.map((b) => ({ ...b, minecraft: g.minecraft, channel: channelOf(b.mod) })));
    all.sort((a, b) => b.uploadedAt - a.uploadedAt);
    const mcs = [...new Set(all.map((r) => r.minecraft))].sort(compareMinecraft);
    if (mcs.length === 0) {
      showNothing('No builds uploaded yet. Check back soon.');
      return;
    }
    mcSelect.replaceChildren(...mcs.map((mc, i) => option(mc, mc, i === 0 ? 'newest' : '')));
    mcSelect.disabled = false;
    mcFilter.append(...mcs.map((mc) => option(mc, `Minecraft ${mc}`)));
    mcSelect.addEventListener('change', showBest);
    mcFilter.addEventListener('change', showRows);
    for (const button of channelButtons) {
      button.addEventListener('click', () => {
        channel = button.dataset.channel as Channel | 'All';
        channelButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
        showRows();
      });
    }
    showBest();
    showRows();
  } catch {
    showNothing('Could not load the list. Try again in a moment.');
  }
}

/** The top card: newest release for the picked Minecraft version, else its newest build. */
function showBest() {
  const mc = mcSelect.value;
  const builds = all.filter((r) => r.minecraft === mc);
  const release = builds.find((r) => r.channel === 'Release');
  const pick = release ?? builds[0];
  if (!pick) return;
  bestLabel.textContent = release ? `Latest release for ${mc}` : `Newest build for ${mc} (no full release yet)`;
  bestName.textContent = `Arachne.fyi ${pick.mod}`;
  bestMeta.textContent = `${day(pick.uploadedAt)} · ${size(pick.size)}${release ? '' : ` · ${pick.channel}`}`;
  bestLink.href = fileUrl(pick);
  bestLink.setAttribute('download', pick.file);
  bestLink.removeAttribute('aria-disabled');
}

function showRows() {
  const mc = mcFilter.value;
  const rows = all.filter((r) => (channel === 'All' || r.channel === channel) && (mc === 'all' || r.minecraft === mc));
  if (rows.length === 0) {
    rowsBox.replaceChildren(el('p', 'dl-empty muted', 'No builds match these filters.'));
    return;
  }
  rowsBox.replaceChildren(...rows.map(rowFor));
}

function rowFor(r: Row) {
  const row = el('div', 'dl-row');
  const name = el('span', 'dl-name');
  name.append(el('span', 'px', r.mod), tag(r.channel));
  const link = el('a', 'dl-get') as HTMLAnchorElement;
  link.href = fileUrl(r);
  link.setAttribute('download', r.file);
  link.setAttribute('aria-label', `Download ${r.mod} for Minecraft ${r.minecraft}`);
  link.title = r.sha256 ? `${r.file}\nSHA-256 ${r.sha256}` : r.file;
  link.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
  row.append(name, el('span', 'soft small', r.minecraft), el('span', 'muted small', day(r.uploadedAt)), link);
  return row;
}

function showNothing(message: string) {
  mcSelect.replaceChildren(option('', 'None available'));
  bestLabel.textContent = 'Latest release';
  bestName.textContent = 'Not available yet';
  bestMeta.textContent = '';
  rowsBox.replaceChildren(el('p', 'dl-empty muted', message));
}

/** Newest Minecraft version first; "Other" (files without a version in the name) last. */
function compareMinecraft(a: string, b: string) {
  if (a === 'Other') return 1;
  if (b === 'Other') return -1;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0 && !Number.isNaN(d)) return d;
  }
  return b.localeCompare(a);
}

function fileUrl(b: Build) {
  return `/download/files/${encodeURIComponent(b.file)}`;
}

function size(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function option(value: string, label: string, badge = '') {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  if (badge) o.dataset.badge = badge; // shown as a small tag by the dropdown
  return o;
}
