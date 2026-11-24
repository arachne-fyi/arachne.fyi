import { useEffect, useRef, useState } from 'react';
import { api, type FeedEvent, type Me, type Series } from '../api.ts';
import { coins, duration, int } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';

/**
 * Standby: lay the phone on its side and leave it on. A board of 1, 2, 4 or 6 widgets, each
 * showing one thing; tap a widget to change it. The screen is kept awake, colours stay dim and
 * the whole board drifts a few pixels each minute so nothing burns into an OLED screen.
 * The layout is saved in this browser only.
 */

type Kind = 'profit' | 'rate' | 'kills' | 'week' | 'time' | 'fight' | 'lastDrop' | 'dry' | 'price' | 'clock' | 'graph';
interface Widget {
  kind: Kind;
  /** For 'price': which Bazaar item. */
  item?: string;
}
interface Board {
  slots: 1 | 2 | 4 | 6;
  widgets: Widget[];
}

const KINDS: [Kind, string][] = [
  ['profit', 'Profit today'],
  ['rate', 'Per hour'],
  ['kills', 'Kills today'],
  ['week', 'Profit this week'],
  ['time', 'Farming today'],
  ['fight', 'Fight timer'],
  ['lastDrop', 'Last drop'],
  ['dry', 'Dry streak'],
  ['price', 'Bazaar price'],
  ['clock', 'Clock'],
  ['graph', 'Profit, last 24h'],
];
const DEFAULT: Board = { slots: 4, widgets: [{ kind: 'profit' }, { kind: 'rate' }, { kind: 'fight' }, { kind: 'lastDrop' }, { kind: 'kills' }, { kind: 'clock' }] };
const KEY = 'arachne-standby';

function load(): Board {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Board | null;
    if (b && [1, 2, 4, 6].includes(b.slots) && Array.isArray(b.widgets)) {
      const widgets = b.widgets.filter((w) => KINDS.some(([k]) => k === w.kind));
      while (widgets.length < 6) widgets.push(DEFAULT.widgets[widgets.length]!);
      return { slots: b.slots, widgets };
    }
  } catch {
    /* fall through */
  }
  return DEFAULT;
}

