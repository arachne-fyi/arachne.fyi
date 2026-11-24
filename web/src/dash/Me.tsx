/* Me: your own numbers, what a kill gets you, your fights, accounts and groups. */
import { useState } from 'react';
import { api, viewingAs } from '../api.ts';
import { ago, coins, duration, int, shortClock } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';
import { platform, type Group } from '../platform-api.ts';
import { ESSENCE, EMPTY, SOUL, WINDOWS, WIN_WORDS, accountState, killsOf, lootOf, meId, openFights, ordinal, tierWord, timer, type User, type Win } from './data.ts';
import { Avatar, Card, Head, Loading, Seg, Tile } from './ui.tsx';
import { linkTo, type Go } from './App.tsx';

export function MePage({ user, groups, go }: { user: User; groups: Group[]; go: Go }) {
  const [win, setWin] = useState<Win>('today');
  const now = useNow(1000);
  const me = meId(user);
  const ov = useLive(() => api.overview('user'), [], 20_000);
  const loot = useLive(() => api.loot(win, 'me'), [win]);
  const fights = useLive(() => api.fights(150), [], 30_000);
  const ev = useLive(() => api.events(400), [], 15_000);
  const prefs = useLive(platform.prefs, [], 0);
  const ranks = useLive(() => Promise.all(groups.map((g) => platform.group(g.id))), [groups.map((g) => g.id).join(','), win], 60_000);

  if (!ov.data) return <main className="dpage"><Loading error={ov.error} /></main>;
  const accounts = ov.data.accounts.filter((a) => a.userId === me);
  const uuids = new Set(accounts.map((a) => a.uuid));
  const events = (ev.data?.events ?? []).filter((e) => uuids.has(e.account));
  const live = new Map(openFights(events, now).map((f) => [f.account, f]));
  const t = ov.data.totals.user[win] ?? EMPTY;
  const soul = lootOf(loot.data?.loot, SOUL);
  const ess = lootOf(loot.data?.loot, ESSENCE);
  const kills = killsOf(fights.data?.fights ?? [], ev.data?.events ?? [], uuids).slice(0, 12);
  const newest = accounts.reduce((a, b) => (b.lastSeen > (a?.lastSeen ?? 0) ? b : a), accounts[0]);
  const as = groups.length ? ranks.data : [];
  const rankIn = (i: number) => {
    const d = as?.[i];
    if (!d) return null;
    const list = d.members.filter((m) => !m.hidden).sort((a, b) => (b[win]?.profit ?? 0) - (a[win]?.profit ?? 0));
    const at = list.findIndex((m) => m.userId === me);
    return at < 0 ? null : { at: at + 1, of: list.length };
  };
  const first = rankIn(0);
  const per = (n: number) => (t.kills > 0 ? n / t.kills : 0);

  return (
    <main className="dpage">
      <section className="panel prof">
        <Avatar name={user.name} src={me === user.id ? user.avatar : null} size={96} />
        <div className="prof-words">
          <span className="px prof-name">{viewingAs()?.name ?? user.name}</span>
          <span className="px gold">
            {prefs.data?.shownTitle ?? ''}
            {first && groups[0] ? `${prefs.data?.shownTitle ? ' · ' : ''}${ordinal(first.at)} of ${first.of} in ${groups[0].name} (${WIN_WORDS[win]})` : ''}
          </span>
          <span className="muted small liverow">
            <span className={`dot ${newest && now - newest.lastSeen < 120_000 ? 'dot-on' : 'dot-off'}`} />
            {newest ? `Mod paired${newest.modVersion ? ` · v${newest.modVersion}` : ''} · last data ${ago(newest.lastSeen, now)}` : 'Mod not paired yet'}
          </span>
        </div>
      </section>

      <div className="dhead">
        <h1 className="px dh2">You · {WIN_WORDS[win]}</h1>
        <Seg label="Time range" value={win} options={WINDOWS} onChange={setWin} />
      </div>

      <section className="tiles">
        <Tile label="Profit" value={coins(t.profit)} tone="hot" sub="after summon costs" />
        <Tile label="Per hour" value={t.wallUptimeMs > 0 ? coins(t.profitPerWallHour) : '-'} sub="per hour of farming" />
        <Tile label="Kills" value={int(t.kills)} sub={`${int(t.crystals)} crystals · ${int(t.callings)} callings`} />
        <Tile label="Time farming" value={duration(t.wallUptimeMs)} sub="with at least one account on" />
      </section>

      <Card title="What a kill gets you">
        <div className="tiles">
          <PerKill label="Soul String a kill" value={t.kills ? per(soul.count).toFixed(1) : '-'} sub={`${int(soul.count)} over ${int(t.kills)} kills`} />
          <PerKill label="Spider Essence a kill" value={t.kills ? int(per(ess.count)) : '-'} sub={`${int(ess.count)} over ${int(t.kills)} kills`} />
          <PerKill label="Scavenger coins a kill" value={t.kills ? coins(per(t.coins)) : '-'} sub={`${coins(t.coins)} over ${int(t.kills)} kills`} />
        </div>
      </Card>

      <div className="cols">
        <Card className="col-main" title={<span className="dh2">Fights</span>} side="newest first">
          {kills.length === 0 ? (
            <p className="empty">No fights yet. Pair the mod and they show up here a few seconds after each kill.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Summon</th>
                    <th className="hide-phone">Took</th>
                    <th>Loot</th>
                    <th className="r">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {kills.map((k) => (
                    <tr key={k.key}>
                      <td className="px">{shortClock(k.ts)}</td>
                      <td>{tierWord(k.tier)}</td>
                      <td className="muted hide-phone">{k.durationMs ? timer(k.durationMs) : '-'}</td>
                      <td className="soft">
                        {int(k.soul)} Soul String · {int(k.essence)} Essence · {coins(k.coins)} coins
                      </td>
                      <td className="px gain r">+{coins(k.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <aside className="col-side">
          <Card title="Minecraft accounts">
            {accounts.length === 0 && <p className="empty small">None yet.</p>}
            {accounts.map((a) => {
              const s = accountState(a, live.get(a.uuid));
              return (
                <div className="liverow" key={a.uuid}>
                  <Head uuid={a.uuid} />
                  <span className="stack grow" style={{ gap: 0 }}>
                    <span className="px">{a.name}</span>
                    <span className="muted tiny">{s.on ? s.words : `last seen ${ago(a.lastSeen, now)}`}</span>
                  </span>
                  <span className="px">{coins(a.totals[win].profit)}</span>
                </div>
              );
            })}
            <div>
              <a href="/settings#mod" className="btn btn-ghost" onClick={linkTo(go, '/settings#mod')}>
                {accounts.length ? 'Pair another account' : 'Pair the mod'}
              </a>
            </div>
          </Card>

          <Card title="Your groups">
            {groups.length === 0 && <p className="empty small">Not in a group yet.</p>}
            {groups.map((g, i) => {
              const r = rankIn(i);
              return (
                <a key={g.id} href={`/groups/${g.id}`} className="liverow" style={{ color: 'var(--text)', textDecoration: 'none' }} onClick={linkTo(go, `/groups/${g.id}`)}>
                  <span className="gtag">{g.tag}</span>
                  <span className="px grow">{g.name}</span>
                  <span className="muted small">{r ? `${ordinal(r.at)} of ${r.of}` : `${g.members} members`}</span>
                </a>
              );
            })}
          </Card>
        </aside>
      </div>
    </main>
  );
}

function PerKill({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="muted small">{label}</span>
      <span className="px res-value">{value}</span>
      <span className="muted tiny">{sub}</span>
    </div>
  );
}
