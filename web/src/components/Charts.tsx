import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { rarityColour } from '@arachne/shared';
import { useState } from 'react';
import type { Fight, LootRow, Series } from '../api.ts';
import { accountColour, coins, dayLabel, duration, int, shortClock } from '../format.ts';

/*
 * Every chart on the Graphs page. Each one takes the same `Series` (time buckets per
 * account, from GET /api/series) and reshapes it into rows for Recharts:
 *
 *   [{ t: <bucket start>, total: 1200, "<uuid>": 400, ... }, ...]
 *
 * Recharts then draws one line/bar per key. Styling is shared through the AXIS, GRID and
 * TIP constants so every chart looks the same.
 */

export const AXIS = { stroke: '#82765f', tick: { fill: '#b8aa93' }, tickLine: false } as const;
export const GRID = { stroke: 'rgba(255,225,185,0.08)', vertical: false } as const;
export const TIP = {
  // No slide animation: the box jumps straight to the bar under the mouse.
  isAnimationActive: false,
  contentStyle: { background: '#2a221b', border: '2px solid #000', borderRadius: 0 },
  labelStyle: { color: '#b8aa93' },
  cursor: { fill: 'rgba(255,225,185,0.06)' },
} as const;

/** Bucket start → axis label: clock time for a day, weekday + hour for a week, date for a month. */
function bucketLabel(series: Series) {
  return (t: number) =>
    series.range === '24h' || series.range === 'session'
      ? shortClock(t)
      : series.range === '7d'
        ? `${new Date(t).toLocaleDateString('en-GB', { weekday: 'short' })} ${shortClock(t)}`
        : dayLabel(t);
}

/** "15 minutes", "2 hours", "day": what one bar covers, for chart notes. */
export function bucketName(series: Series) {
  const m = series.bucketMs / 60_000;
  if (m < 60) return m === 1 ? 'minute' : `${m} minutes`;
  if (m < 1440) return m === 60 ? 'hour' : `${m / 60} hours`;
  return 'day';
}

type Row = Record<string, number>;

/** One row per bucket, with a column per account plus a `total`. */
function rows(series: Series, pick: (a: Series['accounts'][number], i: number) => number, cumulative = false): Row[] {
  const running = new Map<string, number>();
  return Array.from({ length: series.buckets }, (_, i) => {
    const row: Row = { t: series.from + i * series.bucketMs, total: 0 };
    for (const a of series.accounts) {
      let v = pick(a, i);
      if (cumulative) {
        v += running.get(a.uuid) ?? 0;
        running.set(a.uuid, v);
      }
      row[a.uuid] = v;
      row.total! += v;
    }
    return row;
  });
}

const names = (series: Series) => new Map(series.accounts.map((a) => [a.uuid, a.name]));

type Metric = 'profit' | 'loot' | 'coins' | 'costs' | 'crystals' | 'kills' | 'uptimeMs';

/** True if any account has a non-zero value for `metric` anywhere in the range. */
export function hasData(series: Series, ...metrics: Metric[]): boolean {
  return series.accounts.some((a) => metrics.some((m) => a[m].some((v) => v !== 0)));
}

/**
 * Drop the empty stretch at the start of a range, so a short burst of farming fills the
 * chart instead of hugging its right edge. Keeps one empty bucket before the first activity.
 */
export function trimLeading(series: Series): Series {
  let first = series.buckets;
  for (const a of series.accounts) {
    const i = a.uptimeMs.findIndex((v, k) => v > 0 || a.profit[k] !== 0 || a.kills[k]! > 0);
    if (i >= 0) first = Math.min(first, i);
  }
  const cut = Math.max(0, Math.min(first - 1, series.buckets - 2));
  if (cut <= 0) return series;
  return {
    ...series,
    from: series.from + cut * series.bucketMs,
    buckets: series.buckets - cut,
    wallUptimeMs: series.wallUptimeMs.slice(cut),
    accounts: series.accounts.map((a) => ({
      ...a,
      profit: a.profit.slice(cut),
      loot: a.loot.slice(cut),
      coins: a.coins.slice(cut),
      costs: a.costs.slice(cut),
      crystals: a.crystals.slice(cut),
      kills: a.kills.slice(cut),
      uptimeMs: a.uptimeMs.slice(cut),
    })),
  };
}

