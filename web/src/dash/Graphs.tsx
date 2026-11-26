/* Graphs (Pro): each member as a line over 7 days, today's projection, where the profit comes from, time to kill,
   your farming days and best hours, Bazaar prices, and your drops against the wiki. */
import { useState, type PointerEvent } from 'react';
import { api, type DropRates } from '../api.ts';
import { coins, dateTime, dayLabel, shortClock } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';
import { useIsPro } from '../components/Locked.tsx';
import { platform, type Group } from '../platform-api.ts';
import { ESSENCE, SOUL, groupLoot, lootOf, startOfUtcDay, sumSeries, type User } from './data.ts';
import { Card, Loading, ProLock, colourAt } from './ui.tsx';
import type { Go } from './App.tsx';
import { itemIcon } from '../item-icons.ts';
import { CalendarCard, CalendarView, HeatmapCard, HeatmapView, PriceCard, PriceView, TtkCard, TtkView, exampleCalendar, exampleHeat, examplePrices, exampleTtk, priceWindow } from './MoreGraphs.tsx';

interface Lines {
  from: number;
  bucketMs: number;
  lines: { name: string; colour: string; values: number[] }[];
}
interface Projection {
  soFar: number[];
  /** Fraction of the day gone, 0 to 1. */
  dayGone: number;
  now: number;
  projected: number;
}
interface Source {
  name: string;
  /** Item ID for its picture (src/item-icons.ts), if it has one. */
  item?: string;
  value: number;
  colour: string;
}
interface Rate {
  name: string;
  item?: string;
  you: number;
  wiki: number;
  kills: number;
}

export function Graphs({ user, group, go }: { user: User; group: Group | null; go: Go }) {
  const pro = useIsPro();
  return (
    <main className="dpage">
      <div className="dhead">
        <div className="dhead-words">
          <h1 className="px dh1">Graphs</h1>
          <span className="soft">{group ? `${group.name}, and your own drops.` : 'Join a group to compare members.'}</span>
        </div>
        {!pro && <span className="px tag tag-latest">Pro</span>}
      </div>
      {pro ? group ? <Real group={group} user={user} /> : <NoGroup go={go} /> : <Example />}
    </main>
  );
}

function NoGroup({ go }: { go: Go }) {
  return (
    <section className="panel card">
      <p className="soft">Graphs compare the members of a group. You're not in one yet.</p>
      <div>
        <button type="button" className="btn btn-main" onClick={() => go('/start')}>
          Join or create a group
        </button>
      </div>
    </section>
  );
}

function Real({ group, user: _user }: { group: Group; user: User }) {
  const now = useNow(60_000);
  const g = useLive(() => platform.group(group.id), [group.id], 60_000);
  const ov = useLive(() => api.overview('group'), [], 60_000);
  const week = useLive(() => api.series('7d'), [], 120_000);
  const day = useLive(() => api.series('24h'), [], 60_000);
  const loot = useLive(() => groupLoot('week', group.id), [group.id], 120_000);
  const rates = useLive(() => api.dropRates('me'), [], 300_000);
  if (!g.data || !ov.data || !week.data) return <Loading error={g.error ?? ov.error ?? week.error} />;

  const members = g.data.members.filter((m) => !m.hidden);
  const ownerOf = new Map(ov.data.accounts.map((a) => [a.uuid, a.userId]));
  const lines: Lines = {
    from: week.data.from,
    bucketMs: week.data.bucketMs,
    lines: members.map((m, i) => {
      const uuids = new Set(week.data!.accounts.filter((a) => ownerOf.get(a.uuid) === m.userId).map((a) => a.uuid));
      let run = 0;
      return { name: m.name, colour: colourAt(i), values: sumSeries(week.data, uuids).map((v) => (run += v)) };
    }),
  };

  const all = new Set(ov.data.accounts.filter((a) => a.userId != null && members.some((m) => m.userId === a.userId)).map((a) => a.uuid));
  const start = startOfUtcDay(now);
  const dayVals = day.data ? sumSeries(day.data, all) : [];
  let run = 0;
  const soFar = day.data ? dayVals.flatMap((v, i) => (day.data!.from + (i + 1) * day.data!.bucketMs > start ? [(run += v)] : [])) : [];
  const gone = Math.min(1, Math.max(0.01, (now - start) / 86_400_000));
  const today = g.data.totals.today.profit;
  const projection: Projection = { soFar: [0, ...soFar], dayGone: gone, now, projected: gone > 0.04 ? today / gone : today };

  const t = g.data.totals.week;
  const soul = lootOf(loot.data?.loot, SOUL);
  const ess = lootOf(loot.data?.loot, ESSENCE);
  const sources: Source[] = [
    { name: 'Soul String', item: 'SOUL_STRING', value: soul.value, colour: '#9fc2ff' },
    { name: 'Scavenger coins', item: 'COINS', value: t.coins, colour: 'var(--orange)' },
    { name: 'Spider Essence', item: 'ESSENCE_SPIDER', value: ess.value, colour: '#d7bcff' },
    { name: 'Everything else', value: Math.max(0, t.lootValue - soul.value - ess.value), colour: '#55555c' },
  ];

  return (
    <>
      <MemberLines data={lines} title={`${group.name} profit, last 7 days`} />
      <div className="cols">
        <ProjectionCard p={projection} />
        <SourcesCard sources={sources} ready={!!loot.data} />
      </div>
      <TtkCard group={group} />
      <div className="cols">
        <div className="col-half">
          <CalendarCard />
        </div>
        <div className="col-half">
          <HeatmapCard />
        </div>
      </div>
      <PriceCard />
      <RatesCard rows={rates.data ? ratesOf(rates.data) : null} error={rates.error} />
    </>
  );
}

