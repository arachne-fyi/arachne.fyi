/*
 * Standby: the old layout in the new look. A board of 1, 2, 4 or 6 widgets for a spare phone
 * or screen; tap one to change it. The screen is kept awake and the board drifts a few pixels
 * each minute so nothing burns in. The layout is saved in this browser.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type Series } from '../api.ts';
import { ago, coins, duration, int } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';
import { platform, type Group } from '../platform-api.ts';
import { ESSENCE, SOUL, killsOf, lootOf, meId, openFights, sumSeries, tierWord, timer, type User } from './data.ts';

type Kind = 'profit' | 'rate' | 'fight' | 'lastKill' | 'kills' | 'clock' | 'soul' | 'essence' | 'scav' | 'group' | 'week' | 'time' | 'graph';
const KINDS: [Kind, string][] = [
  ['profit', 'Profit today'],
  ['rate', 'Per hour'],
  ['fight', 'Fight timer'],
  ['lastKill', 'Last kill'],
  ['kills', 'Kills today'],
  ['clock', 'Clock'],
  ['soul', 'Soul String today'],
  ['essence', 'Spider Essence today'],
  ['scav', 'Scavenger coins today'],
  ['group', 'Group today'],
  ['week', 'Profit, last 7 days'],
  ['time', 'Farming today'],
  ['graph', 'Profit, last 24h'],
];
type Slots = 1 | 2 | 4 | 6;
interface Board {
  slots: Slots;
  widgets: { kind: Kind }[];
}
const DEFAULT: Board = { slots: 4, widgets: (['profit', 'rate', 'fight', 'lastKill', 'kills', 'clock'] as Kind[]).map((kind) => ({ kind })) };
const KEY = 'arachne-standby';
/** Kinds from the old board, mapped to the nearest new one. */
const OLD: Record<string, Kind> = { lastDrop: 'lastKill', dry: 'kills', price: 'scav' };

function load(): Board {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { slots: number; widgets: { kind: string }[] } | null;
    if (b && [1, 2, 4, 6].includes(b.slots) && Array.isArray(b.widgets)) {
      const widgets = b.widgets.map((w) => ({ kind: (OLD[w.kind] ?? w.kind) as Kind })).filter((w) => KINDS.some(([k]) => k === w.kind));
      while (widgets.length < 6) widgets.push(DEFAULT.widgets[widgets.length]!);
      return { slots: b.slots as Slots, widgets: widgets.slice(0, 6) };
    }
  } catch {
    /* fall through */
  }
  return DEFAULT;
}

const GRID: Record<Slots, [string, string]> = {
  1: ['1fr / 1fr', '1fr / 1fr'],
  2: ['1fr / 1fr 1fr', '1fr 1fr / 1fr'],
  4: ['1fr 1fr / 1fr 1fr', '1fr 1fr / 1fr 1fr'],
  6: ['1fr 1fr / repeat(3, 1fr)', 'repeat(3, 1fr) / 1fr 1fr'],
};

