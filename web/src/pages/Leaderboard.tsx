import { useState } from 'react';
import { api, type LeaderRow } from '../api.ts';
import { Empty, Loading, Switch, WINDOW_OPTIONS, type WindowKey } from '../components/Bits.tsx';
import { coins, duration, int } from '../format.ts';
import { useLive } from '../hooks.ts';
import { podiumSlots } from '../podium.ts';

/** Each stat knows how to read its number from a row, so ranking and display share one definition. */
const STATS = [
  { key: 'profit', label: 'Profit', value: (r: LeaderRow) => r.totals.profit, show: (r: LeaderRow) => coins(r.totals.profit) },
  { key: 'kills', label: 'Kills', value: (r: LeaderRow) => r.totals.kills, show: (r: LeaderRow) => int(r.totals.kills) },
  { key: 'crystals', label: 'Crystals', value: (r: LeaderRow) => r.totals.crystals, show: (r: LeaderRow) => int(r.totals.crystals) },
  {
    key: 'luck',
    label: 'Luckiest',
    value: (r: LeaderRow) => r.luck ?? -1,
    show: (r: LeaderRow) => (r.luck == null ? '-' : `${Math.round(r.luck * 100)}%`),
  },
  { key: 'rng', label: 'Rare drops', value: (r: LeaderRow) => r.rngDrops, show: (r: LeaderRow) => int(r.rngDrops) },
  { key: 'uptime', label: 'Time farming', value: (r: LeaderRow) => r.totals.uptimeMs, show: (r: LeaderRow) => duration(r.totals.uptimeMs) },
  {
    key: 'rate',
    label: 'Per hour',
    value: (r: LeaderRow) => r.totals.profitPerClientHour,
    show: (r: LeaderRow) => (r.totals.uptimeMs > 0 ? coins(r.totals.profitPerClientHour) : '-'),
  },
] as const;
type StatKey = (typeof STATS)[number]['key'];

export function Leaderboard() {
  const [window, setWindow] = useState<WindowKey>('week');
  const [stat, setStat] = useState<StatKey>('profit');
  const board = useLive(() => api.leaderboard(window), [window]);
  const s = STATS.find((x) => x.key === stat)!;
  const rows = [...(board.data?.rows ?? [])].sort((a, b) => s.value(b) - s.value(a));
  const podium = podiumSlots(rows);

  return (
    <main>
      <div className="head">
        <h1>Leaderboard</h1>
        <Switch label="Time" value={window} onChange={setWindow} options={WINDOW_OPTIONS} />
      </div>
      <Switch label="Rank by" value={stat} onChange={setStat} options={STATS.map((x) => [x.key, x.label] as const)} />

      {!board.data ? (
        <Loading error={board.error} />
      ) : rows.length === 0 ? (
        <Empty>Nobody has played yet.</Empty>
      ) : (
        <>
          <div className="podium">
            {podium.map(({ key, row, place }) =>
              row ? (
                <div key={key} className={`panel ${place === 1 ? 'first' : ''}`}>
                  <div className="place">{place === 1 ? '1st' : place === 2 ? '2nd' : '3rd'}</div>
                  <div className="podium-name">{row.name}</div>
                  <div className="score">{s.show(row)}</div>
                </div>
              ) : (
                <div key={key} />
              ),
            )}
          </div>

          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    {STATS.map((x) => (
                      <th key={x.key} className={x.key === stat ? 'num' : 'num opt'}>
                        <button type="button" className="plain" onClick={() => setStat(x.key)} style={{ color: x.key === stat ? 'var(--orange)' : undefined }}>
                          {x.label}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.userId}>
                      <td className="muted">{i + 1}</td>
                      <td className="name-cell">
                        {r.name}
                        <span className="sub">
                          {r.accounts} account{r.accounts === 1 ? '' : 's'}
                        </span>
                      </td>
                      {STATS.map((x) => (
                        <td key={x.key} className={x.key === stat ? 'num gain' : 'num opt'}>
                          {x.show(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
