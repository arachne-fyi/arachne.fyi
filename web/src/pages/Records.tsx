import { useState } from 'react';
import { api, type Progress } from '../api.ts';
import { Loading, Panel, Switch } from '../components/Bits.tsx';
import { DryStreaks } from '../components/Extras.tsx';
import { rarityColour } from '@arachne/shared';
import { coins, dateTime, dayLabel, duration, int, rankTitle } from '../format.ts';
import { useLive } from '../hooks.ts';
import { platform } from '../platform-api.ts';

/** Personal bests: the best hour, day and fight, the fastest kill, the longest session. */
export function Records() {
  const [scope, setScope] = useState<'group' | 'me'>('me');
  const r = useLive(() => api.records(scope), [scope], 60_000);
  const p = useLive(() => api.progress(scope), [scope], 60_000);
  const prefs = useLive(platform.prefs, [], 60_000);

  return (
    <main>
      <div className="head">
        <h1>Progress</h1>
        <Switch
          label="Whose records"
          value={scope}
          onChange={setScope}
          options={[
            ['me', 'Just me'],
            ['group', 'Everyone'],
          ]}
        />
      </div>
      {!r.data ? (
        <Loading error={r.error} />
      ) : (
        <>
          <section className="panel strip">
            <div>
              <div className={`profit ${r.data.lifetime.profit < 0 ? 'loss' : 'gain'}`}>{coins(r.data.lifetime.profit)}</div>
              <div className="muted" style={{ marginTop: 8 }}>
                all-time profit from {int(r.data.lifetime.kills)} kills over {int(r.data.lifetime.daysFarmed)} days
              </div>
            </div>
            <div className="stats">
              <div className="stat">
                <div className="v wrap">{scope === 'me' && prefs.data ? prefs.data.shownTitle : rankTitle(r.data.lifetime.kills).title}</div>
                <div className="l">
                  title{scope === 'me' && <> (<a href="/settings#title">change</a>)</>}
                </div>
              </div>
              <div className="stat">
                <div className="v">{int(r.data.lifetime.crystals)}</div>
                <div className="l">crystals placed</div>
              </div>
              <div className="stat">
                <div className="v">{duration(r.data.lifetime.uptimeMs)}</div>
                <div className="l">farming</div>
              </div>
            </div>
          </section>

          {p.data && <ProgressParts p={p.data} />}

          <h2 className="section">Records</h2>
          <div className="records">
            <Record label="Best hour" value={r.data.bestHour && coins(r.data.bestHour.value)} when={r.data.bestHour && dateTime(r.data.bestHour.at)} />
            <Record label="Best day" value={r.data.bestDay && coins(r.data.bestDay.value)} when={r.data.bestDay && dayLabel(r.data.bestDay.at)} />
            <Record
              label="Best single fight"
              value={r.data.bestFight && coins(r.data.bestFight.value)}
              when={r.data.bestFight && `${r.data.bestFight.account}, ${dateTime(r.data.bestFight.at)}`}
            />
            <Record label="Most kills in a day" value={r.data.mostKillsDay && int(r.data.mostKillsDay.value)} when={r.data.mostKillsDay && dayLabel(r.data.mostKillsDay.at)} />
            <Record
              label="Fastest kill"
              value={r.data.fastestKill && duration(r.data.fastestKill.ms)}
              when={r.data.fastestKill?.at != null ? dateTime(r.data.fastestKill.at) : null}
            />
            <Record
              label="Longest session"
              value={r.data.longestSession && duration(r.data.longestSession.ms)}
              when={r.data.longestSession && dateTime(r.data.longestSession.at)}
            />
          </div>

          <Panel title="Dry streaks" side={<span className="muted">now, and the longest ever</span>}>
            <DryStreaks dry={r.data.dry} />
            <ul className="dry longest">
              {r.data.dry.map((d) => (
                <li key={d.item}>
                  <span className="muted">Longest without {d.name}</span>
                  <b>{int(d.longest)}</b>
                  <span className="muted">kills</span>
                </li>
              ))}
            </ul>
          </Panel>
          {p.data && (
            <Panel title="Collection book" side={<span className="muted">{p.data.collection.filter((c) => c.count > 0).length} of {p.data.collection.length} found</span>}>
              <ul className="collection">
                {p.data.collection.map((c) => (
                  <li key={c.item} className={c.count > 0 ? 'found' : 'missing'} data-tip={c.first ? `First one ${dateTime(c.first)}` : 'Not found yet'}>
                    <span style={{ color: c.count > 0 ? rarityColour(c.item) : undefined }}>{c.count > 0 ? c.name : '???'}</span>
                    <b>{c.count > 0 ? int(c.count) : ''}</b>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </main>
  );
}

function ProgressParts({ p }: { p: Progress }) {
  const earned = p.badges.filter((b) => b.earned).length;
  return (
    <>
      <div className="grid-2">
        <Panel title="Streak">
          <div className="streak">
            <b>{int(p.streak.current)}</b>
            <span>{p.streak.current === 1 ? 'day' : 'days'} in a row</span>
          </div>
          <p className="muted">
            Best: {int(p.streak.best)} days.{' '}
            {p.streak.current > 0 && !p.streak.farmedToday ? 'Kill one Arachne today (UTC) to keep it going.' : ''}
          </p>
        </Panel>
        <Panel title="This week's quests" side={<span className="muted">new ones every Monday</span>}>
          <ul className="quests">
            {p.quests.quests.map((q) => (
              <li key={q.id} className={q.done ? 'done' : undefined}>
                <span>
                  {q.done ? '✔ ' : ''}
                  {q.text}
                </span>
                <span className="muted">
                  {q.goal >= 1000 ? `${coins(q.progress)} / ${coins(q.goal)}` : `${int(Math.floor(q.progress))} / ${int(q.goal)}`}
                </span>
                <div className="goal-track">
                  <div className={`goal-fill ${q.done ? 'done' : ''}`} style={{ width: `${(q.progress / q.goal) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Badges" side={<span className="muted">{earned} of {p.badges.length}</span>}>
        <ul className="badges">
          {p.badges.map((b) => (
            <li key={b.id} className={b.earned ? 'earned' : undefined} data-tip={b.how}>
              <span className="badge-icon" aria-hidden="true">
                {b.earned ? '★' : '?'}
              </span>
              <span>{b.name}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function Record({ label, value, when }: { label: string; value: string | null; when: string | null }) {
  return (
    <div className="panel record">
      <div className="l">{label}</div>
      <div className="v">{value ?? '-'}</div>
      <div className="muted">{when ?? 'Not yet'}</div>
    </div>
  );
}
