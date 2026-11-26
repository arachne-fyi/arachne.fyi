/* More cards for the Graphs page: time to kill (with or without the spawn-in), farming days,
   best hours of the week and Bazaar price history. Each has a live version and a plain view
   that the free plan's locked preview fills with example numbers. Styles: dash.css "graphs+". */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Ttk } from '../api.ts';
import { coins, dateTime, dayLabel, duration, fullCoins, shortClock } from '../format.ts';
import { useLive } from '../hooks.ts';
import type { Group } from '../platform-api.ts';
import { Card, FloatTip, Loading, Seg, Toggle, useHoverTip } from './ui.tsx';

// ---- shared ----------------------------------------------------------------------------

/** 11.9s, or 1m 05s for long ones. */
export function secs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '-';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

const SPAWN_KEY = 'arachne-ttk-spawn';
/** "Include the spawn-in" is remembered in this browser, for the Graphs page and Standby alike. */
export function savedSpawnPref(): boolean {
  try {
    return localStorage.getItem(SPAWN_KEY) === '1';
  } catch {
    return false;
  }
}
function useSpawnPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(savedSpawnPref);
  return [
    on,
    (v: boolean) => {
      setOn(v);
      try {
        localStorage.setItem(SPAWN_KEY, v ? '1' : '0');
      } catch {
        /* still works, just not remembered */
      }
    },
  ];
}

/** Kill time for one bucket in the chosen mode. Buckets without a seen spawn-in use the overall average. */
export const ttkOf = (fightMs: number, spawnMs: number | null | undefined, fallbackSpawnMs: number | null | undefined, withSpawn: boolean) =>
  fightMs + (withSpawn ? (spawnMs ?? fallbackSpawnMs ?? 0) : 0);

const RANGES = [
  ['1', '24h'],
  ['7', '7 days'],
  ['30', '30 days'],
] as const;
type Range = (typeof RANGES)[number][0];

// ---- time to kill ----------------------------------------------------------------------

export function TtkCard({ group }: { group: Group }) {
  const [range, setRange] = useState<Range>('7');
  const [who, setWho] = useState<'group' | 'me'>('group');
  const [spawn, setSpawn] = useSpawnPref();
  const days = Number(range) as 1 | 7 | 30;
  const data = useLive(() => api.ttk(who === 'me' ? 'me' : { group: group.id }, days), [who, days, group.id], 60_000);
  return (
    <TtkView
      data={data.data}
      error={data.error}
      spawn={spawn}
      controls={
        <>
          <Seg label="Whose kills" value={who} options={[['group', group.name], ['me', 'You']] as const} onChange={setWho} />
          <Seg label="Time range" value={range} options={RANGES} onChange={setRange} />
          <label className="ttk-toggle">
            <Toggle on={spawn} onChange={setSpawn} label="Include the spawn-in" />
            <span className="small">Include spawn-in</span>
          </label>
        </>
      }
    />
  );
}

