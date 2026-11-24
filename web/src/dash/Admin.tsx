/* Admin: view the site as someone else, who can get in, plans and codes, mod uploads, the announcement, storage and history. */
import { useState } from 'react';
import { api, setViewingAs, setViewingAsFree, viewingAsFree, type Me } from '../api.ts';
import { ago, bytes, dateTime, dayLabel } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';
import { platform } from '../platform-api.ts';
import { previewNew, setPreviewNew, type User } from './data.ts';
import { Avatar, Card, CopyButton, Dropdown, Loading, Setting, Toggle } from './ui.tsx';

export function AdminPage({ user, me }: { user: User; me: Me }) {
  return (
    <main className="dpage">
      <div className="dhead-words">
        <h1 className="px dh1">Admin</h1>
        <p className="soft">Only admins see this page.</p>
      </div>
      <ViewAs />
      <Requests />
      <People user={user} />
      <Codes />
      <div className="cols">
        <div className="col-half stack">
          <Announcement />
          <ModUpload />
        </div>
        <div className="col-half stack">
          <Storage />
        </div>
      </div>
      <Odd />
      <Audit />
      {me.alphaMode && <Purge />}
    </main>
  );
}

function ViewAs() {
  return (
    <Card title="View the site as">
      <Setting title="A new user" note="The first-run screens: pair the mod, join or create a group. Your data isn't touched and the buttons there do nothing.">
        <button type="button" className="btn btn-main" onClick={() => setPreviewNew(!previewNew())}>
          {previewNew() ? 'Stop' : 'View as new user'}
        </button>
      </Setting>
      <Setting title="A free user" note="The server answers this tab as if your plan were Free, so Pro parts show their locked preview.">
        <button type="button" className="btn btn-main" onClick={() => setViewingAsFree(!viewingAsFree())}>
          {viewingAsFree() ? 'Stop' : 'View as free user'}
        </button>
      </Setting>
      <Setting title="A person" note="Pick View as next to someone below. Pages show their numbers; anything you change is still done as you." />
    </Card>
  );
}