function ratesOf(d: DropRates): Rate[] {
  const out: Rate[] = [];
  for (const tier of d.tiers) {
    for (const it of tier.items) {
      if ((it.item !== SOUL && it.item !== ESSENCE) || !it.wikiAmount) continue;
      out.push({ name: `${it.item === SOUL ? 'Soul String' : 'Spider Essence'} a ${tier.tier === 'CRYSTAL' ? 'crystal' : 'callings'} kill`, item: it.item, you: it.perKill, wiki: (it.wikiAmount.min + it.wikiAmount.max) / 2, kills: tier.kills });
    }
  }
  return out;
}

// ---- the cards ----

function MemberLines({ data, title }: { data: Lines; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, ...data.lines.map((l) => l.values.length));
  const max = Math.max(1, ...data.lines.flatMap((l) => l.values));
  const x = (i: number) => (i / Math.max(1, n - 1)) * 1000;
  const y = (v: number) => 295 - (Math.max(0, v) / max) * 285;
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
  };
  const days = Array.from({ length: 7 }, (_, i) => data.from + ((i + 0.5) * (n * data.bucketMs)) / 7);
  const sorted = hover == null ? [] : [...data.lines].sort((a, b) => (b.values[hover] ?? 0) - (a.values[hover] ?? 0));
  const gained = (l: Lines['lines'][number], i: number) => (l.values[i] ?? 0) - (i > 0 ? (l.values[i - 1] ?? 0) : 0);
  const groupTotal = hover == null ? 0 : data.lines.reduce((n, l) => n + (l.values[hover] ?? 0), 0);
  const groupGain = hover == null ? 0 : data.lines.reduce((n, l) => n + gained(l, hover), 0);
  const step = Math.round(data.bucketMs / 60_000);
  const stepWord = step % 60 === 0 ? `${step / 60 === 1 ? 'hour' : `${step / 60}h`}` : `${step}m`;
  return (
    <Card
      title={<span className="dh2">{title}</span>}
      side={
        <span className="legend">
          {data.lines.map((l) => (
            <span key={l.name}>
              <span className="dot" style={{ background: l.colour }} />
              <span className="px">{l.name}</span>
            </span>
          ))}
        </span>
      }
    >
      <div className="chart">
        <svg viewBox="0 0 1000 300" height="300" preserveAspectRatio="none" role="img" aria-label="Running profit per member over the last 7 days" onPointerMove={move} onPointerLeave={() => setHover(null)}>
          <path d="M0 75H1000M0 150H1000M0 225H1000" stroke="rgba(255,255,255,0.06)" fill="none" />
          {data.lines.map((l, li) => (
            <polyline key={l.name} points={l.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} stroke={l.colour} strokeWidth={li === 0 ? 3 : 2} fill="none" vectorEffect="non-scaling-stroke" />
          ))}
          {hover != null && <path d={`M${x(hover)} 0V300`} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" fill="none" vectorEffect="non-scaling-stroke" />}
        </svg>
        {hover != null && (
          <div className="tip" style={{ left: `clamp(0px, calc(${(hover / Math.max(1, n - 1)) * 100}% + 12px), calc(100% - 260px))` }}>
            <span className="px">{dateTime(data.from + (hover + 1) * data.bucketMs)}</span>
            {sorted.map((l, rank) => {
              const g = gained(l, hover);
              return (
                <span key={l.name} className="tip-row">
                  <span>
                    <span className="muted">{rank + 1}.</span>{' '}
                    <span className="px" style={{ color: l.colour }}>
                      {l.name}
                    </span>
                  </span>
                  <span>
                    {coins(l.values[hover] ?? 0)} <span className={g > 0 ? 'gain' : 'muted'}>{g > 0 ? `+${coins(g)}` : '±0'}</span>
                  </span>
                </span>
              );
            })}
            {data.lines.length > 1 && (
              <span className="tip-row muted" style={{ borderTop: '1px solid var(--line)', paddingTop: 4, marginTop: 2 }}>
                <span>Group</span>
                <span>
                  {coins(groupTotal)} {groupGain > 0 ? `+${coins(groupGain)}` : '±0'}
                </span>
              </span>
            )}
            <span className="muted tiny">+ is the gain in that {stepWord}</span>
          </div>
        )}
      </div>
      <div className="axis">
        {days.map((d) => (
          <span key={d}>{dayLabel(d)}</span>
        ))}
      </div>
    </Card>
  );
}