export function TtkView({ data, error, spawn, controls }: { data: Ttk | undefined | null; error?: string | null; spawn: boolean; controls: ReactNode }) {
  const avg = data?.avgFightMs != null ? ttkOf(data.avgFightMs, data.avgSpawnMs, null, spawn) : null;
  return (
    <Card title={<span className="dh2">Time to kill</span>} side={<span className="graph-controls">{controls}</span>}>
      {!data ? (
        <Loading error={error} />
      ) : data.kills === 0 ? (
        <p className="empty small">No kills with a seen spawn in this range yet.</p>
      ) : (
        <>
          <div className="ttk-tiles">
            <div className="ttk-main">
              <span className="muted small">{spawn ? 'Average, spawn-in to death' : 'Average, spawn to death'}</span>
              <span className="px big-total ttk-big">{secs(avg)}</span>
              <span className="muted tiny">{data.kills.toLocaleString('en-GB')} kills</span>
            </div>
            <Stat label="Median fight" value={secs(data.medianFightMs)} />
            <Stat label="Fastest kill" value={secs(data.bestFightMs)} />
            <Stat label="Spawn-in" value={secs(data.avgSpawnMs)} sub={data.withSpawn < data.kills ? `seen on ${Math.round((data.withSpawn / data.kills) * 100)}% of kills` : 'crystal placed to spawn'} />
          </div>
          <div className="cols">
            <div className="col-half stack">
              <span className="muted small">{data.days === 1 ? 'Average each hour' : 'Average each day'}</span>
              <TtkTrend data={data} spawn={spawn} />
            </div>
            <div className="col-half stack">
              <span className="muted small">How long kills took</span>
              <TtkHistogram data={data} spawn={spawn} avg={avg} />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ttk-stat">
      <span className="muted small">{label}</span>
      <span className="px res-value">{value}</span>
      {sub && <span className="muted tiny">{sub}</span>}
    </div>
  );
}

function TtkTrend({ data, spawn }: { data: Ttk; spawn: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = data.buckets.map((b) => ({ t: b.start, v: ttkOf(b.avgFightMs, b.avgSpawnMs, data.avgSpawnMs, spawn), fight: b.avgFightMs, spawnIn: b.avgSpawnMs ?? data.avgSpawnMs, kills: b.kills }));
  const overall = data.avgFightMs != null ? ttkOf(data.avgFightMs, data.avgSpawnMs, null, spawn) : null;
  if (pts.length === 0) return <p className="empty small">Nothing yet.</p>;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const pad = Math.max(500, (hi - lo) * 0.2);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const x = (i: number) => (pts.length === 1 ? 500 : (i / (pts.length - 1)) * 1000);
  const y = (v: number) => 190 - ((v - min) / (max - min)) * 180;
  const label = (t: number) => (data.days === 1 ? shortClock(t) : dayLabel(t));
  const line = pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' ');
  const h = hover != null ? pts[hover] : null;
  return (
    <div className="chart">
      <svg
        viewBox="0 0 1000 200"
        height="180"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Average kill time per ${data.days === 1 ? 'hour' : 'day'}, from ${secs(lo)} to ${secs(hi)}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <path d="M0 55H1000M0 100H1000M0 145H1000" stroke="rgba(255,255,255,0.06)" fill="none" />
        <polygon points={`0,200 ${line} 1000,200`} fill="rgba(255, 138, 31, 0.12)" />
        <polyline points={line} stroke="var(--orange)" strokeWidth="3" fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover != null && <path d={`M${x(hover)} 0V200`} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" fill="none" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && (
        <div className="tip" style={{ left: `min(${(hover! / Math.max(1, pts.length - 1)) * 100}%, calc(100% - 190px))` }}>
          <span className="px">{label(h.t)}</span>
          <span>
            <b>{secs(h.v)}</b> average
          </span>
          {spawn && h.spawnIn != null && (
            <span className="muted">
              {secs(h.fight)} fight + {secs(h.spawnIn)} spawn-in
            </span>
          )}
          {overall != null && overall > 0 && (
            <span className={Math.abs(h.v - overall) < 100 ? 'muted' : h.v < overall ? 'gain' : 'loss'}>
              {Math.abs(h.v - overall) < 100 ? 'right on your average' : `${(h.v - overall) / 1000 > 0 ? '+' : '−'}${Math.abs((h.v - overall) / 1000).toFixed(1)}s vs ${data.days === 1 ? 'the day' : 'the range'}`}
            </span>
          )}
          <span className="muted">{h.kills.toLocaleString('en-GB')} kills</span>
        </div>
      )}
      <div className="axis">
        <span>{label(pts[0]!.t)}</span>
        <span>
          {secs(lo)} – {secs(hi)}
        </span>
        <span>{label(pts[pts.length - 1]!.t)}</span>
      </div>
    </div>
  );
}

