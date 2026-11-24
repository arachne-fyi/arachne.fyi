import { useState } from 'react';
import { api, setViewingAs, setViewingAsFree, viewingAsFree, type Me } from '../api.ts';
import { Empty, Loading, Panel, Toggle } from '../components/Bits.tsx';
import { parseCoins } from '../components/Extras.tsx';
import { undoable } from '../components/Undo.tsx';
import { ago, bytes, dateTime } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';
import { CodesPanel, PlansPanel } from './Pro.tsx';
import { platform } from '../platform-api.ts';

export function Admin({ me }: { me: NonNullable<Me['user']> }) {
  const users = useLive(api.adminUsers, []);
  const [discordId, setDiscordId] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [jarMessage, setJarMessage] = useState<string | null>(null);
  const requests = useLive(api.adminRequests, []);
  const storage = useLive(api.adminStorage, [], 60_000);
  const hiddenIds = new Set(storage.data?.hidden ?? []);
  const now = useNow(30_000);

  return (
    <main>
      <div className="head">
        <h1>Admin</h1>
        <button type="button" onClick={() => setViewingAsFree(!viewingAsFree())}>
          {viewingAsFree() ? 'Stop viewing as free user' : 'View the site as a free user'}
        </button>
      </div>

      <PurgePanel />
      <PlansPanel />
      <CodesPanel />

      {requests.data && requests.data.requests.length > 0 && (
        <Panel title="Waiting to get in" side={<span className="muted">They tried to log in and are not on the list</span>}>
          <ul className="requests">
            {requests.data.requests.map((r) => (
              <li key={r.discordId}>
                {r.avatar ? <img className="avatar" src={r.avatar} alt="" /> : <span className="avatar">{r.name.slice(0, 1).toUpperCase()}</span>}
                <div>
                  <b>{r.name}</b>
                  <div className="muted">
                    {r.discordId}, tried {ago(r.lastAt, now)}
                  </div>
                </div>
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    void api.adminRequest(r.discordId, 'approve').then(() => {
                      requests.refresh();
                      users.refresh();
                    })
                  }
                >
                  Let in
                </button>
                <button type="button" onClick={() => void api.adminRequest(r.discordId, 'dismiss').then(requests.refresh)}>
                  Ignore
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <AnnouncementEditor />
      <TeamGoalEditor />

      <section className="panel">
        <header>
          <h2>Invite list</h2>
        </header>
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          Only Discord accounts on this list can log in. In Discord, turn on Developer Mode, right-click a profile and
          choose Copy User ID.
        </p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage(null);
            setAdding(true);
            api
              .adminAllow(discordId.trim(), role)
              .then(() => {
                setDiscordId('');
                setMessage('Added. They can log in now.');
                users.refresh();
              })
              .catch(() => setMessage('That is not a Discord user ID. It is a 17 to 20 digit number.'))
              .finally(() => setAdding(false));
          }}
        >
          <label>
            Discord user ID
            <input value={discordId} onChange={(e) => setDiscordId(e.target.value)} inputMode="numeric" placeholder="123456789012345678" />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="primary" disabled={adding || !discordId.trim()} aria-busy={adding}>
            {adding ? 'Adding…' : 'Add to the list'}
          </button>
        </form>
        {message && <p className="note" style={{ marginTop: '0.75rem' }}>{message}</p>}
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          {!users.data ? (
            <Loading error={users.error} />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th className="opt">Accounts</th>
                    <th className="num opt">Active tokens</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.data.users.map((u) => (
                    <tr key={u.id} className={u.disabled ? 'faint' : undefined}>
                      <td>
                        <span className="who">{u.name}</span>
                        <span className="sub">
                          {u.discordId}
                          {u.lastLoginAt ? `, last login ${ago(u.lastLoginAt, now)}` : ', never logged in'}
                        </span>
                      </td>
                      <td>
                        <select
                          value={u.role}
                          disabled={u.id === me.id}
                          aria-label={`Role for ${u.name}`}
                          onChange={(e) => void api.adminPatch(u.id, { role: e.target.value as 'admin' | 'user' }).then(users.refresh)}
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="muted opt">
                        {u.accountInfo.length === 0
                          ? 'None yet'
                          : u.accountInfo.map((a) => (
                              <span key={a.name} className="sub" data-tip={`Last seen ${ago(a.lastSeen, now)}`}>
                                {a.name} <span className="faint">mod {a.modVersion ?? '?'}</span>
                              </span>
                            ))}
                      </td>
                      <td className="num opt">
                        {u.tokenInfo.map((t) => (
                          <span key={t.id} className="sub token-line">
                            {t.label} <span className="faint">{t.lastUsedAt ? `used ${ago(t.lastUsedAt, now)}` : 'never used'}</span>{' '}
                            <button
                              type="button"
                              className="danger small"
                              onClick={() => undoable(`Revoking ${u.name}'s token "${t.label}".`, () => void api.adminRevokeToken(t.id).then(users.refresh))}
                            >
                              Revoke
                            </button>
                          </span>
                        ))}
                        {u.tokenInfo.length === 0 && <span className="faint">none</span>}
                      </td>
                      <td className="num">
                        {u.id !== me.id && (
                          <span className="row" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="small" onClick={() => setViewingAs({ id: u.id, name: u.name })}>
                              View as
                            </button>
                            <span className="toggle-field" data-tip="Off: left off the leaderboard and challenges. They still see their own numbers.">
                              <span>On boards</span>
                              <Toggle label="On boards" on={!hiddenIds.has(u.id)} onChange={(on) => void api.adminHide(u.id, !on).then(() => (users.refresh(), storage.refresh()))} />
                            </span>
                          </span>
                        )}
                        {u.id !== me.id && (
                          <button
                            type="button"
                            className={u.disabled ? undefined : 'danger'}
                            onClick={() =>
                              u.disabled
                                ? void api.adminPatch(u.id, { disabled: false }).then(users.refresh)
                                : undoable(`Removing ${u.name}'s access.`, () => void api.adminPatch(u.id, { disabled: true }).then(users.refresh))
                            }
                          >
                            {u.disabled ? 'Let back in' : 'Remove access'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <header>
          <h2>Mod download</h2>
        </header>
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          Upload a jar named like <code>arachne-fyi-2.0.0+26.2.jar</code> (mod version, then <code>+</code> and the
          Minecraft version). The download page groups builds by that Minecraft version.
        </p>
        <input
          type="file"
          accept=".jar"
          aria-label="Mod jar"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setJarMessage('Uploading…');
            api
              .uploadJar(file)
              .then((r) => setJarMessage(`Uploaded ${r.jar.file}.`))
              .catch((err: Error) => setJarMessage(`Upload refused: ${err.message}`));
          }}
        />
        {jarMessage && <p className="note" style={{ marginTop: '0.75rem' }}>{jarMessage}</p>}
      </section>

      <StoragePanel />
      <SuspiciousPanel />
      <AuditPanel />
    </main>
  );
}

/** One line of text shown at the top of everyone's Overview. */
function AnnouncementEditor() {
  const current = useLive(api.announcement, []);
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const value = text ?? current.data?.announcement?.text ?? '';
  const save = (t: string) => {
    setState('saving');
    api
      .setAnnouncement(t)
      .then(() => {
        setState('saved');
        setText(null);
        current.refresh();
      })
      .catch(() => setState('idle'));
  };
  return (
    <Panel title="Announcement" side={<span className="muted">Shown at the top of everyone's Overview</span>}>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          save(value);
        }}
      >
        <input aria-label="Announcement" style={{ flex: 1, minWidth: 0 }} maxLength={300} value={value} onChange={(e) => setText(e.target.value)} placeholder="e.g. Server restarting at 18:00" />
        <button type="submit" className="primary" aria-busy={state === 'saving'} disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Post'}
        </button>
        {current.data?.announcement && (
          <button type="button" onClick={() => save('')}>
            Remove
          </button>
        )}
      </form>
      {state === 'saved' && <p className="note good" style={{ marginTop: '0.75rem' }}>Saved.</p>}
    </Panel>
  );
}

function TeamGoalEditor() {
  const g = useLive(api.teamGoal, []);
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const value = text ?? (g.data && g.data.goal > 0 ? String(g.data.goal) : '');
  return (
    <Panel title="Team goal" side={<span className="muted">Weekly profit for everyone together, from Monday</span>}>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void api.setTeamGoal(parseCoins(value)).then(() => {
            setSaved(true);
            setText(null);
            g.refresh();
          });
        }}
      >
        <input aria-label="Team goal" value={value} onChange={(e) => (setText(e.target.value), setSaved(false))} placeholder="e.g. 500m, empty for none" />
        <button type="submit" className="primary">
          Save
        </button>
        {saved && <span className="gain">Saved.</span>}
      </form>
    </Panel>
  );
}

/** Disk use and the nightly backup. */
function StoragePanel() {
  const s = useLive(api.adminStorage, [], 60_000);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<number | null>(null);
  if (!s.data) return <Panel title="Storage"><Loading error={s.error} /></Panel>;
  const d = s.data;
  const rows: [string, number, string][] = [
    ['Event logs', d.events, 'The source of truth. Back these up.'],
    ['Price history', d.prices, ''],
    ['index.db', d.indexDb, 'Rebuilt from the event logs if lost.'],
    ['state.db', d.stateDb, 'Users and tokens. Copied every night.'],
    ['Mod downloads', d.downloads, ''],
    ['Backups', d.backups, ''],
  ];
  return (
    <Panel className="storage" title="Storage" side={<span className="muted">{d.eventCount.toLocaleString('en-GB')} events stored</span>}>
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        Since the server started {dateTime(d.ingest.since)}: {d.ingest.batches.toLocaleString('en-GB')} batches, {d.ingest.accepted.toLocaleString('en-GB')} events
        stored, {d.ingest.duplicates.toLocaleString('en-GB')} resent (ignored), {d.ingest.rejected.toLocaleString('en-GB')} refused.{' '}
        {d.ingest.lastMinute} in the last minute.
      </p>
      <div className="table-scroll">
        <table>
          <tbody>
            {rows.map(([label, size, note]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="num">{bytes(size)}</td>
                <td className="muted opt">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
        <span className="muted">
          {d.lastBackup ? `Last backup ${dateTime(d.lastBackup.at)} (${bytes(d.lastBackup.size)})` : 'No backup yet.'}
        </span>
        <button
          type="button"
          aria-busy={busy}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api
              .adminBackup()
              .then((r) => {
                setChecked(r.checkedUsers);
                s.refresh();
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
        {checked != null && <span className={checked >= 0 ? 'gain' : 'loss'}>{checked >= 0 ? `Copy checked: opens fine, ${checked} people in it.` : 'Copy could not be checked.'}</span>}
        <span className="muted">Discord drop posts: {d.webhook ? 'on' : 'off (set DISCORD_WEBHOOK_URL in .env)'}</span>
      </div>
      {d.priceGaps.length > 0 && (
        <p className="note" style={{ marginTop: '0.75rem' }}>
          Bazaar prices are missing for {d.priceGaps.length} stretch{d.priceGaps.length === 1 ? '' : 'es'} this week (PC off or Hypixel down), last{' '}
          {dateTime(d.priceGaps.at(-1)!.from)} to {dateTime(d.priceGaps.at(-1)!.to)}. Drops then used the nearest price.
        </p>
      )}
      <RebuildButton />
    </Panel>
  );
}

function RebuildButton() {
  const [state, setState] = useState<string | null>(null);
  return (
    <div className="row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
      <button
        type="button"
        disabled={state === 'busy'}
        aria-busy={state === 'busy'}
        data-tip="Works out every number again from the event files. Use it if numbers look wrong. Takes a while with lots of data."
        onClick={() => {
          setState('busy');
          api
            .adminRebuild()
            .then(() => setState('Rebuilt.'))
            .catch((e: Error) => setState(`Failed: ${e.message}`));
        }}
      >
        {state === 'busy' ? 'Rebuilding…' : 'Rebuild numbers'}
      </button>
      {state && state !== 'busy' && <span className="muted">{state}</span>}
    </div>
  );
}

function SuspiciousPanel() {
  const s = useLive(api.adminSuspicious, [], 300_000);
  return (
    <Panel title="Odd data" side={<span className="muted">worth a look</span>}>
      {!s.data ? (
        <Loading error={s.error} />
      ) : s.data.items.length === 0 ? (
        <Empty>Nothing odd.</Empty>
      ) : (
        <ul className="audit">
          {s.data.items.slice(0, 30).map((i, n) => (
            <li key={n}>
              <span className="muted">{dateTime(i.ts)}</span>
              <b>{i.kind}</b>
              <span>{i.account}</span>
              <span className="muted">{i.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Who did what, newest first. */
function AuditPanel() {
  const a = useLive(api.adminAudit, [], 60_000);
  const now = useNow(30_000);
  return (
    <Panel title="Admin history">
      {!a.data ? (
        <Loading error={a.error} />
      ) : a.data.entries.length === 0 ? (
        <Empty>No admin actions yet.</Empty>
      ) : (
        <ul className="audit">
          {a.data.entries.slice(0, 50).map((e) => (
            <li key={e.id}>
              <span className="muted" data-tip={dateTime(e.ts)}>{ago(e.ts, now)}</span>
              <b>{e.by}</b>
              <span>{AUDIT_WORDS[e.action] ?? e.action}</span>
              <span className="muted">{e.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const AUDIT_WORDS: Record<string, string> = {
  'user.allow': 'added to the list',
  'user.change': 'changed a person',
  'token.revoke': 'revoked a token',
  'request.approve': 'let someone in',
  'request.dismiss': 'ignored a request',
  'announcement.set': 'posted an announcement',
  'announcement.clear': 'removed the announcement',
  'jar.upload': 'uploaded a mod build',
  'backup.now': 'made a backup',
  'teamgoal.set': 'set the team goal',
  'user.hide': 'hid someone from the boards',
  'user.unhide': 'put someone back on the boards',
  'index.rebuild': 'rebuilt the numbers',
};

/** Test servers only (ALPHA_MODE=1): wipe the farming data. The server has no such route otherwise. */
function PurgePanel() {
  const me = useLive(api.me, []);
  const [typed, setTyped] = useState('');
  const [everything, setEverything] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!me.data?.alphaMode) return null;
  return (
    <Panel title="Alpha mode: wipe data" className="danger-panel">
      <p className="muted">This server runs with ALPHA_MODE=1. Wipes every fight and drop (day files and index). People, logins and tokens stay.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          platform
            .purge(everything)
            .then((r) => {
              setMsg(`Wiped: ${r.files} day files.`);
              setTyped('');
            })
            .catch(() => setMsg('Did not wipe.'));
        }}
      >
        <span className="toggle-field">
          <span>Also accounts, groups and comments</span>
          <Toggle label="Also accounts, groups and comments" on={everything} onChange={setEverything} />
        </span>
        <input aria-label="Type PURGE" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type PURGE" />
        <button type="submit" className="danger" disabled={typed !== 'PURGE'}>
          Wipe
        </button>
      </form>
      {msg && <p className="note">{msg}</p>}
    </Panel>
  );
}
