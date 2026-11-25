/*
 * Standby: the old layout in the new look. A board of 1, 2, 4 or 6 widgets for a spare phone
 * or screen; tap one to change it. Widgets are either a big number or a graph. The screen is
 * kept awake and the board drifts a few pixels each minute so nothing burns in. The layout is
 * saved in this browser.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, type Series } from '../api.ts';
import { ago, coins, duration, int, shortClock } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';
import { platform, type Group } from '../platform-api.ts';
import { ESSENCE, SOUL, killsOf, lootOf, meId, openFights, startOfUtcDay, sumSeries, tierWord, timer, type User } from './data.ts';

type Kind =
  | 'profit'
  | 'rate'
  | 'fight'
  | 'lastKill'
  | 'kills'
  | 'clock'
  | 'soul'
  | 'essence'
  | 'scav'
  | 'group'
  | 'week'
  | 'time'
  | 'graph'
  | 'hourly'
  | 'killsHourly'
  | 'days'
  | 'month';
/** Every widget, with its label and whether it is a number or a graph (the picker groups them). */
const KINDS: [Kind, string, 'number' | 'graph'][] = [
  ['profit', 'Profit today', 'number'],
  ['rate', 'Per hour', 'number'],
  ['fight', 'Fight timer', 'number'],
  ['lastKill', 'Last kill', 'number'],
  ['kills', 'Kills today', 'number'],
  ['clock', 'Clock', 'number'],
  ['soul', 'Soul String today', 'number'],
  ['essence', 'Spider Essence today', 'number'],
  ['scav', 'Scavenger coins today', 'number'],
  ['group', 'Group today', 'number'],
  ['week', 'Profit, last 7 days', 'number'],
  ['time', 'Farming today', 'number'],
  ['graph', 'Profit, last 24h', 'graph'],
  ['hourly', 'Profit each hour', 'graph'],
  ['killsHourly', 'Kills each hour', 'graph'],
  ['days', 'Profit each day', 'graph'],
  ['month', 'Profit, last 30 days', 'graph'],
];
const isGraph = (k: Kind) => KINDS.some(([x, , g]) => x === k && g === 'graph');
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
/** Largest the big number may get, by board size. It is shrunk further to fit its widget. */
const VALUE_CAP: Record<Slots, number> = { 1: 192, 2: 128, 4: 96, 6: 80 };

const HOUR = 3_600_000;
const DAY = 86_400_000;