function TtkHistogram({ data, spawn, avg }: { data: Ttk; spawn: boolean; avg: number | null }) {
  const hist = spawn ? data.totalHist : data.fightHist;
  const used = hist.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
  if (used.length === 0) return <p className="empty small">Nothing yet.</p>;
  const first = Math.max(0, used[0]! - 1);
  const last = Math.min(hist.length - 1, used[used.length - 1]! + 1);
  const bins = hist.slice(first, last + 1);
  const top = Math.max(1, ...bins);
  const avgBin = avg != null ? Math.min(hist.length - 1, Math.floor(avg / data.binMs)) : -1;
  const step = data.binMs / 1000;
  const edge = (i: number) => (i === hist.length - 1 ? `${i * step}s+` : `${i * step}s`);
  const all = hist.reduce((a, n) => a + n, 0);
  const { tip, on, hide } = useHoverTip<number>();
  const faster = (i: number) => hist.slice(0, i).reduce((a, n) => a + n, 0);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="tip-host" onPointerLeave={hide}>
        <div className="hist" role="img" aria-label={`Kills by time taken, ${edge(first)} to ${edge(last)}`}>
          {bins.map((n, k) => {
            const i = first + k;
            return <span key={i} className={i === avgBin ? 'on' : undefined} style={{ height: `${Math.max(n > 0 ? 3 : 0, (n / top) * 100)}%` }} {...on(i)} />;
          })}
        </div>
        {tip && (
          <FloatTip at={tip}>
            <span className="px">{tip.v === hist.length - 1 ? `${tip.v * step}s or longer` : `${tip.v * step}s to ${(tip.v + 1) * step}s`}</span>
            <span>
              <b>{(hist[tip.v] ?? 0).toLocaleString('en-GB')}</b> kills
            </span>
            {all > 0 && <span className="muted">{(((hist[tip.v] ?? 0) / all) * 100).toFixed(1)}% of kills</span>}
            {all > 0 && <span className="muted">{Math.round((faster(tip.v) / all) * 100)}% of kills were faster</span>}
            {tip.v === avgBin && <span style={{ color: 'var(--orange)' }}>Your average is in here</span>}
          </FloatTip>
        )}
      </div>
      <div className="axis">
        <span>{edge(first)}</span>
        <span>{edge(Math.round((first + last) / 2))}</span>
        <span>{edge(last)}</span>
      </div>
    </div>
  );
}

// ---- farming days (calendar) -------------------------------------------------------------

export type CalendarDays = { day: number; profit: number; kills: number }[];

export function CalendarCard() {
  const cal = useLive(() => api.calendar('me'), [], 300_000);
  return <CalendarView days={cal.data?.days} error={cal.error} />;
}