function ProjectionCard({ p }: { p: Projection }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, p.projected, ...p.soFar);
  const w = 400 * p.dayGone;
  const pts = p.soFar.map((v, i) => `${(i / Math.max(1, p.soFar.length - 1)) * w},${115 - (Math.max(0, v) / max) * 110}`);
  const last = p.soFar[p.soFar.length - 1] ?? 0;
  const lastY = 115 - (Math.max(0, last) / max) * 110;
  const endY = 115 - (Math.max(0, p.projected, last) / max) * 110;
  return (
    <Card className="col-half" title="Today's projection">
      <span className="px big-total" style={{ fontSize: 48 }}>
        {coins(p.projected)}
      </span>
      <span className="soft small">At today's pace so far, the group ends the day (00:00 UTC) on about this. It is a straight line from the profit so far; it doesn't know when people log off.</span>
      <div className="chart">
        <svg
          viewBox="0 0 400 120"
          width="100%"
          height="120"
          preserveAspectRatio="none"
          aria-hidden="true"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <polyline points={pts.join(' ')} stroke="var(--orange)" strokeWidth="3" fill="none" vectorEffect="non-scaling-stroke" />
          <path d={`M${w} ${lastY} L400 ${endY}`} stroke="var(--orange)" strokeWidth="2" strokeDasharray="6 6" fill="none" vectorEffect="non-scaling-stroke" />
          {hover != null && <path d={`M${hover * 400} 0V120`} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" fill="none" vectorEffect="non-scaling-stroke" />}
        </svg>
        {hover != null &&
          (() => {
            const dayStart = p.now - p.dayGone * 86_400_000;
            const at = dayStart + hover * 86_400_000;
            const past = hover <= p.dayGone;
            const i = Math.round((hover / Math.max(0.0001, p.dayGone)) * (p.soFar.length - 1));
            const v = past ? (p.soFar[Math.min(p.soFar.length - 1, i)] ?? 0) : last + (Math.max(p.projected, last) - last) * ((hover - p.dayGone) / Math.max(0.0001, 1 - p.dayGone));
            return (
              <div className="tip" style={{ top: -8, transform: 'translateY(-100%)', left: `clamp(0px, calc(${hover * 100}% - 90px), calc(100% - 190px))` }}>
                <span className="px">{hover >= 0.999 ? 'End of day' : shortClock(at)}</span>
                <span>
                  <b>{coins(v)}</b> {past ? 'so far' : 'projected'}
                </span>
                {past ? (
                  hover * 24 >= 0.5 && <span className="muted">{coins(v / (hover * 24))} an hour on average</span>
                ) : (
                  <span className="muted">{coins(Math.max(0, v - last))} more than now</span>
                )}
              </div>
            );
          })()}
      </div>
    </Card>
  );
}

