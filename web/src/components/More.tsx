import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { rarityColour } from '@arachne/shared';
import { api, type DropRates, type MarketRow } from '../api.ts';
import { coins, dayLabel, int, shortClock } from '../format.ts';
import { useLive } from '../hooks.ts';
import { AXIS, GRID, TIP } from './Charts.tsx';
import { Loading } from './Bits.tsx';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Orange from faint to full, by 0..1. */
const heat = (x: number) => `rgb(255 166 43 / ${0.08 + 0.92 * Math.max(0, Math.min(1, x))})`;

/**
 * Profit per hour of farming for every hour of the week. The darker squares are the hours
 * that paid best. Times are UTC, matching the "today" rule.
 */
export function WeekHeatmap({ cells }: { cells: { profit: number; uptimeMs: number; perHour: number | null }[] }) {
  const rates = cells.map((c) => c.perHour ?? 0);
  const max = Math.max(...rates, 1);
  if (cells.every((c) => c.perHour == null)) return <p className="empty">Not enough farming yet.</p>;
  return (
    <div className="heatmap" role="img" aria-label="Profit per hour by weekday and hour, UTC">
      <div className="hm-row hm-head">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h}>{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>
        ))}
      </div>
      {DAYS.map((d, di) => (
        <div className="hm-row" key={d}>
          <span>{d}</span>
          {Array.from({ length: 24 }, (_, h) => {
            const c = cells[di * 24 + h]!;
            return (
              <i
                key={h}
                style={{ background: c.perHour == null ? undefined : heat(c.perHour / max) }}
                data-tip={
                  c.perHour == null
                    ? `${d} ${String(h).padStart(2, '0')}:00 UTC: no farming`
                    : `${d} ${String(h).padStart(2, '0')}:00 UTC: ${coins(c.perHour)} an hour`
                }
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** One square per day for the last six months, like GitHub's contribution chart. */
export function FarmCalendar({ days }: { days: { day: number; profit: number; kills: number }[] }) {
  const max = Math.max(...days.map((d) => d.profit), 1);
  // Pad the start so columns are whole weeks starting on Monday.
  const first = new Date(days[0]?.day ?? Date.now());
  const pad = (first.getUTCDay() + 6) % 7;
  const farmed = days.filter((d) => d.kills > 0).length;
  return (
    <>
      <div className="calendar" role="img" aria-label={`${farmed} farming days in the last six months`}>
        {Array.from({ length: pad }, (_, i) => (
          <i key={`p${i}`} className="pad" />
        ))}
        {days.map((d) => (
          <i
            key={d.day}
            style={{ background: d.kills > 0 ? heat(d.profit / max) : undefined }}
            data-tip={d.kills > 0 ? `${dayLabel(d.day)}: ${coins(d.profit)}, ${int(d.kills)} kills` : `${dayLabel(d.day)}: nothing`}
          />
        ))}
      </div>
      <p className="chart-note">{farmed} days farmed in the last six months.</p>
    </>
  );
}

/** How much damage you do per fight. Left of the line (10,000) is not a kill. */
export function DamageChart({ values }: { values: number[] }) {
  if (values.length === 0) return <p className="empty">No fights in this range yet.</p>;
  // Buckets on a doubling scale, because damage runs from hundreds to millions.
  const edges = [0, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, Infinity];
  const data = edges.slice(0, -1).map((from, i) => ({ label: from === 0 ? '<1k' : `${from >= 1e6 ? `${from / 1e6}M` : `${from / 1e3}k`}+`, from, to: edges[i + 1]!, fights: 0 }));
  for (const v of values) data.find((b) => v >= b.from && v < b.to)!.fights++;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return (
    <>
      <div className="chart">
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis allowDecimals={false} width={48} {...AXIS} />
            <Tooltip {...TIP} formatter={(v) => [int(Number(v)), 'Fights']} />
            <Bar dataKey="fights" isAnimationActive={false} fill="#ffa62b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-note">Typical damage: {coins(median)}. A kill needs 10k.</p>
    </>
  );
}

/** "How lucky": drops seen against the wiki's base chances, in plain words. */
export function luckWords(luck: number | null): string {
  if (luck == null) return 'Not enough kills to tell.';
  const pct = Math.round(luck * 100);
  if (luck >= 1.25) return `Lucky: ${pct}% of the drops the base chances predict.`;
  if (luck >= 0.85) return `About as expected: ${pct}% of the drops the base chances predict.`;
  return `Unlucky so far: ${pct}% of the drops the base chances predict.`;
}

const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`);

/** Per-kill drop rates for each summon, next to the wiki's base chance. */
export function DropRatesPanel({ rates }: { rates: DropRates }) {
  const [tier, setTier] = useState<'CRYSTAL' | 'CALLING'>(() =>
    (rates.tiers.find((t) => t.tier === 'CALLING')?.kills ?? 0) > (rates.tiers.find((t) => t.tier === 'CRYSTAL')?.kills ?? 0) ? 'CALLING' : 'CRYSTAL',
  );
  const t = rates.tiers.find((x) => x.tier === tier)!;
  // Guaranteed drops have no chance to compare, only an amount; they get their own table.
  const every = t.items.filter((i) => i.wikiAmount != null).sort((a, b) => a.name.localeCompare(b.name));
  const chance = t.items.filter((i) => i.wikiAmount == null);
  return (
    <>
      <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
        <div className="switch" role="group" aria-label="Summon">
          {(['CRYSTAL', 'CALLING'] as const).map((x) => (
            <button key={x} type="button" aria-pressed={x === tier} onClick={() => setTier(x)}>
              {x === 'CRYSTAL' ? 'Crystal (Lv500)' : 'Callings (Lv300)'}
            </button>
          ))}
        </div>
        <span className="muted">{int(t.kills)} kills</span>
      </div>
      <p className={t.luck == null ? 'muted' : t.luck >= 0.85 ? 'gain' : 'loss'}>{luckWords(t.kills >= 10 ? t.luck : null)}</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Chance drops</th>
              <th className="num">Seen</th>
              <th className="num">Per kill</th>
              <th className="num" data-tip="Base chance from the SkyBlock wiki. Magic Find raises it.">
                Wiki
              </th>
            </tr>
          </thead>
          <tbody>
            {chance.map((i) => (
              <tr key={i.item}>
                <td className="wrap" style={{ color: rarityColour(i.item) }}>{i.name}</td>
                <td className="num">{int(i.fights)}</td>
                <td className="num">{t.kills > 0 ? pct(i.rate) : '-'}</td>
                <td className="num muted">{i.wiki != null ? pct(i.wiki) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {every.length > 0 && (
        <div className="table-scroll">
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Every kill</th>
                <th className="num">Total</th>
                <th className="num">Average</th>
                <th className="num" data-tip="Amount per kill listed on the SkyBlock wiki.">
                  Wiki
                </th>
              </tr>
            </thead>
            <tbody>
              {every.map((i) => {
                const w = i.wikiAmount!;
                const off = t.kills >= 10 && (i.perKill < w.min * 0.9 || i.perKill > w.max * 1.1);
                return (
                  <tr key={i.item}>
                    <td className="wrap" style={{ color: rarityColour(i.item) }}>{i.name}</td>
                    <td className="num">{int(i.total)}</td>
                    <td className={off ? 'num loss' : 'num'} data-tip={off ? 'Outside the wiki range: a missed pickup, or the wiki is out of date.' : undefined}>
                      {t.kills > 0 ? i.perKill.toLocaleString('en-GB', { maximumFractionDigits: 1 }) : '-'}
                    </td>
                    <td className="num muted">{w.min === w.max ? w.min : `${w.min}-${w.max}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="chart-note">"Seen" counts fights where it dropped. Wiki chances are base chances, before Magic Find. "Every kill" drops are averaged over all {int(t.kills)} kills.</p>
    </>
  );
}

/** Today's Bazaar price of each drop and how it moved in 24 hours. Click one for its chart. */
export function Market({ items }: { items: MarketRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const listed = items.filter((i) => i.price != null);
  if (listed.length === 0) return <p className="empty">No Bazaar prices yet. They arrive within 5 minutes of the server starting.</p>;
  return (
    <ul className="market">
      {listed.map((i) => (
        <li key={i.item}>
          <button type="button" className="market-row" aria-expanded={open === i.item} onClick={() => setOpen(open === i.item ? null : i.item)}>
            <span style={{ color: rarityColour(i.item) }}>{i.name}</span>
            <span>{coins(i.price!)}</span>
            <span
              className={i.change == null ? 'faint' : i.change >= 0 ? 'gain' : 'loss'}
              data-tip={marketNote(i)}
            >
              {i.change == null ? '' : `${i.change >= 0 ? '▲' : '▼'} ${Math.abs(i.change * 100).toFixed(1)}%`}
            </span>
          </button>
          {open === i.item && <PriceChart item={i.item} />}
        </li>
      ))}
    </ul>
  );
}

function PriceChart({ item }: { item: string }) {
  const [days, setDays] = useState(7);
  const h = useLive(() => api.priceHistory(item, days), [item, days], 300_000);
  return (
    <div className="price-chart">
      <div className="switch" role="group" aria-label="Range">
        {[1, 7, 30].map((d) => (
          <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)}>
            {d === 1 ? 'Day' : d === 7 ? 'Week' : 'Month'}
          </button>
        ))}
      </div>
      {!h.data ? (
        <Loading error={h.error} />
      ) : h.data.points.length < 2 ? (
        <p className="empty">Not enough price history yet.</p>
      ) : (
        <div className="chart small">
          <ResponsiveContainer>
            <LineChart data={h.data.points}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={days === 1 ? shortClock : dayLabel} {...AXIS} />
              <YAxis tickFormatter={coins} width={72} domain={['auto', 'auto']} {...AXIS} />
              <Tooltip {...TIP} labelFormatter={(t) => `${dayLabel(Number(t))} ${shortClock(Number(t))}`} formatter={(v, n) => [coins(Number(v)), n === 'instant' ? 'Instant sell' : 'Sell offer']} />
              <Line dataKey="instant" stroke="#ffa62b" dot={false} isAnimationActive={false} />
              <Line dataKey="offer" stroke="#f5ecdb" dot={false} strokeDasharray="4 3" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** The same drops priced all three ways, so you can see what selling differently would earn. */
export function WhatIf({ data }: { data: { actual: number; INSTANT_SELL: number; SELL_OFFER: number; NPC: number } }) {
  const rows: [string, number, string][] = [
    ['Instant sell', data.INSTANT_SELL, 'Sell straight away on the Bazaar.'],
    ['Sell offer', data.SELL_OFFER, 'List a sell offer and wait for a buyer.'],
    ['NPC', data.NPC, 'Sell to an NPC. What Ironman accounts get.'],
  ];
  const best = Math.max(...rows.map((r) => r[1]));
  return (
    <div className="table-scroll">
      <table>
        <tbody>
          {rows.map(([label, v, tip]) => (
            <tr key={label}>
              <td data-tip={tip}>{label}</td>
              <td className={`num ${v === best ? 'gain' : ''}`}>{coins(v)}</td>
              <td className="num muted">{v === best ? 'best' : `${coins(v - best)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Plain words for a price: thin market, and whether it is high or low for the month. */
function marketNote(i: MarketRow): string {
  const parts: string[] = [];
  if (i.percentile != null) {
    parts.push(
      i.percentile >= 0.8 ? 'High for the last 30 days: a good time to sell.' : i.percentile <= 0.2 ? 'Low for the last 30 days: holding may pay.' : 'About normal for the last 30 days.',
    );
  }
  if (i.spread != null && i.spread > 0.15) parts.push(`Big gap (${Math.round(i.spread * 100)}%) between instant sell and sell offer: a sell offer earns noticeably more.`);
  return parts.join(' ') || 'Change in the last 24 hours.';
}