export function CalendarView({ days, error }: { days: CalendarDays | undefined; error?: string | null }) {
  const { tip, on, hide } = useHoverTip<CalendarDays[number]>();
  return (
    <Card title="Your farming days" side="last 26 weeks, UTC days">
      {!days ? (
        <Loading error={error} />
      ) : (
        (() => {
          const farmed = days.filter((d) => d.kills > 0);
          const max = Math.max(1, ...days.map((d) => d.profit));
          const best = farmed.reduce<(typeof days)[number] | null>((b, d) => (!b || d.profit > b.profit ? d : b), null);
          // Monday-first columns: pad the first week so rows line up with weekdays.
          const lead = (new Date(days[0]?.day ?? 0).getUTCDay() + 6) % 7;
          const cells: (CalendarDays[number] | null)[] = [...Array<null>(lead).fill(null), ...days];
          const level = (p: number) => (p <= 0 ? 0 : Math.min(4, 1 + Math.floor(Math.sqrt(p / max) * 4)));
          const avgDay = farmed.length > 0 ? farmed.reduce((n, d) => n + d.profit, 0) / farmed.length : 0;
          const weekday = (t: number) => new Date(t).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
          return (
            <>
              <div className="tip-host" onPointerLeave={hide}>
              <div className="cal-wrap" onScroll={hide} ref={(el) => {
                  if (el && !el.dataset.scrolled) {
                    el.scrollLeft = el.scrollWidth;
                    el.dataset.scrolled = '1';
                  }
                }}>
                <div className="cal-days" aria-hidden="true">
                  <span>Mon</span>
                  <span />
                  <span>Wed</span>
                  <span />
                  <span>Fri</span>
                  <span />
                  <span>Sun</span>
                </div>
                <div className="cal" role="img" aria-label={`${farmed.length} days farmed in the last 26 weeks`}>
                  {cells.map((d, i) => (d ? <span key={i} className={`cl${level(d.profit)}`} {...on(d)} /> : <span key={i} className="pad" />))}
                </div>
              </div>
              {tip && (
                <FloatTip at={tip}>
                  <span className="px">
                    {weekday(tip.v.day)} {dayLabel(tip.v.day)}
                  </span>
                  {tip.v.kills > 0 ? (
                    <>
                      <span>
                        <b>{coins(tip.v.profit)}</b> profit
                      </span>
                      <span className="muted">
                        {tip.v.kills.toLocaleString('en-GB')} kills · {coins(tip.v.profit / tip.v.kills)} a kill
                      </span>
                      {best && tip.v.day === best.day ? (
                        <span style={{ color: 'var(--orange)' }}>Your best day</span>
                      ) : (
                        avgDay > 0 && (
                          <span className={tip.v.profit >= avgDay ? 'gain' : 'loss'}>
                            {tip.v.profit >= avgDay ? '+' : '−'}
                            {Math.round(Math.abs(tip.v.profit / avgDay - 1) * 100)}% vs your average day
                          </span>
                        )
                      )}
                    </>
                  ) : (
                    <span className="muted">No farming</span>
                  )}
                </FloatTip>
              )}
              </div>
              <div className="cal-foot">
                <span className="muted small">
                  <b className="px">{farmed.length}</b> days farmed{best ? ` · best ${dayLabel(best.day)}, ${coins(best.profit)}` : ''}
                </span>
                <span className="cal-key muted tiny" aria-hidden="true">
                  less <i className="cl0" />
                  <i className="cl1" />
                  <i className="cl2" />
                  <i className="cl3" />
                  <i className="cl4" /> more
                </span>
              </div>
            </>
          );
        })()
      )}
    </Card>
  );
}

// ---- best hours (week heatmap) -----------------------------------------------------------

export type HeatCells = { profit: number; uptimeMs: number; perHour: number | null }[];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function HeatmapCard() {
  const hm = useLive(() => api.heatmap('me', 28), [], 300_000);
  return <HeatmapView cells={hm.data?.cells} error={hm.error} />;
}

export function HeatmapView({ cells, error }: { cells: HeatCells | undefined; error?: string | null }) {
  const { tip, on, hide } = useHoverTip<number>();
  return (
    <Card title="Your best hours" side="profit per hour of farming, last 4 weeks, UTC">
      {!cells ? (
        <Loading error={error} />
      ) : (
        (() => {
          const max = Math.max(1, ...cells.map((c) => c.perHour ?? 0));
          let best = -1;
          cells.forEach((c, i) => {
            if (c.perHour != null && (best < 0 || c.perHour > (cells[best]!.perHour ?? 0))) best = i;
          });
          return (
            <>
              <div className="tip-host" onPointerLeave={hide}>
              <div className="hm-wrap" onScroll={hide}>
                <div className="hm" role="img" aria-label="Profit per hour of farming for each hour of the week">
                  {WEEKDAYS.map((day, d) => (
                    <div className="hm-row" key={day}>
                      <span className="hm-day muted tiny">{day}</span>
                      {Array.from({ length: 24 }, (_, h) => {
                        const c = cells[d * 24 + h];
                        const v = c?.perHour ?? null;
                        const a = v == null || v <= 0 ? 0 : 0.15 + 0.85 * (v / max);
                        return (
                          <span
                            key={h}
                            className={v == null ? 'off' : undefined}
                            style={a > 0 ? { background: `rgba(255, 138, 31, ${a.toFixed(3)})` } : undefined}
                            {...on(d * 24 + h)}
                          />
                        );
                      })}
                    </div>
                  ))}
                  <div className="hm-row hm-hours" aria-hidden="true">
                    <span className="hm-day" />
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h} className="muted tiny">
                        {h % 6 === 0 ? String(h).padStart(2, '0') : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {tip &&
                (() => {
                  const c = cells[tip.v];
                  const h = tip.v % 24;
                  return (
                    <FloatTip at={tip}>
                      <span className="px">
                        {WEEKDAYS[Math.floor(tip.v / 24)]} {String(h).padStart(2, '0')}:00 – {String((h + 1) % 24).padStart(2, '0')}:00 UTC
                      </span>
                      {c?.perHour == null ? (
                        <span className="muted">No farming</span>
                      ) : (
                        <>
                          <span>
                            <b>{coins(c.perHour)}</b> an hour
                          </span>
                          {c.uptimeMs > 0 && (
                            <span className="muted">
                              {coins(c.profit)} over {duration(c.uptimeMs)} farmed
                            </span>
                          )}
                          {tip.v === best ? <span style={{ color: 'var(--orange)' }}>Your best hour</span> : <span className="muted">{Math.round((c.perHour / max) * 100)}% of your best hour</span>}
                        </>
                      )}
                    </FloatTip>
                  );
                })()}
              </div>
              <span className="muted small">
                {best >= 0 ? (
                  <>
                    Best: <b className="px">{WEEKDAYS[Math.floor(best / 24)]} {String(best % 24).padStart(2, '0')}:00</b>, {coins(cells[best]!.perHour ?? 0)} an hour
                  </>
                ) : (
                  'No farming in the last 4 weeks.'
                )}
              </span>
            </>
          );
        })()
      )}
    </Card>
  );
}