function SourcesCard({ sources, ready }: { sources: Source[]; ready: boolean }) {
  const total = sources.reduce((n, s) => n + s.value, 0);
  return (
    <Card className="col-half" title="Where the profit comes from" side="last 7 days, before summon costs">
      {!ready ? (
        <Loading />
      ) : total <= 0 ? (
        <p className="empty small">Nothing farmed in the last 7 days.</p>
      ) : (
        <>
          <div className="split" role="img" aria-label={sources.map((s) => `${s.name} ${Math.round((s.value / total) * 100)}%`).join(', ')}>
            {sources.map((s) => (
              <span key={s.name} style={{ width: `${(s.value / total) * 100}%`, background: s.colour }} />
            ))}
          </div>
          {sources.map((s) => (
            <div className="liverow" key={s.name}>
              <span className="dot" style={{ background: s.colour }} />
              <ItemPic item={s.item} />
              <span className="grow">{s.name}</span>
              <span className="muted small">{Math.round((s.value / total) * 100)}%</span>
              <span className="px">{coins(s.value)}</span>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

function RatesCard({ rows, error, example }: { rows: Rate[] | null; error?: string | null; example?: boolean }) {
  return (
    <Card title="Your drops against the wiki" side={example ? undefined : 'all time, your accounts'}>
      {!rows ? (
        <Loading error={error} />
      ) : rows.length === 0 ? (
        <p className="empty small">Not enough kills yet to compare.</p>
      ) : (
        <div className="tiles">
          {rows.map((r) => {
            const diff = r.wiki > 0 ? r.you / r.wiki - 1 : 0;
            return (
              <div className="stack" style={{ gap: 4 }} key={r.name}>
                <span className="muted small item-line">
                  <ItemPic item={r.item} />
                  {r.name}
                </span>
                <span>
                  <span className="px res-value">{r.you >= 10 ? Math.round(r.you).toLocaleString('en-GB') : r.you.toFixed(1)}</span>{' '}
                  <span className="muted small">vs {r.wiki >= 10 ? Math.round(r.wiki).toLocaleString('en-GB') : r.wiki.toFixed(1)} on the wiki</span>
                </span>
                <span className={`small ${Math.abs(diff) < 0.02 ? 'muted' : diff > 0 ? 'gain' : 'loss'}`}>
                  {Math.abs(diff) < 0.02 ? 'right on average' : `${diff > 0 ? '+' : '−'}${Math.round(Math.abs(diff) * 100)}%`}
                  {example ? '' : ` · ${r.kills.toLocaleString('en-GB')} kills`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** A small item picture, when there is one (src/item-icons.ts). */
function ItemPic({ item }: { item?: string }) {
  const src = item ? itemIcon(item) : null;
  return src ? <img className="item-pic" src={src} alt="" width={20} height={20} /> : null;
}

// ---- example data for the free plan's locked preview ----

function Example() {
  const now = Date.now();
  const names = ['Member 1', 'Member 2', 'Member 3', 'Member 4', 'Member 5'];
  const lines: Lines = {
    from: now - 7 * 86_400_000,
    bucketMs: 3_600_000,
    lines: names.map((name, li) => {
      let v = 0;
      return { name, colour: colourAt(li), values: Array.from({ length: 168 }, (_, i) => (v += (i % 24) < 8 ? 0 : (Math.sin(i * (0.7 + li * 0.6)) + 1.4) * (2_400_000 - li * 350_000))) };
    }),
  };
  let r = 0;
  const p: Projection = { soFar: Array.from({ length: 20 }, (_, i) => (r += i < 7 ? 0 : 2_800_000 + (i % 3) * 600_000)), dayGone: 0.8, now, projected: 52_000_000 };
  const sources: Source[] = [
    { name: 'Soul String', item: 'SOUL_STRING', value: 128_000_000, colour: '#9fc2ff' },
    { name: 'Scavenger coins', item: 'COINS', value: 118_000_000, colour: 'var(--orange)' },
    { name: 'Spider Essence', item: 'ESSENCE_SPIDER', value: 37_000_000, colour: '#d7bcff' },
    { name: 'Everything else', value: 28_000_000, colour: '#55555c' },
  ];
  const rates: Rate[] = [
    { name: 'Soul String a crystal kill', item: 'SOUL_STRING', you: 6.1, wiki: 6, kills: 0 },
    { name: 'Spider Essence a crystal kill', item: 'ESSENCE_SPIDER', you: 304, wiki: 300, kills: 0 },
    { name: 'Soul String a callings kill', item: 'SOUL_STRING', you: 1.9, wiki: 2, kills: 0 },
  ];
  return (
    <>
      <ProLock what="Every member as a line over 7 days, with exact numbers on hover.">
        <MemberLines data={lines} title="Group profit, last 7 days" />
      </ProLock>
      <div className="cols">
        <div className="col-half">
          <ProLock what="Where today ends up at the current pace.">
            <ProjectionCard p={p} />
          </ProLock>
        </div>
        <div className="col-half">
          <ProLock what="Soul String, coins and Essence as shares of the week.">
            <SourcesCard sources={sources} ready />
          </ProLock>
        </div>
      </div>
      <ProLock what="Average time to kill, with or without the crystal's spawn-in, by day and as a spread.">
        <TtkView data={exampleTtk()} spawn={false} controls={null} />
      </ProLock>
      <div className="cols">
        <div className="col-half">
          <ProLock what="Every day you farmed over the last half year.">
            <CalendarView days={exampleCalendar()} />
          </ProLock>
        </div>
        <div className="col-half">
          <ProLock what="Which hours of the week make you the most.">
            <HeatmapView cells={exampleHeat()} />
          </ProLock>
        </div>
      </div>
      <ProLock what="Soul String, Essence and Fragment prices over 30 days.">
        <PriceView points={examplePrices()} bucketMs={3_600_000} item="SOUL_STRING" setItem={() => undefined} view={priceWindow('1m')} setView={() => undefined} />
      </ProLock>
      <ProLock what="Your Soul String and Essence per kill against the wiki's numbers.">
        <RatesCard rows={rates} example />
      </ProLock>
    </>
  );
}
