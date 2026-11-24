/* First run (pair the mod, join or create a group), join links, and group settings. */
import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { dayLabel } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';
import { platform, type Group } from '../platform-api.ts';
import { meId, type User } from './data.ts';
import { Avatar, Card, CopyButton, Dropdown, Loading, Setting, Toggle, colourAt } from './ui.tsx';
import type { Go } from './App.tsx';

const GROUP_ERRORS: Record<string, string> = {
  bad_group: 'Name 2 to 32 characters; tag 2 to 4 letters or numbers.',
  group_limit: "You own as many groups as your plan allows. Leave or delete one first, or see Pro in Settings.",
  join_limit: "You're in as many groups as your plan allows. Leave one first, or see Pro in Settings.",
  group_full: 'That group is full.',
  unknown_group: "That invite link doesn't work. It may be old: ask for a new one.",
  slow_down: 'Too many tries. Wait a minute.',
  bad_code: "That isn't an invite code. Codes are 6 letters or numbers.",
  owner_cannot_leave: "The owner can't leave. Delete the group instead.",
  not_allowed: "You can't do that in this group.",
};
const say = (e: unknown) => GROUP_ERRORS[(e as Error).message] ?? 'That did not work. Try again.';

/** The first-run screen: shown on the group page until you are in a group. */
export function Start({ user, go, onCreated, preview }: { user: User; go: Go; onCreated: (id: number) => void; preview: boolean }) {
  const ov = useLive(() => api.overview('user'), [], 20_000);
  const me = meId(user);
  const paired = !preview && (ov.data?.accounts ?? []).some((a) => a.userId === me);
  return (
    <main className="dpage dpage-narrow">
      <div className="dhead-words">
        <h1 className="px dh1">Welcome, {user.name}</h1>
        <p className="soft">Three steps and your group's profit shows up here live.</p>
      </div>
      <Card>
        <ol className="steps">
          <li className={paired ? 'done' : undefined}>
            <div className="stack">
              <b>Get the mod</b>
              <span className="muted small">
                Pick your Minecraft version on the <a href="/download">download page</a> and put the file in your <code>mods</code> folder with Fabric API.
              </span>
            </div>
          </li>
          <li className={paired ? 'done' : undefined}>
            <div className="stack grow">
              <b>Pair it with your account</b>
              {paired ? <span className="gain small">Paired. Your accounts show up on the Me page.</span> : <PairCode disabled={preview} />}
            </div>
          </li>
          <li>
            <div className="stack grow">
              <b>Join or create a group</b>
              <span className="muted small">Up to 5 people. Got an invite link? Just open it. Or paste the code:</span>
              <JoinBox go={go} />
            </div>
          </li>
        </ol>
      </Card>
      <CreateGroup onCreated={onCreated} disabled={preview} />
    </main>
  );
}