export function Standby({ exit, me }: { exit: () => void; me: NonNullable<Me['user']> }) {
  const [board, setBoardState] = useState<Board>(load);
  const [editing, setEditing] = useState<number | null>(null);
  const setBoard = (b: Board) => {
    setBoardState(b);
    try {
      localStorage.setItem(KEY, JSON.stringify(b));
    } catch {
      /* private mode: still works, just not remembered */
    }
  };
  const now = useNow(1000);
  const awake = useWakeLock();

  // Data, fetched once for the whole board.
  const ov = useLive(() => api.overview('user'), [], 15_000);
  const ev = useLive(() => api.events(120), [], 10_000);
  const shown = board.widgets.slice(0, board.slots);
  const needs = (k: Kind) => shown.some((w) => w.kind === k);
  const prices = useLive(() => (needs('price') ? api.prices() : Promise.resolve(null)), [needs('price')], 60_000);
  const series = useLive(() => (needs('graph') ? api.series('24h') : Promise.resolve(null)), [needs('graph')], 60_000);

  const mine = new Set((ov.data?.accounts ?? []).filter((a) => a.userId === me.id).map((a) => a.uuid));
  const myEvents = (ev.data?.events ?? []).filter((e) => mine.has(e.account));
  const data: Data = { ov: ov.data ?? null, events: myEvents, prices: prices.data?.items ?? [], series: series.data ?? null, mine, now };

  const fullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    } catch {
      /* not allowed here (iPhone Safari): turning the phone works anyway */
    }
  };

  // Move everything a few pixels every minute.
  const drift = Math.floor(now / 60_000) % 9;

  return (
    <div className="standby">
      <div className={`sb-board slots-${board.slots}`} style={{ transform: `translate(${(drift % 3) * 4 - 4}px, ${Math.floor(drift / 3) * 4 - 4}px)` }}>
        {shown.map((w, i) => (
          <button key={i} type="button" className="sb-widget" onClick={() => setEditing(i)} aria-label={`${KINDS.find(([k]) => k === w.kind)?.[1]}: tap to change`}>
            <WidgetView w={w} d={data} big={board.slots <= 2} />
          </button>
        ))}
      </div>

      <div className="standby-bar">
        <button type="button" className="small" onClick={exit}>
          Exit
        </button>
        <button type="button" className="small" onClick={() => void fullscreen()}>
          Full screen
        </button>
        <div className="switch" role="group" aria-label="Widgets">
          {([1, 2, 4, 6] as const).map((n) => (
            <button key={n} type="button" aria-pressed={board.slots === n} onClick={() => setBoard({ ...board, slots: n })}>
              {n}
            </button>
          ))}
        </div>
        <span className="faint">{awake === 'on' ? 'Screen stays on' : awake === 'unsupported' ? "This browser can't keep the screen on" : 'Tap anywhere to keep the screen on'}</span>
      </div>
      <p className="standby-hint">Turn your phone on its side. Tap a widget to change it.</p>

      {editing != null && (
        <Picker
          current={board.widgets[editing]!}
          items={prices.data?.items ?? []}
          onPick={(w) => {
            const widgets = [...board.widgets];
            widgets[editing] = w;
            setBoard({ ...board, widgets });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface Data {
  ov: Awaited<ReturnType<typeof api.overview>> | null;
  events: FeedEvent[];
  prices: { item: string; name: string; instant: number | null }[];
  series: Series | null;
  mine: Set<string>;
  now: number;
}

function WidgetView({ w, d, big }: { w: Widget; d: Data; big: boolean }) {
  const t = d.ov?.totals.user;
  const label = KINDS.find(([k]) => k === w.kind)?.[1] ?? '';
  const out = (value: string, sub?: string, tone?: 'gain' | 'loss') => (
    <>
      {/* Words (an item name) get a smaller size than numbers so they fit the box. */}
      <span className={`sbw-value ${tone ?? ''} ${big ? 'big' : ''} ${/\d/.test(value) ? '' : 'words'}`}>{value}</span>
      <span className="sbw-label">{label}</span>
      {sub && <span className="sbw-sub">{sub}</span>}
    </>
  );
  if (!t && w.kind !== 'clock') return out('…');
  switch (w.kind) {
    case 'profit':
      return out(coins(t!.today.profit), undefined, t!.today.profit < 0 ? 'loss' : 'gain');
    case 'rate':
      return out(t!.today.wallUptimeMs > 0 ? coins(t!.today.profitPerWallHour) : '-');
    case 'kills':
      return out(int(t!.today.kills), `${int(t!.today.crystals)} crystals, ${int(t!.today.callings)} callings`);
    case 'week':
      return out(coins(t!.week.profit), undefined, t!.week.profit < 0 ? 'loss' : 'gain');
    case 'time':
      return out(duration(t!.today.wallUptimeMs));
    case 'clock':
      return out(new Date(d.now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), new Date(d.now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }));
    case 'fight': {
      // The newest spawn on one of your accounts that hasn't ended yet.
      const ended = new Set(d.events.filter((e) => e.kind === 'DEATH' || e.kind === 'INTERRUPT').map((e) => `${e.account}:${e.fight}`));
      const open = d.events.find((e) => e.kind === 'SPAWN' && !ended.has(`${e.account}:${e.fight}`) && d.now - e.ts < 5 * 60_000);
      if (open) return out(clockTime(d.now - open.ts), open.accountName, 'gain');
      const last = d.events.find((e) => e.kind === 'DEATH');
      return out('-', last ? `last kill ${clockTime(d.now - last.ts)} ago` : 'no fight');
    }
    case 'lastDrop': {
      const drop = d.events.find((e) => e.kind === 'LOOT');
      return drop ? out(drop.itemName ?? drop.item ?? '?', `${coins(drop.value)}, ${clockTime(d.now - drop.ts)} ago`) : out('-', 'nothing yet');
    }
    case 'dry': {
      const worst = [...(d.ov?.insights.dry ?? [])].sort((a, b) => b.current - a.current)[0];
      return worst ? out(int(worst.current), `kills since ${worst.name}`) : out('-');
    }
    case 'price': {
      const p = d.prices.find((x) => x.item === (w.item ?? 'ARACHNE_FRAGMENT'));
      return <>{out(p?.instant != null ? coins(p.instant) : '-', p?.name ?? 'pick an item')}</>;
    }
    case 'graph':
      return (
        <>
          <Spark series={d.series} mine={d.mine} />
          <span className="sbw-label">{label}</span>
        </>
      );
  }
}

const clockTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Your profit adding up over the last day, as one line. */
function Spark({ series, mine }: { series: Series | null; mine: Set<string> }) {
  if (!series) return <span className="sbw-value">…</span>;
  let run = 0;
  const pts = Array.from({ length: series.buckets }, (_, i) => (run += series.accounts.filter((a) => mine.has(a.uuid)).reduce((n, a) => n + (a.profit[i] ?? 0), 0)));
  const min = Math.min(0, ...pts);
  const max = Math.max(1, ...pts);
  const d = pts.map((v, i) => `${(i / Math.max(1, pts.length - 1)) * 100},${40 - ((v - min) / (max - min)) * 38}`).join(' ');
  return (
    <svg className="sbw-spark" viewBox="0 0 100 42" preserveAspectRatio="none" aria-label={`Profit ${coins(run)}`}>
      <polyline points={d} fill="none" stroke="var(--orange)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Picker({ current, items, onPick, onClose }: { current: Widget; items: { item: string; name: string }[]; onPick: (w: Widget) => void; onClose: () => void }) {
  const [item, setItem] = useState(current.item ?? 'ARACHNE_FRAGMENT');
  return (
    <div className="sb-picker" role="dialog" aria-label="Choose a widget" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>Show here</h2>
        <div className="sb-kinds">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={current.kind === k} onClick={() => onPick(k === 'price' ? { kind: k, item } : { kind: k })}>
              {label}
            </button>
          ))}
        </div>
        <label className="sb-item">
          Bazaar item
          <select value={item} onChange={(e) => setItem(e.target.value)}>
            {(items.length ? items : [{ item: 'ARACHNE_FRAGMENT', name: 'Arachne Fragment' }]).map((p) => (
              <option key={p.item} value={p.item}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
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
    document.documentElement.classList.add('standby-mode');
    void take();
    const back = () => document.visibilityState === 'visible' && void take();
    const tap = () => void take();
    document.addEventListener('visibilitychange', back);
    document.addEventListener('pointerdown', tap);
    return () => {
      document.documentElement.classList.remove('standby-mode');
      document.removeEventListener('visibilitychange', back);
      document.removeEventListener('pointerdown', tap);
      void lock.current?.release().catch(() => null);
    };
  }, []);
  return state;
}