export function Standby({ user, group, exit }: { user: User; group: Group | null; exit: () => void }) {
  const [board, setBoardState] = useState<Board>(load);
  const [editing, setEditing] = useState<number | null>(null);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  const setBoard = (b: Board) => {
    setBoardState(b);
    try {
      localStorage.setItem(KEY, JSON.stringify(b));
    } catch {
      /* still works, just not remembered */
    }
  };
  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const now = useNow(1000);
  const awake = useWakeLock();
  const me = meId(user);
  const shown = board.widgets.slice(0, board.slots).map((w) => w.kind);
  const needs = (...k: Kind[]) => k.some((x) => shown.includes(x));

  const ov = useLive(() => api.overview('user'), [], 15_000);
  const ev = useLive(() => (needs('fight', 'lastKill') ? api.events(200) : Promise.resolve(null)), [needs('fight', 'lastKill')], 10_000);
  const fights = useLive(() => (needs('lastKill') ? api.fights(40) : Promise.resolve(null)), [needs('lastKill')], 15_000);
  const loot = useLive(() => (needs('soul', 'essence') ? api.loot('today', 'me') : Promise.resolve(null)), [needs('soul', 'essence')], 30_000);
  const grp = useLive(() => (needs('group') && group ? platform.group(group.id) : Promise.resolve(null)), [needs('group'), group?.id], 30_000);
  const series = useLive(() => (needs('graph') ? api.series('24h') : Promise.resolve(null)), [needs('graph')], 60_000);

  const mine = new Set((ov.data?.accounts ?? []).filter((a) => a.userId === me).map((a) => a.uuid));
  const t = ov.data?.totals.user;
  const events = (ev.data?.events ?? []).filter((e) => mine.has(e.account));
  const big = board.slots <= 2;

  const view = (kind: Kind): { value: string; sub?: string; hot?: boolean; graph?: Series | null } => {
    if (kind === 'clock') {
      return { value: new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), sub: new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) };
    }
    if (!t) return { value: '…' };
    switch (kind) {
      case 'profit':
        return { value: coins(t.today.profit), hot: true };
      case 'rate':
        return { value: t.today.wallUptimeMs > 0 ? coins(t.today.profitPerWallHour) : '-' };
      case 'kills':
        return { value: int(t.today.kills), sub: `${int(t.today.crystals)} crystals · ${int(t.today.callings)} callings` };
      case 'week':
        return { value: coins(t.week.profit) };
      case 'time':
        return { value: duration(t.today.wallUptimeMs) };
      case 'scav':
        return { value: coins(t.today.coins) };
      case 'soul': {
        const s = lootOf(loot.data?.loot, SOUL);
        return { value: loot.data ? int(s.count) : '…', sub: t.today.kills ? `about ${(s.count / t.today.kills).toFixed(1)} a kill` : undefined };
      }
      case 'essence': {
        const s = lootOf(loot.data?.loot, ESSENCE);
        return { value: loot.data ? int(s.count) : '…', sub: t.today.kills ? `about ${int(s.count / t.today.kills)} a kill` : undefined };
      }
      case 'fight': {
        const open = openFights(events, now)[0];
        if (open) return { value: timer(now - open.startedAt), sub: open.accountName, hot: true };
        const last = events.find((e) => e.kind === 'DEATH');
        return { value: '-', sub: last ? `last kill ${ago(last.ts, now)}` : 'no fight' };
      }
      case 'lastKill': {
        const k = killsOf(fights.data?.fights ?? [], ev.data?.events ?? [], mine)[0];
        return k ? { value: `+${coins(k.value)}`, sub: `${tierWord(k.tier)} · ${int(k.soul)} Soul String · ${ago(k.ts, now)}` } : { value: '-', sub: 'nothing yet' };
      }
      case 'group': {
        if (!group) return { value: '-', sub: 'not in a group' };
        if (!grp.data) return { value: '…' };
        const list = grp.data.members.filter((m) => !m.hidden).sort((a, b) => (b.today?.profit ?? 0) - (a.today?.profit ?? 0));
        const at = list.findIndex((m) => m.userId === me);
        return { value: coins(grp.data.totals.today.profit), sub: `${group.name}${at >= 0 ? ` · you are ${['1st', '2nd', '3rd', '4th', '5th'][at] ?? `${at + 1}th`}` : ''}`, hot: true };
      }
      case 'graph':
        return { value: '', graph: series.data };
    }
  };

  const fullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    } catch {
      /* not allowed here (iPhone Safari): turning the phone works anyway */
    }
  };
  const drift = Math.floor(now / 60_000) % 9;
  const n = board.slots;
  const valueSize = n === 1 ? 'min(192px, 26vw)' : n === 2 ? (portrait ? 'min(128px, 18vh)' : 'min(128px, 13vw)') : n === 4 ? 'min(96px, 11vw, 13vh)' : 'min(80px, 9vw, 10vh)';

  return (
    <div className="sb">
      <div className="sb-bar">
        <button type="button" className="btn btn-ghost btn-small" onClick={exit}>
          Exit
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => void fullscreen()}>
          Full screen
        </button>
        <div className="seg" role="group" aria-label="Widgets">
          {([1, 2, 4, 6] as const).map((x) => (
            <button key={x} type="button" className="px" aria-pressed={x === n} onClick={() => setBoard({ ...board, slots: x })}>
              {x}
            </button>
          ))}
        </div>
        <span className="muted tiny">{awake === 'on' ? 'Screen stays on' : awake === 'unsupported' ? "This browser can't keep the screen on" : 'Tap anywhere to keep the screen on'} · tap a widget to change it</span>
      </div>
      <div className="sb-board" style={{ gridTemplate: GRID[n][portrait ? 1 : 0], transform: `translate(${(drift % 3) * 4 - 4}px, ${Math.floor(drift / 3) * 4 - 4}px)` }}>
        {shown.map((kind, i) => {
          const label = KINDS.find(([k]) => k === kind)?.[1] ?? '';
          const v = view(kind);
          const words = v.value !== '' && !/\d/.test(v.value) && v.value !== '-' && v.value !== '…';
          return (
            <button key={i} type="button" className="sb-w" onClick={() => setEditing(i)} aria-label={`${label}: tap to change`}>
              {kind === 'graph' && <Spark series={v.graph ?? null} mine={mine} />}
              {v.value && (
                <span className={`px sb-v${v.hot ? ' hot' : ''}`} style={{ fontSize: words ? 48 : valueSize }}>
                  {v.value}
                </span>
              )}
              <span className="px sb-l" style={{ fontSize: big ? 32 : 16 }}>
                {label}
              </span>
              {v.sub && (
                <span className="sb-s" style={{ fontSize: big ? 18 : 14 }}>
                  {v.sub}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {editing != null && (
        <>
          <button type="button" className="sb-back" aria-label="Close" onClick={() => setEditing(null)} />
          <div className="panel sb-pick" role="dialog" aria-label="Choose a widget">
            <h2 className="px dh2">Show here</h2>
            <div className="sb-kinds">
              {KINDS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className="sb-kind"
                  aria-pressed={board.widgets[editing]?.kind === k}
                  onClick={() => {
                    const widgets = [...board.widgets];
                    widgets[editing] = { kind: k };
                    setBoard({ ...board, widgets });
                    setEditing(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ alignSelf: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Your profit adding up over the last day, as one line. */
function Spark({ series, mine }: { series: Series | null; mine: Set<string> }) {
  if (!series) return <span className="px sb-v">…</span>;
  let run = 0;
  const pts = sumSeries(series, mine).map((v) => (run += v));
  const min = Math.min(0, ...pts);
  const max = Math.max(1, ...pts);
  const d = pts.map((v, i) => `${(i / Math.max(1, pts.length - 1)) * 100},${40 - ((v - min) / (max - min)) * 38}`).join(' ');
  return (
    <svg className="sb-graph" viewBox="0 0 100 42" preserveAspectRatio="none" aria-label={`Profit ${coins(run)}`}>
      <polyline points={d} fill="none" stroke="var(--orange)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function useWakeLock(): 'on' | 'off' | 'unsupported' {
  const [state, setState] = useState<'on' | 'off' | 'unsupported'>('off');
  const lock = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    const take = async () => {
      if (!('wakeLock' in navigator)) return setState('unsupported');
      if (lock.current && !lock.current.released) return;
      try {
        lock.current = await navigator.wakeLock.request('screen');
        setState('on');
        lock.current.addEventListener('release', () => setState('off'));
      } catch {
        setState('off'); // usually "needs a tap first"; the next tap retries
      }
    };
    void take();
    const back = () => document.visibilityState === 'visible' && void take();
    const tap = () => void take();
    document.addEventListener('visibilitychange', back);
    document.addEventListener('pointerdown', tap);
    return () => {
      document.removeEventListener('visibilitychange', back);
      document.removeEventListener('pointerdown', tap);
      void lock.current?.release().catch(() => null);
    };
  }, []);
  return state;
}