/** Running total of profit for everyone together. */
export function ProfitTotal({ series, tall, big }: { series: Series; tall?: boolean; big?: boolean }) {
  const data = rows(series, (a, i) => a.profit[i] ?? 0, true);
  return (
    <div className={big ? 'chart big' : tall ? 'chart tall' : 'chart'}>
      <ResponsiveContainer>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffa62b" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#ffa62b" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="t" tickFormatter={bucketLabel(series)} minTickGap={40} {...AXIS} />
          <YAxis tickFormatter={coins} width={72} {...AXIS} />
          <Tooltip {...TIP} labelFormatter={(t) => bucketLabel(series)(Number(t))} formatter={(v) => [coins(Number(v)), 'Profit so far']} />
          <Area type="stepAfter" dataKey="total" stroke="#ffa62b" strokeWidth={2} fill="url(#profitFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Profit made in each bucket, stacked by account. Losing buckets hang below zero. */
export function ProfitPerBucket({ series, big }: { series: Series; big?: boolean }) {
  const data = rows(series, (a, i) => a.profit[i] ?? 0);
  const n = names(series);
  return (
    <div className={big ? 'chart big' : 'chart'}>
      <ResponsiveContainer>
        <BarChart data={data} stackOffset="sign">
          <CartesianGrid {...GRID} />
          <XAxis dataKey="t" tickFormatter={bucketLabel(series)} minTickGap={40} {...AXIS} />
          <YAxis tickFormatter={coins} width={72} {...AXIS} />
          <ReferenceLine y={0} stroke="#82765f" />
          <Tooltip {...TIP} labelFormatter={(t) => bucketLabel(series)(Number(t))} formatter={(v, k) => [coins(Number(v)), n.get(String(k)) ?? k]} />
          {series.accounts.map((a, i) => (
            <Bar key={a.uuid} dataKey={a.uuid} stackId="p" fill={accountColour(i)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Each account's running profit as its own line, to compare them. */
export function AccountsRace({ series, big }: { series: Series; big?: boolean }) {
  const data = rows(series, (a, i) => a.profit[i] ?? 0, true);
  const n = names(series);
  return (
    <div className={big ? 'chart big' : 'chart'}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="t" tickFormatter={bucketLabel(series)} minTickGap={40} {...AXIS} />
          <YAxis tickFormatter={coins} width={72} {...AXIS} />
          <Tooltip {...TIP} labelFormatter={(t) => bucketLabel(series)(Number(t))} formatter={(v, k) => [coins(Number(v)), n.get(String(k)) ?? k]} />
          {series.accounts.map((a, i) => (
            <Line key={a.uuid} type="stepAfter" dataKey={a.uuid} stroke={accountColour(i)} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Kills in each bucket, stacked by account. */
export function KillsChart({ series, big }: { series: Series; big?: boolean }) {
  const data = rows(series, (a, i) => a.kills[i] ?? 0);
  const n = names(series);
  return (
    <div className={big ? 'chart big' : 'chart'}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="t" tickFormatter={bucketLabel(series)} minTickGap={40} {...AXIS} />
          <YAxis allowDecimals={false} width={48} {...AXIS} />
          <Tooltip {...TIP} labelFormatter={(t) => bucketLabel(series)(Number(t))} formatter={(v, k) => [int(Number(v)), n.get(String(k)) ?? k]} />
          {series.accounts.map((a, i) => (
            <Bar key={a.uuid} dataKey={a.uuid} stackId="k" fill={accountColour(i)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Money in (drops, Scavenger coins) above the line, money out (crystals) below it. */
export function MoneyInOut({ series, big }: { series: Series; big?: boolean }) {
  const sum = (key: 'loot' | 'coins' | 'costs', i: number) => series.accounts.reduce((s, a) => s + (a[key][i] ?? 0), 0);
  const data = Array.from({ length: series.buckets }, (_, i) => ({
    t: series.from + i * series.bucketMs,
    drops: sum('loot', i),
    coins: sum('coins', i),
    costs: -sum('costs', i),
  }));
  const label: Record<string, string> = { drops: 'Drops', coins: 'Scavenger coins', costs: 'Crystals and callings' };
  return (
    <>
      <div className={big ? 'chart big' : 'chart'}>
        <ResponsiveContainer>
          <BarChart data={data} stackOffset="sign">
            <CartesianGrid {...GRID} />
            <XAxis dataKey="t" tickFormatter={bucketLabel(series)} minTickGap={40} {...AXIS} />
            <YAxis tickFormatter={coins} width={72} {...AXIS} />
            <ReferenceLine y={0} stroke="#82765f" />
            <Tooltip {...TIP} labelFormatter={(t) => bucketLabel(series)(Number(t))} formatter={(v, k) => [coins(Number(v)), label[String(k)] ?? k]} />
            <Bar dataKey="drops" stackId="m" fill="#ffa62b" isAnimationActive={false} />
            <Bar dataKey="coins" stackId="m" fill="#ffd27a" isAnimationActive={false} />
            <Bar dataKey="costs" stackId="m" fill="#9c8f7c" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        <span>
          <span className="swatch" style={{ background: '#ffa62b' }} />
          Drops
        </span>
        <span>
          <span className="swatch" style={{ background: '#ffd27a' }} />
          Scavenger coins
        </span>
        <span>
          <span className="swatch" style={{ background: '#9c8f7c' }} />
          Spent on crystals
        </span>
      </div>
    </>
  );
}

/** Crystals placed in each bucket, stacked by account. */
export function CrystalsChart({ series, big }: { series: Series; big?: boolean }) {
  const data = rows(series, (a, i) => a.crystals[i] ?? 0);
  const n = names(series);
  return (
    <div className={big ? 'chart big' : 'chart'}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="t" tickFormatter={bucketLabel(series)} minTickGap={40} {...AXIS} />
          <YAxis allowDecimals={false} width={48} {...AXIS} />
          <Tooltip {...TIP} labelFormatter={(t) => bucketLabel(series)(Number(t))} formatter={(v, k) => [int(Number(v)), n.get(String(k)) ?? k]} />
          {series.accounts.map((a, i) => (
            <Bar key={a.uuid} dataKey={a.uuid} stackId="c" fill={accountColour(i)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const OTHER_COLOUR = '#6b6052';

/**
 * Lighten or darken a hex colour. Drops of the same rarity share a colour, so the second
 * and third of a rarity get a lighter and a darker shade to stay distinguishable.
 */
function shade(hex: string, step: number): string {
  if (step === 0) return hex;
  const amount = [0, 0.35, -0.35, 0.6, -0.55][step % 5]!;
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount)),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Ring chart of what made the money, each drop in its SkyBlock rarity colour. */
export function LootDonut({ loot }: { loot: LootRow[] }) {
  const sorted = loot.filter((l) => l.value > 0).sort((a, b) => b.value - a.value);
  const seen = new Map<string, number>();
  const top = sorted.slice(0, 7).map((l) => {
    const base = rarityColour(l.item);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { name: l.name, value: l.value, colour: shade(base, n) };
  });
  const rest = sorted.slice(7).reduce((s, l) => s + l.value, 0);
  if (rest > 0) top.push({ name: 'Other', value: rest, colour: OTHER_COLOUR });
  const total = top.reduce((s, l) => s + l.value, 0);
  return <Donut data={top} total={total} centre={coins(total)} format={coins} />;
}

const OUTCOME_COLOUR: Record<string, string> = {
  Kill: '#ffa62b',
  'Too little damage': '#ffd27a',
  'No damage': '#ff7a3d',
  'No damage line': '#9c8f7c',
  'Left mid-fight': '#6b6052',
  'Still going': '#f5ecdb',
};

const OUTCOME_LABEL: Record<Fight['outcome'], string> = {
  COUNTED: 'Kill',
  LOW_DAMAGE: 'Too little damage',
  ZERO_DAMAGE: 'No damage',
  MISSING_DAMAGE: 'No damage line',
  INTERRUPTED: 'Left mid-fight',
  OPEN: 'Still going',
};

/** Ring chart of how fights ended. */
export function FightResults({ fights }: { fights: Fight[] }) {
  const counts = new Map<string, number>();
  for (const f of fights) counts.set(OUTCOME_LABEL[f.outcome], (counts.get(OUTCOME_LABEL[f.outcome]) ?? 0) + 1);
  const data = [...counts]
    .map(([name, value]) => ({ name, value, colour: OUTCOME_COLOUR[name] ?? OTHER_COLOUR }))
    .sort((a, b) => b.value - a.value);
  const kills = counts.get('Kill') ?? 0;
  const pct = fights.length ? Math.round((kills / fights.length) * 100) : 0;
  return <Donut data={data} total={fights.length} centre={`${pct}%`} centreLabel="kills" format={int} />;
}

function Donut({
  data,
  total,
  centre,
  centreLabel,
  format,
}: {
  data: { name: string; value: number; colour: string }[];
  total: number;
  centre: string;
  centreLabel?: string;
  format: (n: number) => string;
}) {
  if (data.length === 0) return <p className="empty">Nothing in this range yet.</p>;
  return (
    <div className="grid-2" style={{ alignItems: 'center', gap: 12 }}>
      <div className="chart" style={{ position: 'relative' }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" stroke="#000" strokeWidth={2} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.colour} />
              ))}
            </Pie>
            <Tooltip {...TIP} formatter={(v, k) => [format(Number(v)), k]} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>
          {/* The ring's hole fits about five big characters; longer values use the small size. */}
          <div style={{ fontSize: centre.length > 5 ? 16 : 32, fontWeight: 700 }}>{centre}</div>
          {centreLabel && <div className="muted">{centreLabel}</div>}
        </div>
      </div>
      <div className="legend" style={{ display: 'grid', gap: 6 }}>
        {data.map((d) => (
          <span key={d.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: d.colour === OTHER_COLOUR ? undefined : d.colour }}>
              <span className="swatch" style={{ background: d.colour }} />
              {d.name}
            </span>
            <span style={{ color: '#f5ecdb' }}>{total > 0 ? `${Math.round((d.value / total) * 100)}%` : ''}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** How long kills take: fights grouped into 2-second bins. */
export function FightTimes({ fights }: { fights: Fight[] }) {
  const times = fights.filter((f) => f.outcome === 'COUNTED' && f.durationMs != null).map((f) => f.durationMs! / 1000);
  if (times.length === 0) return <p className="empty">No timed kills in this range yet.</p>;
  const bin = 2;
  const max = Math.min(Math.ceil(Math.max(...times) / bin) * bin, 120);
  const data = Array.from({ length: max / bin }, (_, i) => ({ from: i * bin, kills: 0 }));
  for (const t of times) data[Math.min(Math.floor(t / bin), data.length - 1)]!.kills++;
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  return (
    <>
      <div className="chart">
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="from" tickFormatter={(s) => `${s}s`} {...AXIS} />
            <YAxis allowDecimals={false} width={48} {...AXIS} />
            <Tooltip {...TIP} labelFormatter={(s) => `${s} to ${Number(s) + bin} seconds`} formatter={(v) => [int(Number(v)), 'Kills']} />
            <Bar dataKey="kills" fill="#ffa62b" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-note">
        Average kill: {avg.toFixed(1)}s. Fastest: {Math.min(...times).toFixed(1)}s.
      </p>
    </>
  );
}

/**
 * When each account was farming: one row per account, a solid bar wherever its uptime
 * clock was running. Plain SVG: it is just "time → x position". Hovering a bar shows its
 * times straight away (an SVG <title> would wait about a second).
 */
export function Timeline({ series, now }: { series: Series; now: number }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const width = 1000;
  const left = 150;
  const rowH = 32;
  const top = 6;
  const height = top + series.accounts.length * rowH + 28;
  const span = series.to - series.from;
  const x = (t: number) => left + ((Math.min(Math.max(t, series.from), series.to) - series.from) / span) * (width - left - 8);
  const hourly = series.range === '24h' || series.range === 'session';
  const step = series.range === 'session' ? niceStep(span) : series.range === '24h' ? 3 * 3_600_000 : series.range === '7d' ? 86_400_000 : 5 * 86_400_000;
  const ticks: number[] = [];
  for (let t = Math.ceil(series.from / step) * step; t < series.to; t += step) ticks.push(t);
  const label = hourly ? shortClock : dayLabel;
  if (series.accounts.length === 0) return <p className="empty">No accounts yet.</p>;
  return (
    <div className="timeline-wrap" onMouseLeave={() => setHover(null)}>
      <svg className="timeline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="When each account was farming">
        {ticks.map((t) => (
          <g key={t}>
            <line className="tick" x1={x(t)} x2={x(t)} y1={top} y2={height - 24} />
            <text x={x(t)} y={height - 6} textAnchor="middle">
              {label(t)}
            </text>
          </g>
        ))}
        {series.accounts.map((a, i) => {
          const y = top + i * rowH + rowH / 2;
          return (
            <g key={a.uuid}>
              <text className="name" x={0} y={y + 5}>
                {a.name.length > 14 ? `${a.name.slice(0, 13)}…` : a.name}
              </text>
              <line className="thread" x1={left} x2={width - 8} y1={y} y2={y} />
              {a.segments
                .filter((seg) => seg.end > series.from)
                .map((seg) => (
                  <rect
                    key={seg.start}
                    className="run"
                    x={x(seg.start)}
                    y={y - 8}
                    width={Math.max(x(seg.end) - x(seg.start), 1)}
                    height={16}
                    fill={accountColour(i)}
                    stroke="#000"
                    strokeWidth={2}
                    onMouseEnter={(e) => {
                      const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      const scale = box.width / width;
                      setHover({
                        x: ((x(seg.start) + x(seg.end)) / 2) * scale,
                        y: (y - 8) * scale,
                        text: `${a.name}: ${shortClock(seg.start)} to ${shortClock(seg.end)} (${duration(seg.end - seg.start)})`,
                      });
                    }}
                  />
                ))}
            </g>
          );
        })}
        {now >= series.from && now <= series.to && <line className="now" x1={x(now)} x2={x(now)} y1={top} y2={height - 24} />}
      </svg>
      {hover && (
        <div className="timeline-tip" style={{ left: hover.x, top: hover.y }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}

/** Tick spacing for an arbitrary span: about six labels, on round clock times. */
function niceStep(span: number): number {
  const steps = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * 60_000);
  return steps.find((st) => span / st <= 7) ?? 86_400_000;
}
