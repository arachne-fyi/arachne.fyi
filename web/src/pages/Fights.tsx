import { exportUrl, api, type Fight } from '../api.ts';
import { Empty, Loading } from '../components/Bits.tsx';
import { dayLabel, int, shortClock } from '../format.ts';
import { useLive } from '../hooks.ts';

const OUTCOME: Record<Fight['outcome'], [string, string]> = {
  COUNTED: ['Kill', 'tag gold'],
  LOW_DAMAGE: ['Too little damage', 'tag'],
  ZERO_DAMAGE: ['No damage', 'tag red'],
  MISSING_DAMAGE: ['No damage line', 'tag red'],
  INTERRUPTED: ['Left mid-fight', 'tag'],
  OPEN: ['In progress', 'tag green'],
};

export function Fights() {
  const fights = useLive(() => api.fights(100), []);
  return (
    <main>
      <div className="head">
        <h1>Fights</h1>
        <a className="button" href={exportUrl.fights('group')} download data-tip="Every fight ever recorded, for Excel or Google Sheets.">
          Download CSV
        </a>
      </div>
      <p className="muted">Last 100 bosses. A kill needs 10,000 damage or more.</p>
      {!fights.data ? (
        <Loading error={fights.error} />
      ) : fights.data.fights.length === 0 ? (
        <Empty>No fights recorded yet.</Empty>
      ) : (
        <div className="panel table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Account</th>
                  <th className="opt">Summon</th>
                  <th>Result</th>
                  <th className="num opt">Damage</th>
                  <th className="num">Time</th>
                </tr>
              </thead>
              <tbody>
                {fights.data.fights.map((f) => {
                  const [label, cls] = OUTCOME[f.outcome];
                  return (
                    <tr key={`${f.account}-${f.fight}`}>
                      <td className="muted">
                        <span className="opt">{dayLabel(f.ts)}, </span>
                        {shortClock(f.ts)}
                      </td>
                      <td>{f.accountName}</td>
                      <td className="opt">{f.tier === 'CRYSTAL' ? 'Crystal' : f.tier === 'CALLING' ? 'Calling' : <span className="faint">Unknown</span>}</td>
                      <td>
                        <span className={cls}>{label}</span>
                      </td>
                      <td className="num opt">{f.damage == null ? '–' : int(f.damage)}</td>
                      <td className="num">{f.durationMs == null ? '–' : `${(f.durationMs / 1000).toFixed(1)}s`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
