import { useState } from 'react';
import { Loading, Panel, Switch, Tile, Toggle } from '../components/Bits.tsx';
import { usePlan } from '../components/Locked.tsx';
import { coins, int } from '../format.ts';
import { useLive } from '../hooks.ts';
import { platform, type Group, type GroupMember } from '../platform-api.ts';

const ERRORS: Record<string, string> = {
  unknown_group: 'No group has that code.',
  bad_code: 'Codes are six letters or numbers.',
  group_full: 'That group is full (100 people).',
  join_limit: 'You are in as many groups as your plan allows. Leave one, or get Pro.',
  group_limit: 'You run as many groups as your plan allows.',
  bad_group: 'Name 2 to 32 characters; tag 2 to 4 letters or numbers.',
  slow_down: 'Too many tries. Wait a minute.',
  bad_webhook: 'That is not a Discord webhook URL.',
  discord_failed: 'Discord did not accept it. Check the webhook still exists.',
};
const say = (e: Error) => ERRORS[e.message] ?? 'That did not work. Try again.';

/** Your groups, and one group at a time: its numbers, its members and how to invite people. */
export function Groups({ go, open, meId }: { go: (to: string) => void; open: number | null; meId: number }) {
  const list = useLive(platform.groups, []);
  const plan = usePlan();
  if (!list.data) return <main><Loading error={list.error} /></main>;
  const groups = list.data.groups;
  const current = groups.find((g) => g.id === open) ?? null;
  return (
    <main>
      <div className="head">
        <h1>Groups</h1>
        {groups.length > 0 && (
          <Switch
            label="Group"
            value={current ? String(current.id) : ''}
            onChange={(v) => go(v ? `/groups/${v}` : '/groups')}
            options={[['', 'All my groups'] as const, ...groups.map((g) => [String(g.id), `[${g.tag}] ${g.name}`] as const)]}
          />
        )}
      </div>
      {current ? (
        <GroupView key={current.id} meId={meId} group={current} onChange={list.refresh} onGone={() => { list.refresh(); go('/groups'); }} />
      ) : (
        <>
          {groups.length === 0 ? (
            <Panel>
              <p className="empty">You aren't in a group yet. Join one with a code from a friend, or start your own. Groups hold up to 100 people.</p>
            </Panel>
          ) : (
            <div className="group-cards">
              {groups.map((g) => (
                <a key={g.id} className="panel group-card" href={`/groups/${g.id}`} onClick={(e) => { e.preventDefault(); go(`/groups/${g.id}`); }}>
                  <span className="group-tag">{g.tag}</span>
                  <b>{g.name}</b>
                  <span className="muted">
                    {g.members} / {g.max} members, you are {g.role === 'member' ? 'a member' : `the ${g.role === 'mod' ? 'moderator' : 'owner'}`}
                  </span>
                </a>
              ))}
            </div>
          )}
          <div className="grid-2">
            <JoinForm onJoined={(id) => { list.refresh(); go(`/groups/${id}`); }} />
            <CreateForm onMade={(id) => { list.refresh(); go(`/groups/${id}`); }} />
          </div>
          <p className="muted">
            Your plan: join {plan.plan === 'pro' ? 10 : 3} groups and run {plan.plan === 'pro' ? 5 : 1}.
          </p>
        </>
      )}
    </main>
  );
}

function JoinForm({ onJoined, initial = '' }: { onJoined: (id: number) => void; initial?: string }) {
  const [code, setCode] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Panel title="Join with a code">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          platform.joinGroup(code).then((r) => onJoined(r.id)).catch((x: Error) => setErr(say(x)));
        }}
      >
        <input aria-label="Group code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={6} placeholder="ABC123" />
        <button type="submit" className="primary" disabled={code.length !== 6}>
          Join
        </button>
      </form>
      {err && <p className="note bad">{err}</p>}
    </Panel>
  );
}

