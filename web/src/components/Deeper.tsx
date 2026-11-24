import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, Treemap, XAxis, YAxis, ZAxis } from 'recharts';
import type { LootRow, Series } from '../api.ts';
import { accountColour, coins, duration, int } from '../format.ts';

/**
 * Pro charts worked out from the same range as the big chart: where the profit came from,
 * who was up when, what a crystal returns, and which drops paid.
 */

const AXIS = { stroke: '#82765f', tick: { fill: '#b8aa93', fontSize: 13 }, tickLine: false } as const;
const GRID = { stroke: 'rgb(255 225 185 / 0.08)', vertical: false } as const;
const TIP = { contentStyle: { background: '#2a221b', border: '1px solid #c77a12', borderRadius: 0 }, itemStyle: { color: '#f5ecdb' }, labelStyle: { color: '#b8aa93' } } as const;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Loot plus coins, minus what was spent, equals profit. */
export function ProfitWaterfall({ series }: { series: Series }) {
  const loot = sum(series.accounts.flatMap((a) => a.loot));
  const extra = sum(series.accounts.flatMap((a) => a.coins));
  const costs = sum(series.accounts.flatMap((a) => a.costs));
  const profit = loot + extra - costs;
  const data = [
    { name: 'Loot', base: 0, value: loot, fill: '#ffa62b' },
    { name: 'Coins', base: loot, value: extra, fill: '#ffd27a' },
    { name: 'Spent', base: loot + extra - costs, value: costs, fill: '#ff5a4f' },
    { name: 'Profit', base: Math.min(0, profit), value: Math.abs(profit), fill: profit >= 0 ? '#7bd88f' : '#ff5a4f' },
  ];
  return (
    <div className="chart">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="name" {...AXIS} />
          <YAxis tickFormatter={coins} width={72} {...AXIS} />
          <Tooltip {...TIP} formatter={(v, k) => (k === 'base' ? [null, null] : [coins(Number(v)), ''])} cursor={false} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="value" stackId="w" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Hours each account was up, next to real hours of farming (overlap counted once). */
export function UptimeBreakdown({ series }: { series: Series }) {
  const rows = series.accounts.map((a, i) => ({ name: a.name, ms: sum(a.uptimeMs), perHour: sum(a.uptimeMs) > 0 ? (sum(a.profit) / sum(a.uptimeMs)) * 3_600_000 : 0, i }));
  const wall = sum(series.wallUptimeMs);
  const client = sum(rows.map((r) => r.ms));
  return (
    <>
      <div className="chart">
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid {...GRID} horizontal={false} vertical />
            <XAxis type="number" tickFormatter={(v) => duration(Number(v))} {...AXIS} />
            <YAxis type="category" dataKey="name" width={110} {...AXIS} />
            <Tooltip {...TIP} formatter={(v, _k, p) => [`${duration(Number(v))}, ${coins((p.payload as { perHour: number }).perHour)}/h`, 'Up']} cursor={false} />
            <Bar dataKey="ms" isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.name} fill={accountColour(r.i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="muted">
        {duration(client)} of account time in {duration(wall)} of real time
        {wall > 0 && client > wall ? `: ${(client / wall).toFixed(1)} accounts up on average` : ''}.
      </p>
    </>
  );
}

/** What one crystal costs and what a crystal's worth of farming brought back. */
export function CrystalReturn({ series }: { series: Series }) {
  const crystals = sum(series.accounts.flatMap((a) => a.crystals));
  const kills = sum(series.accounts.flatMap((a) => a.kills));
  const costs = sum(series.accounts.flatMap((a) => a.costs));
  const back = sum(series.accounts.flatMap((a) => a.loot)) + sum(series.accounts.flatMap((a) => a.coins));
  if (crystals === 0) return <div className="empty-chart">No crystals placed in this range.</div>;
  const cost = costs / crystals;
  const ret = back / crystals;
  const ratio = cost > 0 ? ret / cost : null;
  return (
    <div className="roi">
      <div>
        <span className="roi-num">{coins(cost)}</span>
        <span className="muted">spent per crystal (with callings' costs)</span>
      </div>
      <div>
        <span className="roi-num">{coins(ret)}</span>
        <span className="muted">came back per crystal</span>
      </div>
      <div>
        <span className={`roi-num ${ratio != null && ratio >= 1 ? 'gain' : 'loss'}`}>{ratio == null ? '-' : `${ratio.toFixed(2)}x`}</span>
        <span className="muted">return; {int(kills)} kills from {int(crystals)} crystals</span>
      </div>
    </div>
  );
}

/** Each stretch of time as a dot: kills against profit. Loners stand out. */
export function KillsVsProfit({ series }: { series: Series }) {
  const data = Array.from({ length: series.buckets }, (_, i) => ({
    kills: sum(series.accounts.map((a) => a.kills[i] ?? 0)),
    profit: sum(series.accounts.map((a) => a.profit[i] ?? 0)),
  })).filter((d) => d.kills > 0);
  if (data.length < 3) return <div className="empty-chart">Not enough farming in this range.</div>;
  return (
    <div className="chart">
      <ResponsiveContainer>
        <ScatterChart>
          <CartesianGrid {...GRID} vertical />
          <XAxis type="number" dataKey="kills" name="Kills" {...AXIS} />
          <YAxis type="number" dataKey="profit" name="Profit" tickFormatter={coins} width={72} {...AXIS} />
          <ZAxis range={[40, 40]} />
          <Tooltip {...TIP} formatter={(v, k) => [k === 'Profit' ? coins(Number(v)) : int(Number(v)), k]} />
          <Scatter data={data} fill="#ffa62b" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Drops as boxes sized by what they were worth. */
export function LootTreemap({ loot }: { loot: LootRow[] }) {
  const data = loot.filter((l) => l.value > 0).map((l, i) => ({ name: l.name, size: l.value, fill: accountColour(i) }));
  if (data.length === 0) return <div className="empty-chart">No drops in this range.</div>;
  return (
    <div className="chart tall">
      <ResponsiveContainer>
        <Treemap data={data} dataKey="size" stroke="#1b1510" isAnimationActive={false} content={<TreeBox />} />
      </ResponsiveContainer>
    </div>
  );
}

function TreeBox(props: { x?: number; y?: number; width?: number; height?: number; name?: string; size?: number; fill?: string }) {
  const { x = 0, y = 0, width = 0, height = 0, name = '', size = 0, fill = '#ffa62b' } = props;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.75} stroke="#1b1510" strokeWidth={2} />
      {width > 70 && height > 34 && (
        <>
          <text x={x + 6} y={y + 18} fill="#1b1510" fontSize={13}>
            {name.length * 7 > width - 10 ? `${name.slice(0, Math.max(3, Math.floor((width - 10) / 7) - 1))}…` : name}
          </text>
          <text x={x + 6} y={y + 34} fill="#1b1510" fontSize={13}>
            {coins(size)}
          </text>
        </>
      )}
    </g>
  );
}

/** An invented range for the Pro previews. */
export function exampleSeries(): Series {
  const n = 24;
  const wave = (k: number, base: number, amp: number) => Array.from({ length: n }, (_, i) => Math.max(0, Math.round(base + amp * Math.sin((i + k) / 2.3))));
  const acct = (name: string, k: number) => {
    const kills = wave(k, 6, 5);
    const loot = kills.map((x) => x * 1_250_000);
    const costs = kills.map((x) => (x > 0 ? x * 420_000 : 0));
    return {
      uuid: name,
      name,
      kills,
      loot,
      coins: kills.map((x) => x * 9_000),
      costs,
      profit: loot.map((l, i) => l - costs[i]!),
      crystals: kills.map((x) => Math.round(x * 0.4)),
      uptimeMs: kills.map((x) => (x > 0 ? 3_000_000 : 0)),
      segments: [],
    };
  };
  const accounts = [acct('Main', 0), acct('Alt', 3)];
  return { range: '24h', from: 0, to: n * 3_600_000, bucketMs: 3_600_000, buckets: n, accounts, wallUptimeMs: Array.from({ length: n }, () => 3_400_000) };
}

export const exampleLoot: LootRow[] = [
  ['Enchanted String', 48_000_000],
  ['Soul String', 22_000_000],
  ["Arachne's Fragment", 17_500_000],
  ['Enchanted Spider Eye', 15_000_000],
  ['Tarantula Pet (Legendary)', 9_800_000],
  ["Arachne's Leggings", 3_100_000],
  ['Arack', 1_400_000],
].map(([name, value]) => ({ item: String(name), name: String(name), count: 1, value: Number(value) }) as LootRow);