// ---- Bazaar price history -----------------------------------------------------------------

const PRICED = [
  ['SOUL_STRING', 'Soul String'],
  ['ESSENCE_SPIDER', 'Spider Essence'],
  ['ARACHNE_FRAGMENT', 'Arachne Fragment'],
] as const;
type Priced = (typeof PRICED)[number][0];
export type PricePoints = { t: number; instant: number | null; offer: number | null }[];

const HOUR = 3_600_000;
const DAY_MS = 86_400_000;
const SPANS = [
  ['1d', '1d'],
  ['5d', '5d'],
  ['1m', '1m'],
  ['3m', '3m'],
  ['6m', '6m'],
  ['1y', '1y'],
  ['5y', '5y'],
] as const;
type Span = (typeof SPANS)[number][0];
const SPAN_MS: Record<Span, number> = { '1d': DAY_MS, '5d': 5 * DAY_MS, '1m': 30 * DAY_MS, '3m': 91 * DAY_MS, '6m': 182 * DAY_MS, '1y': 365 * DAY_MS, '5y': 5 * 365 * DAY_MS };
const SPAN_WORDS: Record<Span, string> = { '1d': '24 hours', '5d': '5 days', '1m': '1 month', '3m': '3 months', '6m': '6 months', '1y': '1 year', '5y': '5 years' };
/** Zooming stops at an hour in and 5 years out. */
const MIN_SPAN = HOUR;
const MAX_SPAN = SPAN_MS['5y'];

/** The visible stretch of the price chart. `span` is the preset it came from, null after zooming. */
export interface PriceWindow {
  from: number;
  to: number;
  span: Span | null;
}
export const priceWindow = (span: Span, now = Date.now()): PriceWindow => ({ from: now - SPAN_MS[span], to: now, span });

/** "3 days", "7 weeks", "2.5 years": how long a zoomed window is. */
function spanWords(w: PriceWindow): string {
  if (w.span) return SPAN_WORDS[w.span];
  const ms = w.to - w.from;
  if (ms < 2 * DAY_MS) return `${Math.max(1, Math.round(ms / HOUR))} hours`;
  if (ms < 60 * DAY_MS) return `${Math.round(ms / DAY_MS)} days`;
  if (ms < 730 * DAY_MS) return `${Math.round(ms / (30.4 * DAY_MS))} months`;
  return `${(ms / (365 * DAY_MS)).toFixed(1).replace(/\.0$/, '')} years`;
}