function CreateForm({ onMade }: { onMade: (id: number) => void }) {
  const [g, setG] = useState({ name: '', tag: '', description: '' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Panel title="Start a group">
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          platform.createGroup(g).then((r) => onMade(r.id)).catch((x: Error) => setErr(say(x)));
        }}
      >
        <label>
          Name
          <input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} maxLength={32} placeholder="Web Spinners" />
        </label>
        <label>
          Tag (2 to 4, shown in game)
          <input value={g.tag} onChange={(e) => setG({ ...g, tag: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} maxLength={4} placeholder="WEB" />
        </label>
        <label>
          About (optional)
          <input value={g.description} onChange={(e) => setG({ ...g, description: e.target.value })} maxLength={160} placeholder="Evening crystal runs" />
        </label>
        <button type="submit" className="primary" disabled={g.name.trim().length < 2 || g.tag.length < 2}>
          Create
        </button>
        {err && <p className="note bad">{err}</p>}
      </form>
    </Panel>
  );
}

type Win = 'today' | 'week' | 'all';

function GroupView({ group, meId, onChange, onGone }: { group: Group; meId: number; onChange: () => void; onGone: () => void }) {
  const d = useLive(() => platform.group(group.id), [group.id], 30_000);
  const [win, setWin] = useState<Win>('today');
  if (!d.data) return <Loading error={d.error} />;
  const g = d.data.group;
  const t = d.data.totals[win];
  const staff = g.role !== 'member';
  const rows = [...d.data.members].sort((a, b) => (b[win]?.profit ?? -Infinity) - (a[win]?.profit ?? -Infinity));
  return (
    <>
      <Panel title={`[${g.tag}] ${g.name}`} side={<Switch label="When" value={win} onChange={setWin} options={[['today', 'Today'], ['week', 'Week'], ['all', 'All time']]} />}>
        {g.description && <p className="muted" style={{ marginBottom: 10 }}>{g.description}</p>}
        <div className="tiles">
          <Tile value={coins(t.profit)} label="group profit" tone={t.profit >= 0 ? 'gain' : 'loss'} />
          <Tile value={int(t.kills)} label="kills" />
          <Tile value={int(t.crystals)} label="crystals" />
          <Tile value={`${g.members} / ${g.max}`} label="members" />
        </div>
      </Panel>

      <Panel title="Members">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Profit</th>
                <th>Kills</th>
                <th>Per hour</th>
                {staff && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <MemberRow key={m.userId} m={m} i={i} win={win} group={g} onChange={d.refresh} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {staff && <Invite group={g} onChange={() => { d.refresh(); onChange(); }} />}
      <Panel title="You in this group">
        <div className="setting">
          <div>
            <b>Show this group's tag in game</b>
            <div className="muted">Other Arachne.fyi players see [{g.tag}] next to your name. One tag shows at a time: the first group you joined with this on.</div>
          </div>
          <Toggle label="Show tag" on={g.showTag} onChange={(on) => void platform.showTag(g.id, on).then(() => { d.refresh(); onChange(); })} />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {g.role === 'owner' ? (
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (window.confirm(`Close ${g.name} for everyone? This can't be undone.`)) void platform.deleteGroup(g.id).then(onGone);
              }}
            >
              Close the group
            </button>
          ) : (
            <button type="button" onClick={() => window.confirm(`Leave ${g.name}?`) && void platform.removeMember(g.id, meId).then(onGone)}>
              Leave the group
            </button>
          )}
        </div>
      </Panel>
    </>
  );
}

