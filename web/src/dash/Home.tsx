/* Group home: what the selected group farmed, who's carrying, who's farming now, latest kills, profit by hour. */
import { useState } from 'react';
import { api } from '../api.ts';
import { ago, coins, int, shortClock } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';
import { useIsPro } from '../components/Locked.tsx';
import { platform, type Group } from '../platform-api.ts';
import { ESSENCE, EMPTY, SOUL, WINDOWS, WIN_WORDS, accountState, accountsOf, groupLoot, killsOf, lootOf, meId, openFights, sumSeries, tierWord, timer, type User, type Win } from './data.ts';
import { Avatar, Card, CopyButton, Loading, Seg, colourAt } from './ui.tsx';
import { linkTo, type Go } from './App.tsx';

export function Home({ group, user, go }: { group: Group; user: User; go: Go }) {
  const [win, setWin] = useState<Win>('today');
  const now = useNow(1000);
  const me = meId(user);
  const g = useLive(() => platform.group(group.id), [group.id]);
  const ov = useLive(() => api.overview('group'), [], 30_000);
  const ev = useLive(() => api.events(400), [], 15_000);
  const fights = useLive(() => api.fights(120), [], 30_000);
  const series = useLive(() => api.series('24h'), [], 60_000);
  const loot = useLive(() => groupLoot(win, group.id), [win, group.id]);

  if (!g.data) return <main className="dpage"><Loading error={g.error} /></main>;
  const members = g.data.members;
  const visible = new Set(members.filter((m) => !m.hidden).map((m) => m.userId));
  const accounts = accountsOf(ov.data?.accounts, visible);
  const uuids = new Set(accounts.map((a) => a.uuid));
  const events = (ev.data?.events ?? []).filter((e) => uuids.has(e.account));
  const live = openFights(events, now);
  const liveBy = new Map(live.map((f) => [f.account, f]));
  const t = g.data.totals[win] ?? EMPTY;
  const farming = accounts.map((a) => ({ a, s: accountState(a, liveBy.get(a.uuid)) })).filter((x) => x.s.on);
  const farmingUsers = new Set(farming.map((x) => x.a.userId));

  const soul = lootOf(loot.data?.loot, SOUL);
  const ess = lootOf(loot.data?.loot, ESSENCE);
  const gross = t.coins + t.lootValue;
  const ranked = members
    .filter((m) => !m.hidden)
    .map((m) => ({ m, t: m[win] ?? EMPTY }))
    .sort((a, b) => b.t.profit - a.t.profit);
  const top = Math.max(1, ...ranked.map((r) => r.t.profit));
  const kills = killsOf(fights.data?.fights ?? [], ev.data?.events ?? [], uuids).slice(0, 6);
  const full = group.members >= group.max;

  return (
    <main className="dpage">
      <section className="dhead">
        <div className="dhead-words">
          <span className="px muted">
            {group.name} · {WIN_WORDS[win]} · {group.members} of {group.max} members
          </span>
          <span className="px big-total">{coins(t.profit)}</span>
          <span className="soft">
            {t.wallUptimeMs > 0 ? `${coins(t.profitPerWallHour)} an hour · ` : ''}
            {int(t.kills)} kills
            {win === 'today' ? ` · ${farmingUsers.size} farming now` : ''}
          </span>
        </div>
        <Seg label="Time range" value={win} options={WINDOWS} onChange={setWin} />
      </section>

      <section className="tiles" aria-label="What the group farmed">
        <Res ico="coin" cls="ico-coins" label="Scavenger coins" value={coins(t.coins)} sub={gross > 0 ? `${Math.round((t.coins / gross) * 100)}% of everything farmed` : 'none yet'} />
        <Res ico="string" cls="ico-string" label="Soul String" value={loot.data ? int(soul.count) : '…'} sub={soul.value > 0 ? `worth ${coins(soul.value)}` : 'none yet'} />
        <Res ico="essence" cls="ico-essence" label="Spider Essence" value={loot.data ? int(ess.count) : '…'} sub={ess.value > 0 ? `worth ${coins(ess.value)}` : 'none yet'} />
        <Res ico="kill" cls="ico-kills" label="Kills" value={int(t.kills)} sub={`${int(t.crystals)} crystals · ${int(t.callings)} callings`} />
      </section>

      <div className="cols">
        <div className="col-main stack" style={{ gap: 20 }}>
          <Card title={<span className="dh2">Who's carrying</span>} side="share of group profit">
            <div>
              {ranked.map(({ m, t: mt }, i) => {
                const mine = m.userId === me;
                const body = (
                  <>
                    <span className="px muted">{i + 1}</span>
                    <Avatar name={m.name} colour={colourAt(i)} />
                    <span className="mrow-words">
                      <span className="mrow-name">
                        <span className="px">{m.name}</span>
                        {m.role !== 'member' && <span className="muted tiny">{m.role}</span>}
                        {farmingUsers.has(m.userId) && <span className="live-tag">farming</span>}
                      </span>
                      <span className="bar">
                        <span style={{ width: `${Math.max(0, Math.round((mt.profit / top) * 100))}%`, background: colourAt(i) }} />
                      </span>
                    </span>
                    <span className="px right">{coins(mt.profit)}</span>
                    <span className="muted tiny right mrow-rate">{mt.wallUptimeMs > 0 ? `${coins(mt.profitPerWallHour)} / h` : '-'}</span>
                  </>
                );
                return mine ? (
                  <a key={m.userId} href="/me" className="mrow" onClick={linkTo(go, '/me')}>
                    {body}
                  </a>
                ) : (
                  <div key={m.userId} className="mrow">
                    {body}
                  </div>
                );
              })}
              {members.some((m) => m.hidden) && (
                <p className="muted tiny" style={{ padding: '8px' }}>
                  {members.filter((m) => m.hidden).length} member{members.filter((m) => m.hidden).length === 1 ? ' keeps their' : 's keep their'} numbers private, so they're left out of the totals.
                </p>
              )}
            </div>
          </Card>

          <HourChart series={series.data} uuids={uuids} go={go} />
        </div>

        <aside className="col-side">
          <Card title="Farming now">
            {farming.length === 0 ? (
              <p className="empty small">Nobody in the group is online right now.</p>
            ) : (
              farming.map(({ a, s }) => {
                const f = liveBy.get(a.uuid);
                return (
                  <div className="liverow" key={a.uuid}>
                    <span className="dot dot-on" />
                    <span className="px grow">{a.name}</span>
                    <span className="muted small">{s.words}</span>
                    {f && <span className="px hot">{timer(now - f.startedAt)}</span>}
                  </div>
                );
              })
            )}
          </Card>

          <Card title="Latest kills">
            {kills.length === 0 ? (
              <p className="empty small">No kills yet. They show up here a few seconds after each fight.</p>
            ) : (
              kills.map((k) => (
                <div className="kill" key={k.key}>
                  <span className="kill-top">
                    <span>
                      <span className="px">{k.accountName}</span> <span className="muted small">{tierWord(k.tier)}</span>
                    </span>
                    <span className="px gain">+{coins(k.value)}</span>
                  </span>
                  <span className="muted tiny">
                    {int(k.soul)} Soul String · {int(k.essence)} Essence · {coins(k.coins)} coins · {ago(k.ts, now)}
                  </span>
                </div>
              ))
            )}
          </Card>

          <Card title="Invite">
            {group.code ? (
              <>
                <div className="row-gap">
                  <span className="px code-box grow">{group.code}</span>
                  <CopyButton text={`${window.location.origin}/join/${group.code}`} label="Copy link" main />
                </div>
                <span className="muted tiny">
                  {full ? `Group is full (${group.members} of ${group.max}). Remove someone in group settings to invite.` : `Anyone with the link can join. ${group.max - group.members} place${group.max - group.members === 1 ? '' : 's'} left.`}
                </span>
              </>
            ) : (
              <span className="muted small">Ask the owner or a mod of {group.name} for the invite link.</span>
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}

/** One total with its item picture (public/icons/<ico>.svg). */
function Res({ ico, cls, label, value, sub }: { ico: 'coin' | 'string' | 'essence' | 'kill'; cls: string; label: string; value: string; sub: string }) {
  return (
    <div className="panel res">
      <span className={`ico ${cls}`} aria-hidden="true">
        <img src={`/icons/${ico}.svg`} alt="" width={32} height={32} />
      </span>
      <span className="res-words">
        <span className="muted small">{label}</span>
        <span className="px res-value">{value}</span>
        <span className="muted tiny">{sub}</span>
      </span>
    </div>
  );
}

function HourChart({ series, uuids, go }: { series: Awaited<ReturnType<typeof api.series>> | undefined; uuids: Set<string>; go: Go }) {
  const pro = useIsPro();
  const vals = sumSeries(series, uuids);
  const max = Math.max(1, ...vals);
  return (
    <Card
      title={<span className="dh2">Profit, last 24 hours</span>}
      side={
        !pro && (
          <a href="/graphs" className="px small" onClick={linkTo(go, '/graphs')}>
            Per member and projections: Pro
          </a>
        )
      }
    >
      {!series ? (
        <Loading />
      ) : (
        <>
          <div className="hours" role="img" aria-label={`Group profit per ${Math.round(series.bucketMs / 60_000)} minutes over the last 24 hours`}>
            {vals.map((v, i) => (
              <span
                key={i}
                className={i === vals.length - 1 ? 'now' : undefined}
                style={{ height: `${Math.max(1, (Math.max(0, v) / max) * 100)}%` }}
                title={`${shortClock(series.from + i * series.bucketMs)}: ${coins(v)}`}
              />
            ))}
          </div>
          <div className="axis">
            <span>{shortClock(series.from)}</span>
            <span>{shortClock(series.from + (series.to - series.from) / 2)}</span>
            <span>now</span>
          </div>
        </>
      )}
    </Card>
  );
}