/** Axis and tooltip labels that suit the window: clock times for a day, dates for months, month and year beyond. */
function timeLabel(span: number): (t: number) => string {
  if (span <= 2 * DAY_MS) return shortClock;
  if (span <= 400 * DAY_MS) return dayLabel;
  return (t) => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** Zoom a window by `factor` around the time `at`, kept inside the last 5 years and not past now. */
export function zoomWindow(w: PriceWindow, factor: number, at: number, now = Date.now()): PriceWindow {
  const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, (w.to - w.from) * factor));
  const f = (at - w.from) / Math.max(1, w.to - w.from);
  let from = at - f * span;
  let to = from + span;
  if (to > now) {
    to = now;
    from = now - span;
  }
  if (from < now - MAX_SPAN) {
    from = now - MAX_SPAN;
    to = Math.min(now, from + span);
  }
  return { from, to, span: null };
}

export function PriceCard() {
  const [item, setItem] = useState<Priced>('SOUL_STRING');
  const [view, setView] = useState<PriceWindow>(() => priceWindow('1m'));
  // Ask the server once the wheel settles; meanwhile the chart redraws what it already has.
  const [asked, setAsked] = useState(view);
  useEffect(() => {
    const t = setTimeout(() => setAsked(view), 250);
    return () => clearTimeout(t);
  }, [view]);
  const h = useLive(() => api.priceRange(item, Math.floor(asked.from), Math.ceil(asked.to)), [item, asked.from, asked.to], 600_000);
  return (
    <PriceView
      points={h.data?.item === item ? h.data.points : undefined}
      bucketMs={h.data?.bucketMs ?? HOUR}
      loading={!h.data || h.data.item !== item || h.data.from > Math.ceil(asked.from) + 60_000 || Math.abs(h.data.to - asked.to) > 60_000}
      error={h.error}
      item={item}
      setItem={setItem}
      view={view}
      setView={setView}
    />
  );
}

