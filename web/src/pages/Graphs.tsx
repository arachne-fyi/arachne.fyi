import { useState } from 'react';
import { api, type Series } from '../api.ts';
import { Loading, Panel, Switch } from '../components/Bits.tsx';
import {
  AccountsRace,
  bucketName,
  CrystalsChart,
  FightResults,
  FightTimes,
  hasData,
  KillsChart,
  LootDonut,
  MoneyInOut,
  ProfitPerBucket,
  ProfitTotal,
  Timeline,
  trimLeading,
} from '../components/Charts.tsx';
import { DamageChart, FarmCalendar, WeekHeatmap } from '../components/More.tsx';
import { accountColour } from '../format.ts';
import { useSettings } from '../settings.ts';
import { useSwipe } from '../components/Touch.tsx';
import { useLive, useNow } from '../hooks.ts';
import { CrystalReturn, exampleLoot, exampleSeries, KillsVsProfit, LootTreemap, ProfitWaterfall, UptimeBreakdown } from '../components/Deeper.tsx';
import { fakeCalendar, fakeDamage, fakeHeatmap, ProLock, useIsPro } from '../components/Locked.tsx';

const RANGES = [
  ['session', 'Session'],
  ['24h', 'Day'],
  ['7d', 'Week'],
  ['30d', 'Month'],
] as const;

type View = 'total' | 'per' | 'kills' | 'money' | 'crystals' | 'accounts';

/**
 * One big chart you switch between with tabs, then the smaller extras underneath.
 * "Session" is the default: it zooms to the latest run of farming so short bursts fill
 * the chart.
 */