function MemberRow({ m, i, win, group, onChange }: { m: GroupMember; i: number; win: Win; group: Group; onChange: () => void }) {
  const t = m[win];
  const canKick = group.role === 'owner' ? m.role !== 'owner' : group.role === 'mod' && m.role === 'member';
  return (
    <tr>
      <td>{i + 1}</td>
      <td>
        {m.name}
        {m.role !== 'member' && <span className="faint"> {m.role === 'owner' ? 'owner' : 'mod'}</span>}
      </td>
      {t ? (
        <>
          <td className={t.profit >= 0 ? 'gain' : 'loss'}>{coins(t.profit)}</td>
          <td>{int(t.kills)}</td>
          <td>{t.wallUptimeMs > 0 ? coins(t.profitPerWallHour) : '-'}</td>
        </>
      ) : (
        <td colSpan={3} className="faint">
          keeps their numbers private
        </td>
      )}
      {group.role !== 'member' && (
        <td className="row">
          {group.role === 'owner' && m.role !== 'owner' && (
            <button type="button" className="small" onClick={() => void platform.setRole(group.id, m.userId, m.role === 'mod' ? 'member' : 'mod').then(onChange)}>
              {m.role === 'mod' ? 'Remove mod' : 'Make mod'}
            </button>
          )}
          {canKick && (
            <button type="button" className="small" onClick={() => window.confirm(`Remove ${m.name} from the group?`) && void platform.removeMember(group.id, m.userId).then(onChange)}>
              Remove
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function Invite({ group, onChange }: { group: Group; onChange: () => void }) {
  const link = `${window.location.origin}/join/${group.code}`;
  const [hook, setHook] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Panel title="Invite people">
      <div className="setting">
        <div>
          <b>Code: <code className="big-code">{group.code}</code></b>
          <div className="muted">
            Or send the link: <code className="wrap-code">{link}</code>
          </div>
        </div>
        <div className="row">
          <button type="button" onClick={() => void navigator.clipboard.writeText(link).then(() => setMsg({ ok: true, text: 'Link copied.' }))}>
            Copy link
          </button>
          <button type="button" onClick={() => window.confirm('Make a new code? The old code and link stop working.') && void platform.editGroup(group.id, { newCode: true }).then(onChange)}>
            New code
          </button>
        </div>
      </div>
      <form
        className="setting"
        onSubmit={(e) => {
          e.preventDefault();
          platform
            .postInvite(group.id, hook.trim())
            .then(() => setMsg({ ok: true, text: 'Posted. Anyone in the channel can click to join.' }))
            .catch((x: Error) => setMsg({ ok: false, text: say(x) }));
        }}
      >
        <div>
          <b>Post an invite to Discord</b>
          <div className="muted">In the channel: Edit Channel, Integrations, Webhooks, New Webhook, Copy Webhook URL. Paste it here. It's used once and not saved.</div>
        </div>
        <div className="row">
          <input aria-label="Webhook URL" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://discord.com/api/webhooks/…" style={{ width: 'min(360px, 100%)' }} />
          <button type="submit" className="primary" disabled={!hook.trim()}>
            Post
          </button>
        </div>
      </form>
      {msg && <p className={msg.ok ? 'note gain' : 'note bad'}>{msg.text}</p>}
    </Panel>
  );
}

/** /join/ABC123: what the Discord link opens. */
export function JoinPage({ code, go }: { code: string; go: (to: string) => void }) {
  const p = useLive(() => platform.groupPreview(code), [code], 60_000);
  const [err, setErr] = useState<string | null>(null);
  return (
    <main>
      <div className="panel card join-card" style={{ margin: '40px auto' }}>
        {!p.data ? (
          p.error ? <p className="note bad">No group has the code {code}. Ask for a new link.</p> : <Loading error={null} />
        ) : (
          <>
            <span className="group-tag">{p.data.tag}</span>
            <h1>{p.data.name}</h1>
            {p.data.description && <p className="muted">{p.data.description}</p>}
            <p>
              {p.data.members} / {p.data.max} members
            </p>
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={() => platform.joinGroup(code).then((r) => go(`/groups/${r.id}`)).catch((x: Error) => setErr(say(x)))}
              >
                Join {p.data.name}
              </button>
              <button type="button" onClick={() => go('/groups')}>
                Not now
              </button>
            </div>
            {err && <p className="note bad">{err}</p>}
          </>
        )}
      </div>
    </main>
  );
}