export function PriceView({
  points,
  bucketMs,
  loading,
  error,
  item,
  setItem,
  view,
  setView,
}: {
  points: PricePoints | undefined;
  bucketMs: number;
  loading?: boolean;
  error?: string | null;
  item: Priced;
  setItem: (i: Priced) => void;
  view: PriceWindow;
  setView: (w: PriceWindow) => void;
}) {
  const name = PRICED.find(([k]) => k === item)?.[1] ?? item;
  const span = view.to - view.from;
  const label = timeLabel(span);
  const ins = (points ?? []).filter((p) => p.instant != null && p.t >= view.from - bucketMs && p.t <= view.to) as PricePoint[];
  return (
    <Card title="Bazaar prices" side={<Seg label="Item" value={item} options={PRICED} onChange={setItem} />}>
      {!points ? (
        <Loading error={error} />
      ) : (
        (() => {
          const vals = ins.flatMap((p) => [p.instant, p.offer ?? p.instant]);
          const lo = vals.length ? Math.min(...vals) : 0;
          const hi = vals.length ? Math.max(...vals) : 1;
          const pad = Math.max(1, (hi - lo) * 0.15);
          const x = (t: number) => ((t - view.from) / Math.max(1, span)) * 1000;
          const y = (v: number) => 190 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * 180;
          const last = ins[ins.length - 1];
          const first = ins[0];
          const change = first && last && first.instant > 0 ? last.instant / first.instant - 1 : 0;
          return (
            <>
              <div className="price-head">
                {last ? <span className="px res-value">{coins(last.instant)}</span> : <span className="px res-value muted">–</span>}
                {ins.length >= 2 && (
                  <span className={`small ${Math.abs(change) < 0.005 ? 'muted' : change > 0 ? 'gain' : 'loss'}`}>
                    {change >= 0 ? '+' : '−'}
                    {Math.abs(change * 100).toFixed(1)}% in {spanWords(view)}
                  </span>
                )}
                <span className="legend">
                  <span>
                    <span className="dot" style={{ background: 'var(--orange)' }} />
                    Instant sell
                  </span>
                  <span>
                    <span className="dot" style={{ background: 'var(--blue)' }} />
                    Sell offer
                  </span>
                </span>
              </div>
              <div className="price-ranges">
                <Seg<Span | 'zoomed'> label="Time range" value={view.span ?? 'zoomed'} options={SPANS} onChange={(s) => s !== 'zoomed' && setView(priceWindow(s))} />
                <span className="muted tiny">{loading ? 'Loading…' : 'Scroll on the chart to zoom'}</span>
              </div>
              <PriceChart
                ins={ins}
                x={x}
                y={y}
                first={first}
                bucketMs={bucketMs}
                timeLabel={bucketMs < DAY_MS ? dateTime : span > 400 * DAY_MS ? (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : dayLabel}
                onZoom={(factor, f) => setView(zoomWindow(view, factor, view.from + f * span))}
                label={`${name} price over ${spanWords(view)}, ${coins(lo)} to ${coins(hi)}`}
                empty={ins.length < 2 ? (loading ? 'Loading…' : 'No price history for this stretch yet.') : null}
              />
              <div className="axis">
                <span>{label(view.from)}</span>
                <span>{ins.length >= 2 ? `${coins(lo)} – ${coins(hi)}` : ''}</span>
                <span>{view.to >= Date.now() - 5 * 60_000 ? 'now' : label(view.to)}</span>
              </div>
              <span className="muted tiny">
                Older and missed prices provided by{' '}
                <a href={`https://sky.coflnet.com/item/${item}`} target="_blank" rel="noopener noreferrer">
                  SkyCofl
                </a>
              </span>
            </>
          );
        })()
      )}
    </Card>
  );
}

type PricePoint = { t: number; instant: number; offer: number | null };

/** The two price lines, with the exact prices at the point under the pointer. The wheel zooms. */
function PriceChart({
  ins,
  x,
  y,
  first,
  bucketMs,
  timeLabel: when,
  onZoom,
  label,
  empty,
}: {
  ins: PricePoint[];
  x: (t: number) => number;
  y: (v: number) => number;
  first: PricePoint | undefined;
  bucketMs: number;
  timeLabel: (t: number) => string;
  /** factor > 1 zooms out; f is where the pointer is, 0 (left) to 1 (right). */
  onZoom: (factor: number, f: number) => void;
  label: string;
  empty: string | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const zoom = useRef(onZoom);
  zoom.current = onZoom;
  // A non-passive listener, so the page doesn't scroll while the wheel zooms the chart.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      // Down (or pinch out) shows more history, up shows less. Bigger flicks zoom further.
      zoom.current(Math.pow(1.0015, Math.max(-300, Math.min(300, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY))), f);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const h = hover != null ? ins[hover] : undefined;
  const pct = (a: number, b: number) => `${a >= b ? '+' : '−'}${Math.abs((a / b - 1) * 100).toFixed(1)}%`;
  const bucketWords = bucketMs >= DAY_MS ? `${Math.round(bucketMs / DAY_MS)} day${bucketMs >= 2 * DAY_MS ? 's' : ''}` : bucketMs >= HOUR ? `${Math.round(bucketMs / HOUR)} hour${bucketMs >= 2 * HOUR ? 's' : ''}` : `${Math.round(bucketMs / 60_000)} minutes`;
  return (
    <div className="chart price-chart" ref={box}>
      <svg
        viewBox="0 0 1000 200"
        height="180"
        width="100%"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          if (ins.length === 0) return;
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * 1000;
          // nearest point on screen: the points are sorted, so a binary search finds it
          let a = 0;
          let b = ins.length - 1;
          while (b - a > 1) {
            const m = (a + b) >> 1;
            if (x(ins[m]!.t) < px) a = m;
            else b = m;
          }
          setHover(Math.abs(x(ins[a]!.t) - px) <= Math.abs(x(ins[b]!.t) - px) ? a : b);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <path d="M0 55H1000M0 100H1000M0 145H1000" stroke="rgba(255,255,255,0.06)" fill="none" />
        {!empty && (
          <>
            <polyline points={ins.filter((p) => p.offer != null).map((p) => `${x(p.t)},${y(p.offer!)}`).join(' ')} stroke="var(--blue)" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />
            <polyline points={ins.map((p) => `${x(p.t)},${y(p.instant)}`).join(' ')} stroke="var(--orange)" strokeWidth="2.5" fill="none" vectorEffect="non-scaling-stroke" />
          </>
        )}
        {h && !empty && <path d={`M${x(h.t)} 0V200`} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" fill="none" vectorEffect="non-scaling-stroke" />}
      </svg>
      {empty && <span className="price-empty muted small">{empty}</span>}
      {h && !empty && (
        <>
          <span className="chart-dot" style={{ left: `${(x(h.t) / 1000) * 100}%`, top: (y(h.instant) / 200) * 180, background: 'var(--orange)' }} />
          {h.offer != null && <span className="chart-dot" style={{ left: `${(x(h.t) / 1000) * 100}%`, top: (y(h.offer) / 200) * 180, background: 'var(--blue)' }} />}
          <div className="tip" style={{ left: `clamp(0px, calc(${(x(h.t) / 1000) * 100}% + 12px), calc(100% - 220px))` }}>
            <span className="px">{when(h.t)}</span>
            <span className="tip-row">
              <span>
                <span className="dot" style={{ background: 'var(--orange)' }} /> Instant sell
              </span>
              <b>{fullCoins(h.instant)}</b>
            </span>
            {h.offer != null && (
              <span className="tip-row">
                <span>
                  <span className="dot" style={{ background: 'var(--blue)' }} /> Sell offer
                </span>
                <b>{fullCoins(h.offer)}</b>
              </span>
            )}
            {h.offer != null && h.instant > 0 && (
              <span className="tip-row muted">
                <span>Spread</span>
                <span>
                  {fullCoins(h.offer - h.instant)} ({((h.offer / h.instant - 1) * 100).toFixed(1)}%)
                </span>
              </span>
            )}
            {first && first.instant > 0 && hover! > 0 && (
              <span className={`tip-row ${Math.abs(h.instant / first.instant - 1) < 0.005 ? 'muted' : h.instant > first.instant ? 'gain' : 'loss'}`}>
                <span>Since {when(first.t)}</span>
                <span>{pct(h.instant, first.instant)}</span>
              </span>
            )}
            {bucketMs > 5 * 60_000 && <span className="muted tiny">average over {bucketWords}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ---- example data for the free plan's locked preview --------------------------------------

export function exampleTtk(): Ttk {
  const now = Date.now();
  const day = 86_400_000;
  const buckets = Array.from({ length: 7 }, (_, i) => ({ start: Math.floor(now / day) * day - (6 - i) * day, kills: 600 + i * 40, avgFightMs: 13_800 - i * 260 + (i % 2) * 300, avgSpawnMs: 16_400 }));
  const fightHist = [0, 0, 0, 40, 180, 520, 760, 610, 340, 160, 70, 30, 12, 6, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const totalHist = [...Array<number>(8).fill(0), ...fightHist.slice(0, 22)];
  return { days: 7, kills: 4870, withSpawn: 4870, avgFightMs: 12_900, avgSpawnMs: 16_400, medianFightMs: 12_700, bestFightMs: 6_300, buckets, fightHist, totalHist, binMs: 2_000 };
}

export function exampleCalendar(): CalendarDays {
  const day = 86_400_000;
  const start = Math.floor(Date.now() / day) * day - 181 * day;
  return Array.from({ length: 182 }, (_, i) => {
    const on = (i * 7) % 10 < 7;
    const profit = on ? 40_000_000 + ((i * 37) % 11) * 14_000_000 : 0;
    return { day: start + i * day, profit, kills: on ? 300 + ((i * 13) % 9) * 60 : 0 };
  });
}

export function exampleHeat(): HeatCells {
  return Array.from({ length: 168 }, (_, i) => {
    const h = i % 24;
    const on = h >= 16 && h <= 22;
    return { profit: 0, uptimeMs: 0, perHour: on ? 38_000_000 + ((i * 17) % 7) * 6_000_000 : null };
  });
}

export function examplePrices(): PricePoints {
  const day = 86_400_000;
  const start = Date.now() - 30 * day;
  return Array.from({ length: 30 * 24 }, (_, i) => {
    const v = 185_000 * (1 + 0.06 * Math.sin(i / 40) + 0.02 * Math.sin(i / 7));
    return { t: start + i * 3_600_000, instant: Math.round(v), offer: Math.round(v * 1.07) };
  });
}
