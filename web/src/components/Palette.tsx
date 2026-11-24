import { useEffect, useMemo, useRef, useState } from 'react';
import { itemName, ITEMS } from '@arachne/shared';
import { api, type AccountCard } from '../api.ts';
import { refreshAll } from '../hooks.ts';
import { remember, remembered } from '../settings.ts';

export const PAGES: [string, string, string][] = [
  ['/', 'Overview', 'o'],
  ['/glance', 'Glance', 'a'],
  ['/graphs', 'Graphs', 'g'],
  ['/leaderboard', 'Leaderboard', 'l'],
  ['/loot', 'Drops', 'd'],
  ['/fights', 'Fights', 'f'],
  ['/feed', 'Feed', 'e'],
  ['/records', 'Progress', 'p'],
  ['/account', 'My accounts', 'm'],
  ['/settings', 'Settings', 's'],
  ['/pairing', 'Pair the mod', 'k'],
];

interface Entry {
  label: string;
  hint: string;
  run: () => void;
}

/**
 * Ctrl+K (or /) opens a search box for pages, items and accounts. Single keys work too:
 * G then a letter goes to a page, R refreshes, ? lists the keys.
 */
export function Palette({ go, admin }: { go: (to: string) => void; admin: boolean }) {
  const [accounts, setAccounts] = useState<AccountCard[]>([]);
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const pages = PAGES.concat(admin ? [['/admin', 'Admin', 'x']] : []).map(([to, label]) => ({ label, hint: 'page', run: () => go(to) }));
    const items = Object.keys(ITEMS).map((id) => ({ label: itemName(id), hint: 'drop', run: () => go('/loot') }));
    const accts = accounts.map((a) => ({ label: a.name, hint: 'account', run: () => go('/account') }));
    return [...pages, ...accts, ...items, { label: 'Refresh everything', hint: 'R', run: refreshAll }, { label: 'Keyboard shortcuts', hint: '?', run: () => setHelp(true) }];
  }, [accounts, admin, go]);
  const found = entries.filter((e) => e.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 10);

  useEffect(() => {
    let pendingG = false;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setHelp(false);
        return;
      }
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === '?') setHelp((h) => !h);
      else if (pendingG) {
        pendingG = false;
        const page = PAGES.find(([, , k]) => k === e.key.toLowerCase()) ?? (admin && e.key === 'x' ? ['/admin'] : null);
        if (page) go(page[0]!);
      } else if (e.key === 'g') {
        pendingG = true;
        setTimeout(() => (pendingG = false), 1200);
      } else if (e.key === 'r') refreshAll();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [go, admin]);

  useEffect(() => {
    if (open) {
      // Account names only matter once the box is open; fetch them then.
      if (accounts.length === 0) void api.overview().then((o) => setAccounts(o.accounts)).catch(() => undefined);
      setQ('');
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (help) {
    return (
      <div className="overlay" onClick={() => setHelp(false)}>
        <div className="panel palette" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
          <h2>Keyboard shortcuts</h2>
          <dl className="keys">
            <dt>Ctrl+K or /</dt>
            <dd>Search pages, drops and accounts</dd>
            <dt>R</dt>
            <dd>Refresh</dd>
            {PAGES.map(([, label, k]) => (
              <span key={k} style={{ display: 'contents' }}>
                <dt>G then {k.toUpperCase()}</dt>
                <dd>{label}</dd>
              </span>
            ))}
            <dt>?</dt>
            <dd>This list</dd>
          </dl>
          <button type="button" onClick={() => setHelp(false)}>
            Close
          </button>
        </div>
      </div>
    );
  }
  if (!open) return null;
  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <div className="panel palette" role="dialog" aria-label="Search" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          aria-label="Search"
          placeholder="Go to a page, drop or account…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, found.length - 1));
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0));
            else if (e.key === 'Enter' && found[sel]) {
              found[sel].run();
              setOpen(false);
            }
          }}
        />
        <ul>
          {found.map((e, i) => (
            <li key={`${e.hint}-${e.label}`}>
              <button
                type="button"
                aria-selected={i === sel}
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  e.run();
                  setOpen(false);
                }}
              >
                <span>{e.label}</span>
                <span className="faint">{e.hint}</span>
              </button>
            </li>
          ))}
          {found.length === 0 && <li className="empty">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}

const TOUR = [
  ['The big number', 'Your profit for the time you pick. Hover or tap any number to see what it means.'],
  ['Player cards', 'One card per Minecraft account, with a dot that turns green while it is farming.'],
  ['Tabs', 'Graphs, Leaderboard, Drops, Fights, Feed and Progress. On a phone they sit along the bottom.'],
  ['Your menu', 'Click your name for your accounts, pairing the mod, and Settings (notifications, number style).'],
] as const;

/** Four short cards the first time someone logs in. */
export function Tour() {
  const [step, setStep] = useState(() => (remembered('toured') ? -1 : 0));
  if (step < 0) return null;
  const done = () => {
    remember('toured', '1');
    setStep(-1);
  };
  const [title, text] = TOUR[step]!;
  return (
    <div className="overlay">
      <div className="panel palette tour" role="dialog" aria-label="Quick tour">
        <span className="muted">
          {step + 1} of {TOUR.length}
        </span>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="row">
          {step < TOUR.length - 1 ? (
            <button type="button" className="primary" onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="primary" onClick={done}>
              Got it
            </button>
          )}
          <button type="button" onClick={done}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