export function PairCode({ disabled }: { disabled?: boolean }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number; endpoint?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);
  const live = code && code.expiresAt > now;
  // The mod pairs with app.arachne.fyi by default; any other server (like this PC) needs its address in the command.
  const cmd = code ? (code.endpoint && code.endpoint !== 'https://app.arachne.fyi' ? `/arachne pair ${code.endpoint} ${code.code}` : `/arachne pair ${code.code}`) : '';
  return (
    <div className="stack">
      {live ? (
        <>
          <span className="muted small">Type this in Minecraft chat. It works once, for the next {Math.max(0, Math.ceil((code.expiresAt - now) / 60_000))} min.</span>
          <div className="row-gap">
            <span className="px code-box grow">{cmd}</span>
            <CopyButton text={cmd} main />
          </div>
        </>
      ) : (
        <div className="row-gap">
          <button
            type="button"
            className="btn btn-main"
            disabled={busy || disabled}
            onClick={() => {
              setBusy(true);
              setErr(null);
              api
                .pairCode()
                .then(setCode)
                .catch(() => setErr("Couldn't make a code. Try again."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Making a code…' : code ? 'Get a new code' : 'Get a pairing code'}
          </button>
          <span className="muted small">{code ? 'That code ran out.' : 'A short code to type in game.'}</span>
        </div>
      )}
      {err && <p className="note bad">{err}</p>}
    </div>
  );
}

function JoinBox({ go }: { go: Go }) {
  const [code, setCode] = useState('');
  const clean = (code.split('/').pop() ?? '').trim().toUpperCase();
  return (
    <form
      className="row-gap"
      onSubmit={(e) => {
        e.preventDefault();
        if (/^[A-Z0-9]{6}$/.test(clean)) go(`/join/${clean}`);
      }}
    >
      <input className="input grow" style={{ flexBasis: 200 }} aria-label="Invite code or link" placeholder="Invite code or link" value={code} onChange={(e) => setCode(e.target.value)} />
      <button type="submit" className="btn btn-ghost" disabled={!/^[A-Z0-9]{6}$/.test(clean)}>
        Join
      </button>
    </form>
  );
}

function CreateGroup({ onCreated, disabled }: { onCreated: (id: number) => void; disabled?: boolean }) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    platform
      .createGroup({ name: name.trim(), tag: tag.trim(), description: description.trim() })
      .then((r) => onCreated(r.id))
      .catch((x) => setErr(say(x)))
      .finally(() => setBusy(false));
  };
  return (
    <Card title="Create a group">
      <form className="stack" onSubmit={submit}>
        <div className="row-gap" style={{ alignItems: 'flex-start' }}>
          <label className="field grow" style={{ flexBasis: 260 }}>
            <span className="field-label">Name</span>
            <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="e.g. Webweavers" />
          </label>
          <label className="field" style={{ width: 140 }}>
            <span className="field-label">Tag</span>
            <input className="input" value={tag} maxLength={4} onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="WEB" />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Description (optional)</span>
          <input className="input" value={description} maxLength={160} onChange={(e) => setDescription(e.target.value)} placeholder="Who you are, when you farm" />
        </label>
        <div className="row-gap">
          <button type="submit" className="btn btn-main" disabled={busy || disabled || name.trim().length < 2 || tag.length < 2}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
          <span className="muted small">You get an invite link to share straight away.</span>
        </div>
        {err && <p className="note bad">{err}</p>}
      </form>
    </Card>
  );
}

export function JoinPage({ code, go, onJoined, preview }: { code: string; go: Go; onJoined: (id: number) => void; preview: boolean }) {
  const g = useLive(() => platform.groupPreview(code), [code], 0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="dpage dpage-narrow">
      {!g.data ? (
        g.error ? (
          <Card>
            <p className="note bad">{say(new Error(g.error))}</p>
            <div>
              <button type="button" className="btn btn-ghost" onClick={() => go('/')}>
                Back
              </button>
            </div>
          </Card>
        ) : (
          <Loading />
        )
      ) : (
        <Card>
          <span className="muted small">You've been invited to</span>
          <div className="row-gap">
            <span className="gtag">{g.data.tag}</span>
            <h1 className="px dh1">{g.data.name}</h1>
          </div>
          {g.data.description && <p className="soft">{g.data.description}</p>}
          <span className="muted small">
            {g.data.members} of {g.data.max} members. Members see each other's totals for the group; you can keep your numbers private in Settings.
          </span>
          <div className="row-gap">
            <button
              type="button"
              className="btn btn-main"
              disabled={busy || preview || g.data.members >= g.data.max}
              onClick={() => {
                setBusy(true);
                setErr(null);
                platform
                  .joinGroup(code)
                  .then((r) => onJoined(r.id))
                  .catch((x) => setErr(say(x)))
                  .finally(() => setBusy(false));
              }}
            >
              {g.data.members >= g.data.max ? 'Group is full' : busy ? 'Joining…' : `Join ${g.data.name}`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => go('/')}>
              Not now
            </button>
          </div>
          {err && <p className="note bad">{err}</p>}
        </Card>
      )}
    </main>
  );
}

/** Group settings. Owners and mods manage; everyone can hide the tag or leave. */
export function GroupSettings({ group, user, go, onChanged }: { group: Group; user: User; go: Go; onChanged: () => void }) {
  const d = useLive(() => platform.group(group.id), [group.id], 30_000);
  const me = meId(user);
  const manage = group.role !== 'member';
  const owner = group.role === 'owner';
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const done = (text: string) => () => {
    setMsg({ ok: true, text });
    d.refresh();
    onChanged();
  };
  const fail = (x: unknown) => setMsg({ ok: false, text: say(x) });

  return (
    <main className="dpage dpage-narrow">
      <div className="dhead-words">
        <span className="px muted">Group settings</span>
        <h1 className="px dh1 row-gap">
          <span className="gtag">{group.tag}</span>
          {group.name}
        </h1>
        {group.description && <p className="soft">{group.description}</p>}
      </div>
      {msg && <p className={msg.ok ? 'note' : 'note bad'}>{msg.text}</p>}

      {manage && <EditGroup group={group} onSaved={done('Saved.')} onError={fail} />}

      {manage && group.code && (
        <Card title="Invite">
          <div className="row-gap">
            <span className="px code-box grow">{group.code}</span>
            <CopyButton text={`${window.location.origin}/join/${group.code}`} label="Copy link" main />
            <button type="button" className="btn btn-ghost" onClick={() => void platform.editGroup(group.id, { newCode: true }).then(done('New code made. The old link stops working.')).catch(fail)}>
              New code
            </button>
          </div>
          <span className="muted tiny">
            {group.members} of {group.max} members. A new code stops the old link working.
          </span>
          <DiscordInvite id={group.id} onDone={done('Posted to Discord.')} onError={fail} />
        </Card>
      )}

      <Card title="Members">
        {!d.data ? (
          <Loading error={d.error} />
        ) : (
          d.data.members.map((m, i) => {
            const self = m.userId === me;
            const canRemove = !self && m.role !== 'owner' && (owner || (group.role === 'mod' && m.role === 'member'));
            return (
              <div className="setting" key={m.userId}>
                <div className="liverow">
                  <Avatar name={m.name} colour={colourAt(i)} />
                  <span className="stack" style={{ gap: 0 }}>
                    <span className="px">
                      {m.name}
                      {self ? ' (you)' : ''}
                    </span>
                    <span className="muted tiny">
                      {m.role} · joined {dayLabel(m.joinedAt)}
                      {m.hidden ? ' · numbers private' : ''}
                    </span>
                  </span>
                </div>
                <div className="setting-control">
                  {owner && !self && m.role !== 'owner' && (
                    <Dropdown
                      small
                      label={`${m.name}'s role`}
                      value={m.role as 'mod' | 'member'}
                      options={[
                        ['member', 'Member'],
                        ['mod', 'Mod'],
                      ]}
                      onChange={(role) => void platform.setRole(group.id, m.userId, role).then(done(`${m.name} is now a ${role}.`)).catch(fail)}
                    />
                  )}
                  {canRemove && (
                    <button
                      type="button"
                      className="btn btn-danger btn-small"
                      onClick={() => window.confirm(`Remove ${m.name} from ${group.name}?`) && void platform.removeMember(group.id, m.userId).then(done(`${m.name} was removed.`)).catch(fail)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Card>

      <Card title="You in this group">
        <Setting title={`Show [${group.tag}] next to your name`} note="Other players with the mod see it next to your name in game. In several groups, the first one you joined with this on is used.">
          <Toggle label="Show the tag" on={group.showTag} onChange={(on) => void platform.showTag(group.id, on).then(done(on ? 'Tag shown.' : 'Tag hidden.')).catch(fail)} />
        </Setting>
        {!owner && (
          <Setting title="Leave the group" note="Your numbers stop counting towards it. You can rejoin with an invite link.">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() =>
                window.confirm(`Leave ${group.name}?`) &&
                void platform
                  .removeMember(group.id, me)
                  .then(() => {
                    onChanged();
                    go('/');
                  })
                  .catch(fail)
              }
            >
              Leave
            </button>
          </Setting>
        )}
      </Card>

      {owner && <DeleteGroup group={group} onDeleted={() => (onChanged(), go('/'))} onError={fail} />}
    </main>
  );
}

function EditGroup({ group, onSaved, onError }: { group: Group; onSaved: () => void; onError: (e: unknown) => void }) {
  const [name, setName] = useState(group.name);
  const [tag, setTag] = useState(group.tag);
  const [description, setDescription] = useState(group.description);
  const changed = name !== group.name || tag !== group.tag || description !== group.description;
  return (
    <Card title="Name and tag">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void platform.editGroup(group.id, { name: name.trim(), tag, description: description.trim() }).then(onSaved).catch(onError);
        }}
      >
        <div className="row-gap" style={{ alignItems: 'flex-start' }}>
          <label className="field grow" style={{ flexBasis: 260 }}>
            <span className="field-label">Name</span>
            <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field" style={{ width: 140 }}>
            <span className="field-label">Tag</span>
            <input className="input" value={tag} maxLength={4} onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Description</span>
          <input className="input" value={description} maxLength={160} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div>
          <button type="submit" className="btn btn-main" disabled={!changed || name.trim().length < 2 || tag.length < 2}>
            Save
          </button>
        </div>
      </form>
    </Card>
  );
}

function DiscordInvite({ id, onDone, onError }: { id: number; onDone: () => void; onError: (e: unknown) => void }) {
  const [hook, setHook] = useState('');
  return (
    <form
      className="row-gap"
      onSubmit={(e) => {
        e.preventDefault();
        void platform
          .postInvite(id, hook.trim())
          .then(() => (setHook(''), onDone()))
          .catch(onError);
      }}
    >
      <input className="input grow" style={{ flexBasis: 260 }} aria-label="Discord webhook URL" placeholder="Post the invite to Discord: paste a webhook URL" value={hook} onChange={(e) => setHook(e.target.value)} />
      <button type="submit" className="btn btn-ghost" disabled={!hook.trim().startsWith('https://')}>
        Post
      </button>
    </form>
  );
}

function DeleteGroup({ group, onDeleted, onError }: { group: Group; onDeleted: () => void; onError: (e: unknown) => void }) {
  const [typed, setTyped] = useState('');
  return (
    <Card title="Delete the group">
      <span className="muted small">Removes the group for everyone. Nobody's own numbers are deleted. Type the group's name to confirm.</span>
      <form
        className="row-gap"
        onSubmit={(e) => {
          e.preventDefault();
          void platform.deleteGroup(group.id).then(onDeleted).catch(onError);
        }}
      >
        <input className="input grow" style={{ flexBasis: 220 }} aria-label="Group name" placeholder={group.name} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button type="submit" className="btn btn-danger" disabled={typed !== group.name}>
          Delete
        </button>
      </form>
    </Card>
  );
}