function Requests() {
  const r = useLive(api.adminRequests, []);
  const now = useNow(30_000);
  if (!r.data || r.data.requests.length === 0) return null;
  return (
    <Card title="Waiting to get in" side="tried to sign in and aren't on the list">
      {r.data.requests.map((q) => (
        <div className="setting" key={q.discordId}>
          <div className="liverow">
            <Avatar name={q.name} src={q.avatar} />
            <span className="stack" style={{ gap: 0 }}>
              <span className="px">{q.name}</span>
              <span className="muted tiny">
                {q.discordId} · tried {ago(q.lastAt, now)}
              </span>
            </span>
          </div>
          <div className="setting-control">
            <button type="button" className="btn btn-main btn-small" onClick={() => void api.adminRequest(q.discordId, 'approve').then(r.refresh)}>
              Let in
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void api.adminRequest(q.discordId, 'dismiss').then(r.refresh)}>
              Ignore
            </button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function People({ user }: { user: User }) {
  const users = useLive(api.adminUsers, []);
  const plans = useLive(platform.adminPlans, []);
  const now = useNow(30_000);
  const [discordId, setDiscordId] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [msg, setMsg] = useState<string | null>(null);
  const byId = new Map((plans.data?.plans ?? []).map((x) => [x.userId, x]));
  const refresh = () => (users.refresh(), plans.refresh());
  return (
    <Card title="People">
      {plans.data && (
        <Setting title="Open sign-up" note="On: anyone can sign in with Discord and gets a free account. Off: only people on the list.">
          <Toggle label="Open sign-up" on={plans.data.openSignup} onChange={(on) => void platform.setOpenSignup(on).then(plans.refresh)} />
        </Setting>
      )}
      <form
        className="setting"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          api
            .adminAllow(discordId.trim(), role)
            .then(() => {
              setDiscordId('');
              setMsg('Added. They can sign in now.');
              users.refresh();
            })
            .catch(() => setMsg("That isn't a Discord user ID. It's a 17 to 20 digit number."));
        }}
      >
        <div className="setting-words">
          <b>Add to the list</b>
          <span className="muted small">In Discord, turn on Developer Mode, right-click a profile and choose Copy User ID.</span>
        </div>
        <div className="setting-control">
          <input className="input" style={{ width: 220 }} inputMode="numeric" aria-label="Discord user ID" value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="123456789012345678" />
          <Dropdown
            small
            label="Role"
            value={role}
            options={[
              ['user', 'User'],
              ['admin', 'Admin'],
            ]}
            onChange={setRole}
          />
          <button type="submit" className="btn btn-main" disabled={!discordId.trim()}>
            Add
          </button>
        </div>
      </form>
      {msg && <p className="note">{msg}</p>}
      {!users.data ? (
        <Loading error={users.error} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Plan</th>
                <th>Minecraft accounts</th>
                <th>Tokens</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data.users.map((u) => {
                const p = byId.get(u.id);
                const self = u.id === user.id;
                return (
                  <tr key={u.id} style={u.disabled ? { opacity: 0.5 } : undefined}>
                    <td>
                      <div className="liverow">
                        <Avatar name={u.name} src={u.avatar} />
                        <span className="stack" style={{ gap: 0 }}>
                          <span className="px">{u.name}</span>
                          <span className="muted tiny">{u.lastLoginAt ? `signed in ${ago(u.lastLoginAt, now)}` : 'never signed in'}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      {self ? (
                        'Admin (you)'
                      ) : (
                        <Dropdown
                          small
                          label={`Role for ${u.name}`}
                          value={u.role}
                          options={[
                            ['user', 'User'],
                            ['admin', 'Admin'],
                          ]}
                          onChange={(r) => void api.adminPatch(u.id, { role: r }).then(users.refresh)}
                        />
                      )}
                    </td>
                    <td>
                      <div className="stack" style={{ gap: 6 }}>
                        <span>
                          {p?.plan === 'pro' ? 'Pro' : 'Free'}
                          {p?.plan === 'pro' && (
                            <span className="muted tiny">
                              {' '}
                              ({p.source}
                              {p.until ? `, until ${dayLabel(p.until)}` : ''})
                            </span>
                          )}
                        </span>
                        <span className="row-gap">
                          {(p?.plan !== 'pro' || (p.until != null && p.source !== 'admin')) && (
                            <button type="button" className="btn btn-ghost btn-small" onClick={() => void platform.setPlan(u.id, 'pro').then(refresh)}>
                              Give Pro
                            </button>
                          )}
                          <button type="button" className="btn btn-ghost btn-small" onClick={() => void platform.setPlan(u.id, 'pro', 30).then(refresh)}>
                            +30 days
                          </button>
                          {p?.plan === 'pro' && p.source !== 'admin' && (
                            <button type="button" className="btn btn-ghost btn-small" onClick={() => void platform.setPlan(u.id, 'free').then(refresh)}>
                              Make free
                            </button>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="muted">
                      {u.accountInfo.length === 0
                        ? 'none yet'
                        : u.accountInfo.map((a) => (
                            <div key={a.name}>
                              {a.name} <span className="tiny">mod {a.modVersion ?? '?'} · {ago(a.lastSeen, now)}</span>
                            </div>
                          ))}
                    </td>
                    <td>
                      {u.tokenInfo.length === 0 && <span className="muted">none</span>}
                      {u.tokenInfo.map((t) => (
                        <div key={t.id} className="row-gap" style={{ marginBottom: 4 }}>
                          <span>{t.label}</span>
                          <span className="muted tiny">{t.lastUsedAt ? `used ${ago(t.lastUsedAt, now)}` : 'never used'}</span>
                          <button type="button" className="btn btn-danger btn-small" onClick={() => window.confirm(`Revoke ${u.name}'s token "${t.label}"?`) && void api.adminRevokeToken(t.id).then(users.refresh)}>
                            Revoke
                          </button>
                        </div>
                      ))}
                    </td>
                    <td className="r">
                      {!self && (
                        <span className="row-gap" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="btn btn-ghost btn-small" onClick={() => setViewingAs({ id: u.id, name: u.name })}>
                            View as
                          </button>
                          <button
                            type="button"
                            className={`btn btn-small ${u.disabled ? 'btn-ghost' : 'btn-danger'}`}
                            onClick={() =>
                              u.disabled
                                ? void api.adminPatch(u.id, { disabled: false }).then(users.refresh)
                                : window.confirm(`Remove ${u.name}'s access? They're signed out and can't sign in.`) && void api.adminPatch(u.id, { disabled: true }).then(users.refresh)
                            }
                          >
                            {u.disabled ? 'Let back in' : 'Remove access'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Codes() {
  const list = useLive(platform.adminCodes, []);
  const [o, setO] = useState({ days: 30, validMinutes: 10, maxUses: 1, count: 1, note: '' });
  const [made, setMade] = useState<string[]>([]);
  const num = (k: 'days' | 'validMinutes' | 'maxUses' | 'count', label: string, max: number) => (
    <label className="field" style={{ width: 150 }}>
      <span className="field-label">{label}</span>
      <input className="input" type="number" min={1} max={max} value={o[k]} onChange={(e) => setO({ ...o, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <Card title="Pro codes">
      <form
        className="row-gap"
        style={{ alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          void platform.makeCodes(o).then((r) => {
            setMade(r.codes);
            list.refresh();
          });
        }}
      >
        {num('days', 'Pro days', 366)}
        {num('validMinutes', 'Valid (minutes)', 10_080)}
        {num('maxUses', 'Uses each', 1000)}
        {num('count', 'How many', 20)}
        <label className="field grow" style={{ flexBasis: 180 }}>
          <span className="field-label">Note</span>
          <input className="input" value={o.note} onChange={(e) => setO({ ...o, note: e.target.value })} placeholder="e.g. giveaway" maxLength={80} />
        </label>
        <button type="submit" className="btn btn-main">
          Make
        </button>
      </form>
      {made.length > 0 && (
        <div className="note row-gap">
          {made.map((c) => (
            <code key={c} className="mono">
              {c}
            </code>
          ))}
          <CopyButton text={made.join('\n')} />
        </div>
      )}
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.codes.length === 0 ? (
        <p className="empty small">No codes yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Gives</th>
                <th>Used</th>
                <th>Ends</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.codes.map((c) => (
                <tr key={c.code} style={c.live ? undefined : { opacity: 0.5 }}>
                  <td className="mono">{c.code}</td>
                  <td>{c.days} days</td>
                  <td>
                    {c.uses} / {c.maxUses}
                  </td>
                  <td>{c.live ? `in ${Math.max(1, Math.round((c.expiresAt - Date.now()) / 60_000))} min` : c.expiresAt <= Date.now() ? `ended ${ago(c.expiresAt)}` : 'used up'}</td>
                  <td className="muted">{c.note}</td>
                  <td className="r">
                    {c.live && (
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => void platform.revokeCode(c.code).then(list.refresh)}>
                        End now
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Announcement() {
  const current = useLive(api.announcement, []);
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const value = text ?? current.data?.announcement?.text ?? '';
  const save = (t: string) =>
    void api.setAnnouncement(t).then(() => {
      setSaved(true);
      setText(null);
      current.refresh();
    });
  return (
    <Card title="Announcement" side="one line at the top of everyone's dashboard">
      <form
        className="row-gap"
        onSubmit={(e) => {
          e.preventDefault();
          save(value);
        }}
      >
        <input className="input grow" style={{ flexBasis: 220 }} aria-label="Announcement" maxLength={300} value={value} onChange={(e) => (setText(e.target.value), setSaved(false))} placeholder="e.g. Server restarting at 18:00 UTC" />
        <button type="submit" className="btn btn-main">
          Post
        </button>
        {current.data?.announcement && (
          <button type="button" className="btn btn-ghost" onClick={() => save('')}>
            Remove
          </button>
        )}
      </form>
      {saved && <span className="gain small">Saved.</span>}
    </Card>
  );
}

function ModUpload() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="Mod download">
      <span className="muted small">
        Upload a jar named like <code>arachne-fyi-2.0.0+26.2.jar</code>: the mod version, then <code>+</code> and the Minecraft version. The download page groups builds by that Minecraft version.
      </span>
      <label className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
        Choose a .jar
        <input
          type="file"
          accept=".jar"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setMsg('Uploading…');
            api
              .uploadJar(file)
              .then((r) => setMsg(`Uploaded ${r.jar.file}.`))
              .catch((err: Error) => setMsg(`Upload refused: ${err.message}`));
          }}
        />
      </label>
      {msg && <p className="note">{msg}</p>}
    </Card>
  );
}

function Storage() {
  const s = useLive(api.adminStorage, [], 60_000);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<number | null>(null);
  const [rebuild, setRebuild] = useState<string | null>(null);
  if (!s.data) return <Card title="Storage"><Loading error={s.error} /></Card>;
  const d = s.data;
  const rows: [string, number, string][] = [
    ['Event logs', d.events, 'the source of truth'],
    ['Price history', d.prices, ''],
    ['index.db', d.indexDb, 'rebuilt from the logs if lost'],
    ['state.db', d.stateDb, 'users and tokens, copied nightly'],
    ['Mod downloads', d.downloads, ''],
    ['Backups', d.backups, ''],
  ];
  return (
    <Card title="Storage" side={`${d.eventCount.toLocaleString('en-GB')} events`}>
      <span className="muted small">
        Since {dateTime(d.ingest.since)}: {d.ingest.batches.toLocaleString('en-GB')} batches, {d.ingest.accepted.toLocaleString('en-GB')} events stored, {d.ingest.duplicates.toLocaleString('en-GB')} resent, {d.ingest.rejected.toLocaleString('en-GB')} refused. {d.ingest.lastMinute} in the last minute.
      </span>
      <table className="table">
        <tbody>
          {rows.map(([label, size, note]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="r px">{bytes(size)}</td>
              <td className="muted tiny">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="muted small">{d.lastBackup ? `Last backup ${dateTime(d.lastBackup.at)} (${bytes(d.lastBackup.size)}).` : 'No backup yet.'}</span>
      <div className="row-gap">
        <button
          type="button"
          className="btn btn-ghost"
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
        <button
          type="button"
          className="btn btn-ghost"
          disabled={rebuild === 'busy'}
          title="Works out every number again from the event files. Takes a while with lots of data."
          onClick={() => {
            setRebuild('busy');
            api
              .adminRebuild()
              .then(() => setRebuild('Rebuilt.'))
              .catch((e: Error) => setRebuild(`Failed: ${e.message}`));
          }}
        >
          {rebuild === 'busy' ? 'Rebuilding…' : 'Rebuild numbers'}
        </button>
      </div>
      {checked != null && <span className={`small ${checked >= 0 ? 'gain' : 'loss'}`}>{checked >= 0 ? `Copy checked: opens fine, ${checked} people in it.` : 'Copy could not be checked.'}</span>}
      {rebuild && rebuild !== 'busy' && <span className="muted small">{rebuild}</span>}
      <span className="muted tiny">Discord drop posts: {d.webhook ? 'on' : 'off (set DISCORD_WEBHOOK_URL in .env)'}</span>
      {d.priceGaps.length > 0 && (
        <p className="note">
          Bazaar prices are missing for {d.priceGaps.length} stretch{d.priceGaps.length === 1 ? '' : 'es'} this week, last {dateTime(d.priceGaps.at(-1)!.from)} to {dateTime(d.priceGaps.at(-1)!.to)}. Drops then used the nearest price.
        </p>
      )}
    </Card>
  );
}

function Odd() {
  const s = useLive(api.adminSuspicious, [], 300_000);
  return (
    <Card title="Odd data" side="worth a look">
      {!s.data ? (
        <Loading error={s.error} />
      ) : s.data.items.length === 0 ? (
        <p className="empty small">Nothing odd.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {s.data.items.slice(0, 30).map((i, n) => (
                <tr key={n}>
                  <td className="muted">{dateTime(i.ts)}</td>
                  <td>{i.kind}</td>
                  <td>{i.account}</td>
                  <td className="muted">{i.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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

function Audit() {
  const a = useLive(api.adminAudit, [], 60_000);
  const now = useNow(30_000);
  return (
    <Card title="Admin history">
      {!a.data ? (
        <Loading error={a.error} />
      ) : a.data.entries.length === 0 ? (
        <p className="empty small">No admin actions yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {a.data.entries.slice(0, 50).map((e) => (
                <tr key={e.id}>
                  <td className="muted" title={dateTime(e.ts)}>
                    {ago(e.ts, now)}
                  </td>
                  <td className="px">{e.by}</td>
                  <td>{AUDIT_WORDS[e.action] ?? e.action}</td>
                  <td className="muted">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Test servers only (ALPHA_MODE=1): wipe the farming data. */
function Purge() {
  const [typed, setTyped] = useState('');
  const [everything, setEverything] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="Alpha mode: wipe data">
      <span className="muted small">This server runs with ALPHA_MODE=1. Wipes every fight and drop. People, logins and tokens stay.</span>
      <Setting title="Also accounts, groups and comments">
        <Toggle label="Also accounts, groups and comments" on={everything} onChange={setEverything} />
      </Setting>
      <form
        className="row-gap"
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
        <input className="input" style={{ width: 160 }} aria-label="Type PURGE" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type PURGE" />
        <button type="submit" className="btn btn-danger" disabled={typed !== 'PURGE'}>
          Wipe
        </button>
      </form>
      {msg && <p className="note">{msg}</p>}
    </Card>
  );
}