export function Graphs() {
  const [{ graphRange: saved }, set] = useSettings();
  // ?range=7d&view=kills in the address bar opens that chart: links can be shared.
  const query = new URLSearchParams(window.location.search);
  const fromUrl = RANGES.find(([r]) => r === query.get('range'))?.[0];
  const [range, setRangeState] = useState<Series['range']>(fromUrl ?? saved);
  const [view, setViewState] = useState<View>((query.get('view') as View) || 'total');
  const syncUrl = (r: string, v: string) => window.history.replaceState(null, '', `/graphs?range=${r}&view=${v}`);
  const setRange = (graphRange: Series['range']) => {
    setRangeState(graphRange);
    set({ graphRange });
    syncUrl(graphRange, view);
  };
  const setView = (v: View) => {
    setViewState(v);
    syncUrl(range, v);
  };
  const now = useNow(15_000);
  const series = useLive(() => api.series(range), [range]);
  const raw = series.data;
  // Fixed ranges start at the first activity instead of showing an empty stretch.
  const s = raw && range !== 'session' ? trimLeading(raw) : raw;
  const loot = useLive(() => (s ? api.lootSince(s.from) : Promise.resolve({ loot: [] })), [s?.from]);
  const fights = useLive(() => api.fights(1000), []);
  const fightsInRange = fights.data?.fights.filter((f) => s && f.ts >= s.from && f.ts < s.to) ?? [];

  const days = range === '7d' ? 7 : range === '30d' ? 30 : 1;
  // Pro charts are only fetched for Pro: for everyone else the server would say no anyway.
  const pro = useIsPro();
  const heatmap = useLive(() => (pro ? api.heatmap('group', Math.max(days, 28)) : Promise.resolve(null)), [days, pro], 120_000);
  const calendar = useLive(() => (pro ? api.calendar('group') : Promise.resolve(null)), [pro], 300_000);
  const damage = useLive(() => (pro ? api.damage('group', days) : Promise.resolve(null)), [days, pro], 60_000);

  const withData = s ? s.accounts.filter((a) => a.profit.some((v) => v !== 0) || a.kills.some((v) => v > 0)) : [];
  const per = s ? bucketName(s) : '';
  const tabs: (readonly [View, string])[] = [
    ['total', 'Profit'],
    ['per', `Per ${per}`],
    ['kills', 'Kills'],
    ['money', 'In and out'],
    ['crystals', 'Crystals'],
    ...(withData.length > 1 ? [['accounts', 'Accounts'] as const] : []),
  ];
  const shown = tabs.some(([v]) => v === view) ? view : 'total';
  const at = tabs.findIndex(([v]) => v === shown);
  const swipe = useSwipe(
    () => setView(tabs[(at + 1) % tabs.length]![0]),
    () => setView(tabs[(at - 1 + tabs.length) % tabs.length]![0]),
  );

  return (
    <main>
      <div className="head">
        <h1>Graphs</h1>
        <Switch label="Time range" value={range} onChange={setRange} options={RANGES} />
      </div>

      {!s ? (
        <Loading error={series.error} />
      ) : s.empty ? (
        <Panel>
          <p className="empty">No farming yet. Once someone kills Arachne, this fills in.</p>
        </Panel>
      ) : (
        <>
          <Panel side={<Switch label="Chart" value={shown} onChange={setView} options={tabs} />}>
            <div {...swipe}>
              <BigChart view={shown} series={s} />
            </div>
            {withData.length > 1 && shown !== 'total' && shown !== 'money' && (
              <div className="legend">
                {s.accounts.map((a, i) => (
                  <span key={a.uuid}>
                    <span className="swatch" style={{ background: accountColour(i) }} />
                    {a.name}
                  </span>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Who was farming when">
            <Timeline series={s} now={now} />
          </Panel>

          <div className="grid-2">
            <Panel title="Where the money came from">
              {loot.data ? <LootDonut loot={loot.data.loot} /> : <Loading error={loot.error} />}
            </Panel>
            <Panel title="How fights ended">
              {fights.data ? <FightResults fights={fightsInRange} /> : <Loading error={fights.error} />}
            </Panel>
            <Panel title="How long kills take">
              {fights.data ? <FightTimes fights={fightsInRange} /> : <Loading error={fights.error} />}
            </Panel>
            <Panel title="Damage per fight">
              {!pro ? <ProLock what="Damage per fight" preview={<DamageChart values={fakeDamage()} />} /> : damage.data ? <DamageChart values={damage.data.values} /> : <Loading error={damage.error} />}
            </Panel>
          </div>

          <Panel title="Best hours to farm" side={<span className="muted">profit per hour, UTC, last {Math.max(days, 28)} days</span>}>
            {!pro ? <ProLock what="Best hours to farm" preview={<WeekHeatmap cells={fakeHeatmap()} />} /> : heatmap.data ? <WeekHeatmap cells={heatmap.data.cells} /> : <Loading error={heatmap.error} />}
          </Panel>
          <div className="grid-2">
            <Panel title="Where the profit came from">
              {pro ? <ProfitWaterfall series={s} /> : <ProLock what="Profit breakdown" preview={<ProfitWaterfall series={exampleSeries()} />} />}
            </Panel>
            <Panel title="What a crystal returns">
              {pro ? <CrystalReturn series={s} /> : <ProLock what="Crystal return" preview={<CrystalReturn series={exampleSeries()} />} />}
            </Panel>
            <Panel title="Time up, by account">
              {pro ? <UptimeBreakdown series={s} /> : <ProLock what="Uptime by account" preview={<UptimeBreakdown series={exampleSeries()} />} />}
            </Panel>
            <Panel title={`Kills against profit, per ${per}`}>
              {pro ? <KillsVsProfit series={s} /> : <ProLock what="Kills against profit" preview={<KillsVsProfit series={exampleSeries()} />} />}
            </Panel>
          </div>
          <Panel title="Drops by value">
            {!pro ? <ProLock what="Drops by value" preview={<LootTreemap loot={exampleLoot} />} /> : loot.data ? <LootTreemap loot={loot.data.loot} /> : <Loading error={loot.error} />}
          </Panel>

          <Panel title="Farming days">
            {!pro ? <ProLock what="Farming days" preview={<FarmCalendar days={fakeCalendar()} />} /> : calendar.data ? <FarmCalendar days={calendar.data.days} /> : <Loading error={calendar.error} />}
          </Panel>
        </>
      )}
    </main>
  );
}

function BigChart({ view, series }: { view: View; series: Series }) {
  const none = (what: string) => <div className="empty-chart">No {what} in this range.</div>;
  switch (view) {
    case 'total':
      return hasData(series, 'profit') ? <ProfitTotal series={series} big /> : none('profit');
    case 'per':
      return hasData(series, 'profit') ? <ProfitPerBucket series={series} big /> : none('profit');
    case 'kills':
      return hasData(series, 'kills') ? <KillsChart series={series} big /> : none('kills');
    case 'money':
      return hasData(series, 'loot', 'coins', 'costs') ? <MoneyInOut series={series} big /> : none('money in or out');
    case 'crystals':
      return hasData(series, 'crystals') ? <CrystalsChart series={series} big /> : none('crystals placed');
    case 'accounts':
      return <AccountsRace series={series} big />;
  }
}