interface Chart {
  type: 'line' | 'bars';
  points: { start: number; v: number }[];
  /** Under the graph: left, middle, right. */
  axis: [string, string, string];
  /** Bars that are counts, not coins (for the screen reader text). */
  count?: boolean;
}
interface View {
  value: string;
  sub?: string;
  hot?: boolean;
  chart?: Chart | null;
}

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
  const day = useLive(() => (needs('graph', 'hourly', 'killsHourly') ? api.series('24h') : Promise.resolve(null)), [needs('graph', 'hourly', 'killsHourly')], 60_000);
  const week = useLive(() => (needs('days') ? api.series('7d') : Promise.resolve(null)), [needs('days')], 120_000);
  const month = useLive(() => (needs('month') ? api.series('30d') : Promise.resolve(null)), [needs('month')], 300_000);

  const mine = new Set((ov.data?.accounts ?? []).filter((a) => a.userId === me).map((a) => a.uuid));
  const t = ov.data?.totals.user;
  const events = (ev.data?.events ?? []).filter((e) => mine.has(e.account));
  const big = board.slots <= 2;

  const graphView = (kind: Kind): View => {
    // The series name accounts by uuid; until the overview says which are yours there is nothing to sum.
    const s = kind === 'days' ? week.data : kind === 'month' ? month.data : day.data;
    if (!s || !ov.data) return { value: '…', chart: null };
    switch (kind) {
      case 'graph':
      case 'month': {
        const pts = running(perBucket(s, sumSeries(s, mine)));
        const total = pts[pts.length - 1]?.v ?? 0;
        const axis: [string, string, string] = kind === 'graph' ? ['24h ago', '12h ago', 'now'] : ['30 days ago', '15 days ago', 'today'];
        return { value: coins(total), hot: total > 0, chart: { type: 'line', points: [{ start: s.from, v: 0 }, ...pts], axis } };
      }
      case 'hourly':
      case 'killsHourly': {
        const count = kind === 'killsHourly';
        const pts = regroup(s, sumSeries(s, mine, count ? 'kills' : 'profit'), (ts) => Math.floor(ts / HOUR) * HOUR).slice(-24);
        const best = top(pts);
        const fmt = count ? (v: number) => int(v) : coins;
        const total = pts.reduce((n, p) => n + p.v, 0);
        const first = pts[0]?.start ?? now - DAY;
        const mid = pts[Math.floor(pts.length / 2)]?.start ?? now - DAY / 2;
        return {
          value: count ? int(total) : fmt(pts[pts.length - 1]?.v ?? 0),
          sub: best && best.v > 0 ? `best ${shortClock(best.start)} · ${fmt(best.v)}${count ? ' kills' : ''}` : count ? 'no kills in 24h' : 'this hour',
          chart: { type: 'bars', points: pts, axis: [shortClock(first), shortClock(mid), 'now'], count },
        };
      }
      case 'days': {
        const pts = regroup(s, sumSeries(s, mine), startOfUtcDay).slice(-7);
        const best = top(pts);
        const label = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
        return {
          value: coins(pts.reduce((n, p) => n + p.v, 0)),
          sub: best && best.v > 0 ? `best ${label(best.start)} · ${coins(best.v)}` : undefined,
          chart: { type: 'bars', points: pts, axis: [label(pts[0]?.start ?? now - 6 * DAY), label(pts[3]?.start ?? now - 3 * DAY), 'today'] },
        };
      }
      default:
        return { value: '-' };
    }
  };

  const view = (kind: Kind): View => {
    if (isGraph(kind)) return graphView(kind);
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
      default:
        return { value: '-' };
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
  const hint = `${awake === 'on' ? 'Screen stays on' : awake === 'unsupported' ? "This browser can't keep the screen on" : 'Tap anywhere to keep the screen on'} · tap a widget to change it`;

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
        <span className="muted tiny sb-hint" title={hint}>
          {hint}
        </span>
      </div>
      <div className="sb-board" style={{ gridTemplate: GRID[n][portrait ? 1 : 0], transform: `translate(${(drift % 3) * 4 - 4}px, ${Math.floor(drift / 3) * 4 - 4}px)` }}>
        {shown.map((kind, i) => {
          const label = KINDS.find(([k]) => k === kind)?.[1] ?? '';
          const graph = isGraph(kind);
          const v = view(kind);
          return (
            <button key={i} type="button" className={`sb-w${graph ? ' sb-w-graph' : ''}`} onClick={() => setEditing(i)} aria-label={`${label}: tap to change`}>
              {v.value && <Fit text={v.value} className={`px sb-v${v.hot ? ' hot' : ''}`} cap={graph ? VALUE_CAP[n] * 0.6 : VALUE_CAP[n]} share={graph ? 0.18 : 0.42} />}
              {graph && (v.chart ? <Graph chart={v.chart} label={label} /> : <span className="sb-graph sb-graph-empty" />)}
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
            {(['number', 'graph'] as const).map((group) => (
              <div key={group} className="sb-kind-group">
                <span className="px muted small">{group === 'number' ? 'Numbers' : 'Graphs'}</span>
                <div className="sb-kinds">
                  {KINDS.filter(([, , g]) => g === group).map(([k, label]) => (
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
              </div>
            ))}
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

// ---- series helpers ----

/** Each bucket with its start time. */
const perBucket = (s: Series, values: number[]) => values.map((v, i) => ({ start: s.from + (i + 1) * s.bucketMs, v }));

/** The same values added up as they go. */
function running(pts: { start: number; v: number }[]) {
  let run = 0;
  return pts.map((p) => ({ start: p.start, v: (run += p.v) }));
}

/** Buckets summed into bigger steps (hours, days); `key` gives the start of the step a time falls in. */
function regroup(s: Series, values: number[], key: (ts: number) => number) {
  const out = new Map<number, number>();
  values.forEach((v, i) => {
    const k = key(s.from + i * s.bucketMs);
    out.set(k, (out.get(k) ?? 0) + v);
  });
  return [...out].sort((a, b) => a[0] - b[0]).map(([start, v]) => ({ start, v }));
}

const top = (pts: { start: number; v: number }[]) => pts.reduce<{ start: number; v: number } | null>((b, p) => (!b || p.v > b.v ? p : b), null);

// ---- widgets ----

/**
 * One line of text, as big as it may be without spilling out of its widget: at most `cap`
 * pixels, at most `share` of the widget's height, and shrunk to the widget's width.
 */
function Fit({ text, className, cap, share }: { text: string; className: string; cap: number; share: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      const cs = getComputedStyle(box);
      const width = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      let size = Math.max(12, Math.min(cap, box.clientHeight * share));
      el.style.fontSize = `${size}px`;
      if (el.scrollWidth > width && el.scrollWidth > 0) size = Math.max(10, Math.floor(size * (width / el.scrollWidth) * 0.97));
      el.style.fontSize = `${size}px`;
    };
    fit();
    // The pixel font may arrive after the first measure; widths change with it.
    void document.fonts?.ready.then(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [text, cap, share]);
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}

/** A graph filling the rest of its widget: a running line, or bars with the newest lit up. */
function Graph({ chart, label }: { chart: Chart; label: string }) {
  const { points, type } = chart;
  if (points.length === 0) return <span className="sb-graph sb-graph-empty" />;
  const vals = points.map((p) => p.v);
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const y = (v: number) => 47 - ((v - min) / (max - min)) * 44;
  const zero = y(0);
  const spoken = `${label}: ${chart.count ? int(vals[vals.length - 1] ?? 0) : coins(vals[vals.length - 1] ?? 0)} latest, ${chart.count ? int(max) : coins(max)} highest`;
  return (
    <span className="sb-graph">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label={spoken}>
        {min < 0 && <path d={`M0 ${zero}H100`} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 2" fill="none" vectorEffect="non-scaling-stroke" />}
        {type === 'line' ? (
          <Line vals={vals} y={y} zero={zero} />
        ) : (
          vals.map((v, i) => {
            const w = 100 / vals.length;
            const top = Math.min(y(v), zero);
            return (
              <rect
                key={i}
                x={i * w + w * 0.14}
                y={top}
                width={w * 0.72}
                height={Math.max(v === 0 ? 0 : 0.8, Math.abs(y(v) - zero))}
                fill={v < 0 ? '#ff8f8f' : i === vals.length - 1 ? 'var(--orange)' : 'rgba(255, 138, 31, 0.5)'}
                shapeRendering="crispEdges"
              />
            );
          })
        )}
        <path d="M0 49.5H100" stroke="rgba(255,255,255,0.12)" fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="sb-axis">
        {chart.axis.map((a, i) => (
          <span key={i}>{a}</span>
        ))}
      </span>
    </span>
  );
}

function Line({ vals, y, zero }: { vals: number[]; y: (v: number) => number; zero: number }) {
  const x = (i: number) => (i / Math.max(1, vals.length - 1)) * 100;
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    <>
      <polygon points={`0,${zero} ${pts} 100,${zero}`} fill="rgba(255, 138, 31, 0.14)" />
      <polyline points={pts} fill="none" stroke="var(--orange)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </>
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
